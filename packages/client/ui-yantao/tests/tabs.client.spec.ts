// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CONVERSATION_TAB,
  TAB_STORAGE_KEY,
  activateTab, activeFile, closeTab, emptyTabs, openTab, persistTabs, readOnlyPath, restoreTabs, tabFor, tabTitle,
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

describe('tabFor', () => {
  it('derives the label and keeps the given mode', () => {
    expect(tabFor('resources/周报.eml', 'read')).toEqual({ path: 'resources/周报.eml', title: '周报.eml', mode: 'read' })
  })
})
