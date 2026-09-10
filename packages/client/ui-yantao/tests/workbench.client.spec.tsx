// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { KbLinksResult, KbTodosResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { TreeLoader } from '../src/client/Workbench.tsx'
import { IntakeRail, WorkspaceRail, type RailProps } from '../src/client/Workbench.tsx'
import { Frame } from '../src/client/frame/Frame.tsx'
import { CENTER_MIN, RAIL_COLLAPSED, RAIL_DEFAULT, RAIL_MIN, clampRail, solveColumns } from '../src/client/frame/columns.ts'
import { WorkbenchLayout, createPanelSeat } from '../src/client/frame/layout.ts'
import type {
  DirectoryPicker, EntityCreator, ExternalOpener, FileDeleter, FileReader, FileWriter, LinksLoader, RelationSetter,
  RevisionLoader, RootLoader, RootSetter, TodoLoader, TodoWriter,
} from '../src/client/remote.ts'
import { TAB_STORAGE_KEY } from '../src/client/tabs.ts'

afterEach(() => {
  cleanup()
})

// jsdom implements no ResizeObserver; the frame measures itself with one, so
// the spec installs the same no-op stub upstream specs use.
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
  // jsdom lacks pointer capture: emulate per-element so the handles'
  // hasPointerCapture gates pass.
  const captured = new WeakSet<Element>()
  Element.prototype.setPointerCapture = function () { captured.add(this) }
  Element.prototype.releasePointerCapture = function () { captured.delete(this) }
  Element.prototype.hasPointerCapture = function () { return captured.has(this) }
})

const intake: KbTreeSection[] = [
  { id: 'resources', files: [{ name: '周报.eml', path: 'resources/周报.eml' }] },
  { id: 'meetings', files: [{ name: '周会', path: 'entities/meetings/周会.md' }] },
  { id: 'todos', files: [{ name: 'todos', path: 'entities/todos.md' }] },
]

const workspace: KbTreeSection[] = [
  { id: 'projects', files: [{ name: 'dsh 学习', path: 'entities/projects/dsh 学习.md' }] },
  { id: 'areas', files: [{ name: '健康', path: 'entities/areas/健康.md' }] },
  { id: 'people', files: [{ name: '我自己', path: 'entities/people/我自己.md', relation: 'self' }] },
]

/** The todo singleton as the KB writes it. */
const TODO_FILE = '---\ntype: todo\ncreated: 2026-09-08\n---\n\n- [ ] 写下第一个待办\n- [x] 已完成的\n'

/** The same singleton as `yantaoKb.todos` answers it (ADR-0018). */
const TODOS: KbTodosResult = {
  path: 'entities/todos.md',
  text: TODO_FILE,
  items: [
    { done: false, title: '写下第一个待办', body: '', extra: [] },
    { done: true, title: '已完成的', body: '', extra: [] },
  ],
}

/** A loader that resolves with the given sections. */
const loader = (sections: readonly KbTreeSection[]): TreeLoader => () => Promise.resolve(sections)

/** The rail props the frame supplies, with spies standing in for the file channel. */
function railProps(overrides: Partial<RailProps> = {}): RailProps {
  return {
    collapsed: false,
    load: loader(intake),
    refreshKey: 0,
    selection: null,
    onExpand: () => {},
    onOpenFile: () => {},
    onCloseFile: () => {},
    loadTodos: () => Promise.resolve(TODOS),
    writeTodos: () => Promise.resolve({ path: 'entities/todos.md', text: TODO_FILE }),
    createEntity: () => Promise.resolve('entities/areas/新实体.md'),
    read: () => Promise.resolve(''),
    write: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
    setRelation: () => Promise.resolve(),
    workspace: loader(workspace),
    mailFetch: () => Promise.resolve({ since: '', stale: false, hasMore: false, messages: [] }),
    mailMarkRead: () => Promise.resolve({ lastReadAt: '' }),
    analyseMail: () => Promise.resolve({ sessionId: '', title: '', analysis: { people: [], todos: [], projects: [], resources: [] } }),
    ...overrides,
  }
}

describe('solveColumns', () => {
  it('keeps both rails at their preference when the viewport is wide', () => {
    expect(solveColumns(1600, RAIL_DEFAULT, RAIL_DEFAULT)).toEqual({ intake: 280, center: 1040, workspace: 280 })
  })

  it('concedes from the wider rail first, down to RAIL_MIN', () => {
    const cols = solveColumns(1000, 320, 280)
    expect(cols.center).toBeGreaterThanOrEqual(CENTER_MIN - (320 - RAIL_MIN) - (280 - RAIL_MIN) - 1)
    expect(cols.workspace).toBeLessThanOrEqual(320)
    expect(cols.workspace).toBeGreaterThanOrEqual(RAIL_MIN)
  })

  it('renders a collapsed rail as the compact column', () => {
    expect(solveColumns(1600, 0, RAIL_DEFAULT).intake).toBe(RAIL_COLLAPSED)
  })

  it('clamps a dragged width into the rail range', () => {
    expect(clampRail(10)).toBe(RAIL_MIN)
    expect(clampRail(9999)).toBe(420)
  })
})

describe('WorkbenchLayout', () => {
  it('forwards the panel face onto the frame seat', () => {
    const seat = createPanelSeat()
    const toggled = vi.fn()
    const opened = vi.fn()
    const closed = vi.fn()
    seat.toggleIntake = toggled
    seat.openWorkspace = opened
    seat.closeWorkspace = closed
    const layout = new WorkbenchLayout(seat)
    layout.toggleSidebar()
    layout.openDetails()
    layout.closeDetails()
    expect(toggled).toHaveBeenCalledOnce()
    expect(opened).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
  })
})

describe('IntakeRail', () => {
  it('shows the four intake tabs and the 资源 tab first', async () => {
    render(<IntakeRail {...railProps()} />)
    for (const label of ['资源', '待办', '会议', '连接']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(await screen.findByText('周报.eml')).toBeTruthy()
  })

  it('opens a 资源 row read-only', async () => {
    const onOpenFile = vi.fn()
    render(<IntakeRail {...railProps({ onOpenFile })} />)
    fireEvent.click(await screen.findByText('周报.eml'))
    expect(onOpenFile).toHaveBeenCalledWith('resources/周报.eml', 'read')
  })

  it('renders 待办 as a TODO / DONE board loaded through the remote', async () => {
    const loadTodos = vi.fn(() => Promise.resolve(TODOS))
    render(<IntakeRail {...railProps({ loadTodos })} />)
    fireEvent.click(screen.getByText('待办'))
    expect(await screen.findByText('TODO')).toBeTruthy()
    expect(screen.getByText('DONE')).toBeTruthy()
    expect(loadTodos).toHaveBeenCalledOnce()
    expect(await screen.findByText('写下第一个待办')).toBeTruthy()
    expect(await screen.findByText('已完成的')).toBeTruthy()
  })

  it('opens the todo singleton in an editable tab through 打开全文', async () => {
    const onOpenFile = vi.fn()
    render(<IntakeRail {...railProps({ onOpenFile })} />)
    fireEvent.click(screen.getByText('待办'))
    fireEvent.click(await screen.findByText('打开全文'))
    expect(onOpenFile).toHaveBeenCalledWith('entities/todos.md', 'edit')
  })

  it('creates a meeting inline, refreshes the tree, and opens it', async () => {
    const load = vi.fn(loader(intake))
    const createEntity = vi.fn(() => Promise.resolve('entities/meetings/新会议.md'))
    const onOpenFile = vi.fn()
    render(<IntakeRail {...railProps({ load, createEntity, onOpenFile })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.click(await screen.findByText('+ 新建'))
    const input = screen.getByPlaceholderText('会议名称')
    await act(async () => {
      fireEvent.change(input, { target: { value: '新会议' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(createEntity).toHaveBeenCalledWith('meeting', '新会议')
    expect(load).toHaveBeenCalledTimes(2)
    expect(onOpenFile).toHaveBeenCalledWith('entities/meetings/新会议.md', 'edit')
  })

  it('cancels an inline name with Escape', async () => {
    const createEntity = vi.fn()
    render(<IntakeRail {...railProps({ createEntity })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.click(await screen.findByText('+ 新建'))
    const input = screen.getByPlaceholderText('会议名称')
    fireEvent.change(input, { target: { value: '不要建' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('会议名称')).toBeNull()
    expect(createEntity).not.toHaveBeenCalled()
  })

  it('cancels an inline name with the 取消 button', async () => {
    const createEntity = vi.fn()
    render(<IntakeRail {...railProps({ createEntity })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.click(await screen.findByText('+ 新建'))
    fireEvent.click(screen.getByText('取消'))
    expect(screen.queryByPlaceholderText('会议名称')).toBeNull()
    expect(createEntity).not.toHaveBeenCalled()
  })

  it('cancels an inline name with Escape after the input lost the focus', async () => {
    const createEntity = vi.fn()
    render(<IntakeRail {...railProps({ createEntity })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.click(await screen.findByText('+ 新建'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('会议名称')).toBeNull()
    expect(createEntity).not.toHaveBeenCalled()
  })

  it('deletes a meeting row from its right-click menu', async () => {
    const load = vi.fn(loader(intake))
    const deleteFile = vi.fn(() => Promise.resolve())
    const onCloseFile = vi.fn()
    render(<IntakeRail {...railProps({ load, deleteFile, onCloseFile })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.contextMenu(await screen.findByText('周会'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('删除「周会」'))
    await act(async () => {
      fireEvent.click(screen.getByText('删除'))
    })
    expect(deleteFile).toHaveBeenCalledWith('entities/meetings/周会.md')
    expect(load).toHaveBeenCalledTimes(2)
    expect(onCloseFile).toHaveBeenCalledWith('entities/meetings/周会.md')
  })

  it('closes the row menu on Escape', async () => {
    render(<IntakeRail {...railProps({})} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.contextMenu(await screen.findByText('周会'), { clientX: 40, clientY: 60 })
    expect(await screen.findByText('删除「周会」')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByText('删除「周会」')).toBeNull()
  })

  it('surfaces a load failure', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('知识库加载失败')))
    render(<IntakeRail {...railProps({ load: failing })} />)
    expect(await screen.findByTitle('知识库加载失败')).toBeTruthy()
  })

  it('collapses to an expand icon column', () => {
    const onExpand = vi.fn()
    render(<IntakeRail {...railProps({ collapsed: true, onExpand })} />)
    expect(screen.queryByText('资源')).toBeNull()
    fireEvent.click(screen.getByTitle('展开输入栏'))
    expect(onExpand).toHaveBeenCalledOnce()
  })

  it('pulls forward the tab owning the selected file', async () => {
    // The rail opens on 资源; the selected meeting lives under 会议.
    const { container } = render(<IntakeRail {...railProps({ selection: 'entities/meetings/周会.md' })} />)
    expect(await screen.findByText('周会')).toBeTruthy()
    const row = container.querySelector('[data-selected="true"]') as HTMLElement
    expect(row.getAttribute('title')).toBe('entities/meetings/周会.md')
  })

  it('leaves its tab alone when the other rail owns the selection', async () => {
    render(<IntakeRail {...railProps({ selection: 'entities/areas/健康.md' })} />)
    expect(await screen.findByText('周报.eml')).toBeTruthy()
    expect(screen.queryByText('周会')).toBeNull()
  })
})

describe('WorkspaceRail', () => {
  it('switches tabs and creates the tab\'s own entity kind', async () => {
    const createEntity = vi.fn(() => Promise.resolve('entities/projects/新项目.md'))
    const onOpenFile = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), createEntity, onOpenFile })} />)
    // The rail opens on 领域; switching to 项目 swaps the file rows.
    expect(await screen.findByText('健康')).toBeTruthy()
    fireEvent.click(screen.getByText('项目'))
    expect(await screen.findByText('dsh 学习')).toBeTruthy()
    expect(screen.queryByText('健康')).toBeNull()

    fireEvent.click(await screen.findByText('+ 新建'))
    const input = screen.getByPlaceholderText('项目名称')
    await act(async () => {
      fireEvent.change(input, { target: { value: '新项目' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    // Only a person is asked for a relation; every other kind sends none.
    expect(createEntity).toHaveBeenCalledWith('project', '新项目', undefined)
    expect(onOpenFile).toHaveBeenCalledWith('entities/projects/新项目.md', 'edit')
  })

  it('deletes a project row from its right-click menu', async () => {
    const load = vi.fn(loader(workspace))
    const deleteFile = vi.fn(() => Promise.resolve())
    const onCloseFile = vi.fn()
    render(<WorkspaceRail {...railProps({ load, deleteFile, onCloseFile })} />)
    fireEvent.click(await screen.findByText('项目'))
    fireEvent.contextMenu(await screen.findByText('dsh 学习'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('删除「dsh 学习」'))
    await act(async () => {
      fireEvent.click(screen.getByText('删除'))
    })
    expect(deleteFile).toHaveBeenCalledWith('entities/projects/dsh 学习.md')
    expect(load).toHaveBeenCalledTimes(2)
    expect(onCloseFile).toHaveBeenCalledWith('entities/projects/dsh 学习.md')
  })

  it('creates a person with the relation the row offers, 同事 by default', async () => {
    const createEntity = vi.fn(() => Promise.resolve('entities/people/新同事.md'))
    const onOpenFile = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), createEntity, onOpenFile })} />)
    fireEvent.click(await screen.findByText('人物'))
    fireEvent.click(await screen.findByText('+ 新建'))
    const input = screen.getByPlaceholderText('人物名称')
    const select = screen.getByLabelText('关系') as HTMLSelectElement
    expect(select.value).toBe('peer')
    fireEvent.change(select, { target: { value: 'subordinate' } })
    await act(async () => {
      fireEvent.change(input, { target: { value: '新同事' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(createEntity).toHaveBeenCalledWith('person', '新同事', 'subordinate')
    expect(onOpenFile).toHaveBeenCalledWith('entities/people/新同事.md', 'edit')
  })

  it('names a person\'s relation in the rail rather than its wire value', async () => {
    const { container } = render(<WorkspaceRail {...railProps({ load: loader(workspace) })} />)
    fireEvent.click(await screen.findByText('人物'))
    const row = await waitFor(() => {
      const found = container.querySelector('[title="entities/people/我自己.md"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(row.textContent).toBe('我自己 · 自己')
  })

  it('sets a person\'s relation from the row menu, and marks the one it carries', async () => {
    const load = vi.fn(loader(workspace))
    const setRelation = vi.fn(() => Promise.resolve())
    render(<WorkspaceRail {...railProps({ load, setRelation })} />)
    fireEvent.click(await screen.findByText('人物'))
    fireEvent.contextMenu(await screen.findByText('我自己'), { clientX: 40, clientY: 60 })
    const current = await screen.findByText('✓ 自己')
    expect(current.getAttribute('data-relation')).toBe('self')
    await act(async () => {
      fireEvent.click(screen.getByText('下属'))
    })
    expect(setRelation).toHaveBeenCalledWith('entities/people/我自己.md', 'subordinate')
    // The tree reloaded, so the row shows what the file now carries.
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('offers no relation on a row that is not a person', async () => {
    const setRelation = vi.fn(() => Promise.resolve())
    render(<WorkspaceRail {...railProps({ load: loader(workspace), setRelation })} />)
    fireEvent.click(await screen.findByText('领域'))
    fireEvent.contextMenu(await screen.findByText('健康'), { clientX: 40, clientY: 60 })
    expect(await screen.findByText('删除「健康」')).toBeTruthy()
    expect(screen.queryByText('同事')).toBeNull()
  })

  it('opens a workspace row as an editable file', async () => {
    const onOpenFile = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), onOpenFile })} />)
    fireEvent.click(await screen.findByText('健康'))
    expect(onOpenFile).toHaveBeenCalledWith('entities/areas/健康.md', 'edit')
  })

  it('collapses to an expand icon column', () => {
    const onExpand = vi.fn()
    render(<WorkspaceRail {...railProps({ collapsed: true, onExpand })} />)
    expect(screen.queryByText('领域')).toBeNull()
    fireEvent.click(screen.getByTitle('展开工作栏'))
    expect(onExpand).toHaveBeenCalledOnce()
  })

  it('pulls forward the tab owning the selected file', async () => {
    // The rail opens on 领域; the selected project lives under 项目.
    const { container } = render(
      <WorkspaceRail {...railProps({ load: loader(workspace), selection: 'entities/projects/dsh 学习.md' })} />,
    )
    expect(await screen.findByText('dsh 学习')).toBeTruthy()
    const row = container.querySelector('[data-selected="true"]') as HTMLElement
    expect(row.getAttribute('title')).toBe('entities/projects/dsh 学习.md')
  })
})

/** The frame's file channel and first-run faces, all spies. */
interface FrameFaces {
  readonly read: FileReader
  readonly write: FileWriter
  readonly deleteFile: FileDeleter
  readonly setRelation: RelationSetter
  readonly todos: TodoLoader
  readonly writeTodos: TodoWriter
  readonly createEntity: EntityCreator
  readonly root: RootLoader
  readonly setRoot: RootSetter
  readonly pickDirectory: DirectoryPicker
  readonly links: LinksLoader
  readonly revision: RevisionLoader
  readonly openExternal: ExternalOpener
}

/** Build the frame's spies; `read` answers every path with the same content. */
function faces(overrides: Partial<FrameFaces> = {}): FrameFaces {
  return {
    links: path => Promise.resolve({ path, outgoing: [], incoming: [] }),
    read: () => Promise.resolve(TODO_FILE),
    write: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
    setRelation: () => Promise.resolve(),
    todos: () => Promise.resolve(TODOS),
    writeTodos: () => Promise.resolve({ path: 'entities/todos.md', text: TODO_FILE }),
    createEntity: () => Promise.resolve('entities/areas/新实体.md'),
    root: () => Promise.resolve({ root: '/kb', configured: true }),
    setRoot: () => Promise.resolve({ root: '/kb', configured: true, created: [], existing: [] }),
    pickDirectory: () => Promise.resolve(null),
    revision: () => Promise.resolve({ root: '/kb', revision: 0 }),
    openExternal: () => Promise.resolve({ target: '' }),
    ...overrides,
  }
}

/** Render the frame with a stub conversation seat. */
function renderFrame(override: Partial<FrameFaces> = {}, onKbRootChanged: () => void = () => {}): ReactElement {
  const kb = faces(override)
  return (
    <Frame
      renderSlot={key => <div data-seat={key}>{key === 'conversation' ? 'middle' : null}</div>}
      panels={createPanelSeat()}
      intake={loader(intake)}
      workspace={loader(workspace)}
      read={kb.read}
      write={kb.write}
      deleteFile={kb.deleteFile}
      setRelation={kb.setRelation}
      createEntity={kb.createEntity}
      root={kb.root}
      setRoot={kb.setRoot}
      pickDirectory={kb.pickDirectory}
      links={kb.links}
      revision={kb.revision}
      openExternal={kb.openExternal}
      todos={kb.todos}
      mailFetch={() => Promise.resolve({ since: '', stale: false, hasMore: false, messages: [] })}
      mailMarkRead={() => Promise.resolve({ lastReadAt: '' })}
      analyseMail={() => Promise.resolve({ sessionId: '', title: '', analysis: { people: [], todos: [], projects: [], resources: [] } })}
      writeTodos={kb.writeTodos}
      onKbRootChanged={onKbRootChanged}
    />
  )
}

describe('Frame', () => {
  it('renders three columns with the host conversation in the middle', async () => {
    render(renderFrame())
    expect(screen.getByText('middle')).toBeTruthy()
    expect(await screen.findByText('资源')).toBeTruthy()
    expect(await screen.findByText('领域')).toBeTruthy()
  })

  it('opens a rail row as a tab and keeps the conversation mounted but hidden', async () => {
    const { container } = render(renderFrame())
    fireEvent.click(await screen.findByText('健康'))
    // The 对话 tab exists and is no longer active, yet its pane is only
    // hidden — remounting it would drop the host's draft and scroll position.
    const conversation = container.querySelector('[data-tab="conversation"]') as HTMLElement
    expect(conversation.style.display).toBe('none')
    expect(screen.getByText('middle')).toBeTruthy()

    const tab = container.querySelector('[data-tab="entities/areas/健康.md"]') as HTMLElement
    expect(tab.style.display).toBe('flex')
    // ADR-0014: a file opens on its reading view, so the file's markdown shows
    // and the editor is mounted but hidden beside it.
    expect(await within(tab).findByText('写下第一个待办')).toBeTruthy()
    fireEvent.click(screen.getByText('源码'))
    expect(within(tab).getByRole('textbox')).toBeTruthy()
    expect(localStorage.getItem(TAB_STORAGE_KEY)).toBe('["entities/areas/健康.md"]')
  })

  it('keeps the draft across a 阅读 / 源码 switch', async () => {
    const { container } = render(renderFrame())
    fireEvent.click(await screen.findByText('健康'))
    fireEvent.click(screen.getByText('源码'))
    const tab = container.querySelector('[data-tab="entities/areas/健康.md"]') as HTMLElement
    // Wait for the load to land: typing before it would be overwritten by it.
    await within(tab).findByDisplayValue(/写下第一个待办/)
    const editor = within(tab).getByRole('textbox')
    fireEvent.change(editor, { target: { value: '我改了一半' } })
    fireEvent.click(screen.getByText('阅读'))
    // The reading view shows the draft the editor holds — no second load. (The
    // hidden textarea carries the same text, hence the plural query.)
    expect(within(tab).getAllByText('我改了一半').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('源码'))
    expect((tab.querySelector('textarea') as HTMLTextAreaElement).value).toBe('我改了一半')
  })

  it('flips a checkbox in the reading view and saves the file', async () => {
    const write = vi.fn((_path: string, _content: string) => Promise.resolve())
    const { container } = render(renderFrame({ write }))
    fireEvent.click(await screen.findByText('健康'))
    const tab = () => container.querySelector('[data-tab="entities/areas/健康.md"]') as HTMLElement
    await waitFor(() => {
      expect(tab().querySelectorAll('input[type=checkbox]')).toHaveLength(2)
    })
    fireEvent.click(tab().querySelectorAll('input[type=checkbox]')[0] as HTMLInputElement)
    // The write goes through the editor that owns this file's baseline, so the
    // file keeps everything else the same.
    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1)
    })
    expect(write.mock.calls[0]?.[0]).toBe('entities/areas/健康.md')
    expect(write.mock.calls[0]?.[1]).toContain('- [x] 写下第一个待办')
    expect(write.mock.calls[0]?.[1]).toContain('- [x] 已完成的')
  })

  it('opens a [[link]] target and lists what links back', async () => {
    const target = 'entities/areas/健康.md'
    const graph: KbLinksResult = {
      path: target,
      outgoing: [{ target: 'dsh 学习', path: 'entities/projects/dsh 学习.md' }],
      incoming: [{ from: 'entities/people/张三.md', target: '健康' }],
    }
    const { container } = render(renderFrame({
      links: () => Promise.resolve(graph),
      read: path => Promise.resolve(path === target ? '## 状态\n\n关联 [[dsh 学习]]\n' : TODO_FILE),
    }))
    fireEvent.click(await screen.findByText('健康'))
    // The rendered link is the resolved target's name; clicking it opens that file.
    const link = await waitFor(() => {
      const found = screen.getAllByText('dsh 学习')
      const anchor = found.find(node => node.tagName === 'A')
      expect(anchor).toBeTruthy()
      return anchor as HTMLElement
    })
    fireEvent.click(link)
    await waitFor(() => {
      expect(container.querySelector('[data-tab="entities/projects/dsh 学习.md"]')).not.toBeNull()
    })

    fireEvent.click(screen.getByText('反向链接 1'))
    const panel = container.querySelector('[data-backlinks="true"]') as HTMLElement
    fireEvent.click(within(panel).getByText('entities/people/张三.md'))
    await waitFor(() => {
      expect(container.querySelector('[data-tab="entities/people/张三.md"]')).not.toBeNull()
    })
  })

  it('offers no 阅读 / 源码 switch for a read-only original', async () => {
    render(renderFrame())
    fireEvent.click(await screen.findByText('周报.eml'))
    expect(screen.queryByText('源码')).toBeNull()
  })

  it('highlights the active file in its rail and follows the tab switch', async () => {
    const { container } = render(renderFrame())
    const selectedTitle = (): string | null =>
      container.querySelector('[data-selected="true"]')?.getAttribute('title') ?? null

    fireEvent.click(firstOf(await screen.findAllByText('健康')))
    expect(selectedTitle()).toBe('entities/areas/健康.md')

    // 对话 takes the centre back: no file is shown, so no row is highlighted.
    fireEvent.click(screen.getByText('对话'))
    expect(selectedTitle()).toBeNull()

    // Switching back to the file tab re-highlights its row.
    fireEvent.click(container.querySelector('[data-tab-button="entities/areas/健康.md"]') as HTMLElement)
    expect(selectedTitle()).toBe('entities/areas/健康.md')
  })

  it('activates an already-open file instead of opening it twice, and closes it again', async () => {
    const { container } = render(renderFrame())
    // The rail row and the tab label both read 健康; the rail comes first.
    fireEvent.click(firstOf(await screen.findAllByText('健康')))
    fireEvent.click(await screen.findByText('领域'))
    fireEvent.click(firstOf(await screen.findAllByText('健康')))
    expect(container.querySelectorAll('[data-tab="entities/areas/健康.md"]')).toHaveLength(1)

    fireEvent.click(screen.getByTitle('关闭'))
    expect(container.querySelector('[data-tab="entities/areas/健康.md"]')).toBeNull()
    expect((container.querySelector('[data-tab="conversation"]') as HTMLElement).style.display).toBe('flex')
    expect(localStorage.getItem(TAB_STORAGE_KEY)).toBe('[]')
  })

  it('restores the persisted tabs and drops a path that no longer reads', async () => {
    localStorage.setItem(TAB_STORAGE_KEY, '["entities/areas/健康.md", "entities/areas/消失.md"]')
    const { container } = render(renderFrame({
      read: (path: string) => path === 'entities/areas/健康.md'
        ? Promise.resolve('健康内容')
        : Promise.reject(new Error('找不到知识库文件')),
    }))
    expect(await screen.findByTitle('entities/areas/健康.md')).toBeTruthy()
    expect(container.querySelector('[data-tab="entities/areas/消失.md"]')).toBeNull()
    // The restored tab is inactive, so the conversation still shows.
    expect((container.querySelector('[data-tab="conversation"]') as HTMLElement).style.display).toBe('flex')
  })

  it('asks for a directory on first run and reloads both trees once it is set', async () => {
    const setRoot = vi.fn(() => Promise.resolve({ root: '/kb', configured: true, created: ['README.md'], existing: [] }))
    const pickDirectory = vi.fn(() => Promise.resolve('/kb'))
    const load = vi.fn(loader(intake))
    const onKbRootChanged = vi.fn()
    const kb = faces({ setRoot, pickDirectory, root: () => Promise.resolve({ root: '', configured: false }) })
    render(
      <Frame
        renderSlot={key => <div data-seat={key}>middle</div>}
        panels={createPanelSeat()}
        intake={load}
        workspace={loader(workspace)}
        read={kb.read}
        write={kb.write}
        deleteFile={kb.deleteFile}
        setRelation={kb.setRelation}
        createEntity={kb.createEntity}
        root={kb.root}
        setRoot={kb.setRoot}
        pickDirectory={kb.pickDirectory}
        links={kb.links}
        revision={kb.revision}
        openExternal={kb.openExternal}
        todos={kb.todos}
        writeTodos={kb.writeTodos}
        mailFetch={() => Promise.resolve({ since: '', stale: false, hasMore: false, messages: [] })}
        mailMarkRead={() => Promise.resolve({ lastReadAt: '' })}
        analyseMail={() => Promise.resolve({ sessionId: '', title: '', analysis: { people: [], todos: [], projects: [], resources: [] } })}
        onKbRootChanged={onKbRootChanged}
      />,
    )
    expect(await screen.findByText('选择知识库目录')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('选择目录'))
    })
    expect(pickDirectory).toHaveBeenCalledOnce()
    expect(setRoot).toHaveBeenCalledWith('/kb')
    expect(screen.queryByText('选择知识库目录')).toBeNull()
    // The frame bumped its tree key: the intake rail loaded again.
    expect(load).toHaveBeenCalledTimes(2)
    // ADR-0013: the adopted root re-points dsh's own workspace.
    expect(onKbRootChanged).toHaveBeenCalledOnce()
  })

  /** The first of several matches, asserted to exist (noUncheckedIndexedAccess). */
  function firstOf(elements: HTMLElement[]): HTMLElement {
    const [first] = elements
    expect(first).toBeTruthy()
    return first as HTMLElement
  }

  /** Drive one handle through a full pointer gesture. */
  function drag(side: 'intake' | 'workspace', from: number, to: number): void {
    const handle = document.querySelector(`[data-rail-handle="${side}"]`)
    expect(handle).not.toBeNull()
    fireEvent.pointerDown(handle!, { clientX: from, pointerId: 1 })
    fireEvent.pointerMove(handle!, { clientX: to, pointerId: 1 })
    fireEvent.pointerUp(handle!, { clientX: to, pointerId: 1 })
  }

  it('keeps both handles reachable after a rail is dragged to its limit', () => {
    const { container } = render(renderFrame())
    const widthOf = (side: 'intake' | 'workspace'): number =>
      Number.parseFloat(
        (container.querySelector(`[data-rail-handle="${side}"]`) as HTMLElement).style.left,
      )

    // Left rail: drag the handle all the way to the left edge, then back out.
    drag('intake', RAIL_DEFAULT, 0)
    expect(widthOf('intake')).toBe(RAIL_MIN)
    expect(container.querySelector('[data-rail-handle="intake"]')).not.toBeNull()
    drag('intake', 0, 100)
    // The rail grows back (the solver may still concede a little to keep the
    // center above its floor) and the handle is still there to grab.
    expect(widthOf('intake')).toBeGreaterThan(RAIL_MIN)

    // Right rail: the handle sits at viewport - width, so dragging right
    // shrinks the rail; it must come back from its minimum too.
    drag('workspace', RAIL_DEFAULT, 9999)
    expect(container.querySelector('[data-rail-handle="workspace"]')).not.toBeNull()
    drag('workspace', 9999, 8000)
    expect(widthOf('workspace')).toBeLessThan(window.innerWidth - RAIL_MIN)
  })
})
