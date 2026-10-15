// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CONVERSATION_TAB, FIXED_TABS_STORAGE_KEY, INBOX_TAB, SCHEDULE_TAB, TAB_STORAGE_KEY, TASKS_TAB,
  activateTab, activeFile, closeTab, defaultFixedTabs, emptyTabs, isRunLogPath, openTab, persistFixedTabs, persistTabs, readOnlyPath,
  restoreFixedTabs, restoreTabs, tabFor, tabTitle,
  type TabMode, type TabState, type TabStorage,
} from '../src/client/tabs.ts'

/** An in-memory stand-in for localStorage. */
function memory(seed?: readonly string[]): TabStorage & { readonly writes: string[] } {
  const writes: string[] = []
  let value: string | null = seed === undefined ? null : JSON.stringify([...seed])
  return {
    writes,
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      writes.push(next)
      value = next
    },
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('tabTitle', () => {
  it('drops the entity .md suffix and the directory', () => {
    expect(tabTitle('entities/projects/dsh 学习.md')).toBe('dsh 学习')
    expect(tabTitle('resources/周报.eml')).toBe('周报.eml')
    expect(tabTitle('entities/todos.md')).toBe('todos')
  })
})

describe('readOnlyPath', () => {
  it('treats 资源 originals as read-only and entities as editable', () => {
    expect(readOnlyPath('resources/周报.eml')).toBe(true)
    expect(readOnlyPath('entities/areas/健康.md')).toBe(false)
  })

  it('treats a .md note under 资源 as editable — it is not an original', () => {
    expect(readOnlyPath('resources/汇报模板.md')).toBe(false)
  })
})

describe('isRunLogPath', () => {
  it('flags run logs and nothing else under sessions/', () => {
    expect(isRunLogPath('sessions/workspace/run_abc_01.log')).toBe(true)
    expect(isRunLogPath('sessions/workspace/not-a-log.txt')).toBe(false)
    expect(isRunLogPath('sessions/archive/notes.md')).toBe(false)
    expect(isRunLogPath('resources/周报.eml')).toBe(false)
  })

  it('keeps the mirrored run-log dir literal equal to the controller’s definition', async () => {
    // The client bundle purity gate forbids value imports from controllers,
    // so tabs.ts hand-copies the literal; this pin catches a one-sided edit.
    const controller = await import('@deepseek-ai/dsh-api-yantao-kb-controller/types')
    expect((await import('../src/client/tabs.ts')).WORKSPACE_RUN_LOG_DIR).toBe(controller.WORKSPACE_RUN_LOG_DIR)
    // 全量并发下控制器包的动态 import 会被 worker 争用拖过 5s 默认超时
    // （单跑 1.6s，并发 5s+）——超时放宽，钉的语义不变（2026-10-14）。
  }, 20000)
})

describe('openTab', () => {
  it('opens a file and makes it active', () => {
    const state = openTab(emptyTabs(), 'entities/areas/健康.md', 'edit')
    expect(state.files).toHaveLength(1)
    expect(state.active).toBe('entities/areas/健康.md')
    expect(activeFile(state)?.title).toBe('健康')
  })

  it('activates an already-open file instead of adding a second tab', () => {
    const first = openTab(emptyTabs(), 'a.md', 'edit')
    const second = openTab(first, 'b.md', 'read')
    const reopened = openTab(second, 'a.md', 'edit')
    expect(reopened.files.map(tab => tab.path)).toEqual(['a.md', 'b.md'])
    expect(reopened.active).toBe('a.md')
    expect(reopened.files[0]?.mode).toBe('edit')
  })
})

describe('closeTab', () => {
  it('falls back to the left neighbour, then to the conversation', () => {
    const state = ['a.md', 'b.md', 'c.md'].reduce<TabState>((acc, path) => openTab(acc, path, 'edit'), emptyTabs())
    const closedActive = closeTab(state, 'c.md')
    expect(closedActive.active).toBe('b.md')
    const closedLeftmost = closeTab(closeTab(closedActive, 'b.md'), 'a.md')
    expect(closedLeftmost.files).toHaveLength(0)
    expect(closedLeftmost.active).toBe(CONVERSATION_TAB)
    expect(activeFile(closedLeftmost)).toBeUndefined()
  })

  it('keeps the active tab when another one closes, and ignores an unknown path', () => {
    const state = ['a.md', 'b.md'].reduce<TabState>((acc, path) => openTab(acc, path, 'edit'), emptyTabs())
    expect(closeTab(state, 'a.md').active).toBe('b.md')
    expect(closeTab(state, 'zzz.md')).toBe(state)
    expect(closeTab(state, CONVERSATION_TAB)).toBe(state)
  })
})

describe('activateTab', () => {
  it('moves the active key without touching the open files', () => {
    const state = openTab(emptyTabs(), 'a.md', 'edit')
    expect(activateTab(state, CONVERSATION_TAB)).toEqual({ files: state.files, active: CONVERSATION_TAB })
  })
})

describe('persistence', () => {
  it('round-trips the open paths through storage in open order', () => {
    const mode: TabMode = 'edit'
    const state = ['a.md', 'b.md'].reduce<TabState>((acc, path) => openTab(acc, path, mode), emptyTabs())
    const store = memory()
    persistTabs(activateTab(state, CONVERSATION_TAB), store)
    expect(restoreTabs(store)).toEqual(['a.md', 'b.md'])
  })

  it('answers no tabs for a missing entry and for a hand-broken one', () => {
    expect(restoreTabs(memory())).toEqual([])
    localStorage.setItem(TAB_STORAGE_KEY, 'not json')
    expect(restoreTabs()).toEqual([])
    localStorage.setItem(TAB_STORAGE_KEY, '{"a":1}')
    expect(restoreTabs()).toEqual([])
  })

  it('keeps only string entries', () => {
    localStorage.setItem(TAB_STORAGE_KEY, '["a.md", 7, "b.md"]')
    expect(restoreTabs()).toEqual(['a.md', 'b.md'])
  })

  it('defaults to window.localStorage', () => {
    const state = openTab(emptyTabs(), 'entities/todos.md', 'edit')
    persistTabs(state)
    expect(localStorage.getItem(TAB_STORAGE_KEY)).toBe('["entities/todos.md"]')
    expect(restoreTabs()).toEqual(['entities/todos.md'])
  })
})

describe('fixed tabs (2026-10-15 平铺化)', () => {
  it('exposes the four flat keys, 提议 pinned open among them', () => {
    expect(new Set([TASKS_TAB, INBOX_TAB, SCHEDULE_TAB]).size).toBe(3)
    expect(INBOX_TAB).not.toBe(CONVERSATION_TAB)
    expect(activateTab(emptyTabs(), INBOX_TAB).active).toBe(INBOX_TAB)
    expect(activateTab(emptyTabs(), SCHEDULE_TAB).active).toBe(SCHEDULE_TAB)
    expect(activeFile(activateTab(emptyTabs(), SCHEDULE_TAB))).toBeUndefined()
  })

  it('defaults to all closeable tabs shut, and round-trips an opened one', () => {
    expect(defaultFixedTabs()).toEqual({ tasks: false, schedule: false, insights: false })
    const store = memory()
    persistFixedTabs({ tasks: true, schedule: false, insights: true }, store)
    expect(restoreFixedTabs(store)).toEqual({ tasks: true, schedule: false, insights: true })
  })

  it('answers the default for a missing, hand-broken, or wrongly-typed entry', () => {
    expect(restoreFixedTabs(memory())).toEqual({ tasks: false, schedule: false, insights: false })
    localStorage.setItem(FIXED_TABS_STORAGE_KEY, 'not json')
    expect(restoreFixedTabs()).toEqual({ tasks: false, schedule: false, insights: false })
    localStorage.setItem(FIXED_TABS_STORAGE_KEY, '{"tasks":"yes"}')
    expect(restoreFixedTabs()).toEqual({ tasks: false, schedule: false, insights: false })
    localStorage.setItem(FIXED_TABS_STORAGE_KEY, '[true]')
    expect(restoreFixedTabs()).toEqual({ tasks: false, schedule: false, insights: false })
  })

  it('defaults to window.localStorage and swallows write failures', () => {
    persistFixedTabs({ tasks: true, schedule: false, insights: false })
    expect(JSON.parse(localStorage.getItem(FIXED_TABS_STORAGE_KEY) ?? '')).toEqual({ tasks: true, schedule: false, insights: false })
    expect(restoreFixedTabs()).toEqual({ tasks: true, schedule: false, insights: false })
    // A throwing storage only loses the preference, never breaks the caller.
    const hostile: TabStorage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(() => persistFixedTabs({ tasks: false, schedule: false, insights: false }, hostile)).not.toThrow()
  })
})

describe('tabFor', () => {
  it('derives the label and keeps the given mode', () => {
    expect(tabFor('resources/周报.eml', 'read')).toEqual({ path: 'resources/周报.eml', title: '周报.eml', mode: 'read' })
  })
})

describe('TASKS_TAB', () => {
  it('is a permanent key the free-form active slot carries without special cases', () => {
    expect(TASKS_TAB).not.toBe(CONVERSATION_TAB)
    expect(activateTab(emptyTabs(), TASKS_TAB).active).toBe(TASKS_TAB)
    expect(activeFile(activateTab(emptyTabs(), TASKS_TAB))).toBeUndefined()
  })

  it('is never persisted — only file paths are', () => {
    const state = activateTab(openTab(emptyTabs(), 'a.md', 'edit'), TASKS_TAB)
    const store = memory()
    persistTabs(state, store)
    expect(restoreTabs(store)).toEqual(['a.md'])
  })
})
