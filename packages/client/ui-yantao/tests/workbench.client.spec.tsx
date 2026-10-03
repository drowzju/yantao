// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { KbCapabilityDeclarationResult, KbCapabilityRunResult, KbCapabilitySummary, KbLinksResult, KbMailFetchResult, KbTodosResult, KbUnregisteredSkill } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { TreeLoader } from '../src/client/Workbench.tsx'
import { IntakeRail, WorkspaceRail, groupResourceFiles, type IntakeRailProps } from '../src/client/Workbench.tsx'
import { Frame } from '../src/client/frame/Frame.tsx'
import { CENTER_MIN, RAIL_COLLAPSED, RAIL_DEFAULT, RAIL_MIN, clampRail, solveColumns } from '../src/client/frame/columns.ts'
import { WorkbenchLayout, createPanelSeat } from '../src/client/frame/layout.ts'
import type {
  CapabilityDeclarationLoader, CapabilityLoader, CapabilityRunner, DirectoryPicker, EntityArchiver, EntityCreator,
  ExternalOpener, FileReader,
  FileWriter, LinksLoader, MailFetcher, MailMarker, PromptShortcutLister, PromptShortcutSaver, RelationSetter,
  RevisionLoader, RootLoader, RootSetter, ScheduleLister, ScheduleMarker, ScheduleSaver, SessionPrompter,
  ShortcutFiller, TodoLoader, TodoWriter,
} from '../src/client/remote.ts'
import type { ScheduleRunner } from '../src/client/scheduler.ts'
import type { MailAnalyser } from '../src/client/mail-analysis.ts'
import type { RefineRunner } from '../src/client/refine.ts'
import type { ValidateRunner } from '../src/client/validate.ts'
import type { SessionDetailLoader, SessionDetail } from '../src/client/session-detail.ts'
import { CapabilityPanel } from '../src/client/CapabilityPanel.tsx'
import { RESOURCE_DRAG_TYPE } from '../src/client/refine.ts'
import type { Proposal } from '../src/client/proposal.ts'
import { t } from './helpers.client.ts'
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
  { id: 'todos', files: [{ name: 'todos', path: 'entities/todos.md' }] },
]

const workspace: KbTreeSection[] = [
  { id: 'projects', files: [{ name: 'dsh 学习', path: 'entities/projects/dsh 学习.md' }] },
  { id: 'areas', files: [{ name: '健康', path: 'entities/areas/健康.md' }] },
  {
    id: 'people',
    files: [
      { name: '我自己', path: 'entities/people/我自己.md', relation: 'self' },
      { name: '张三', path: 'entities/people/张三.md', relation: 'peer' },
    ],
  },
  { id: 'meetings', files: [{ name: '周会', path: 'entities/meetings/周会.md' }] },
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
function railProps(overrides: Partial<IntakeRailProps> = {}): IntakeRailProps {
  return {
    t,
    collapsed: false,
    load: loader(intake),
    refreshKey: 0,
    selection: null,
    onExpand: () => {},
    onOpenFile: () => {},
    loadTodos: () => Promise.resolve(TODOS),
    writeTodos: () => Promise.resolve({ path: 'entities/todos.md', text: TODO_FILE }),
    createEntity: () => Promise.resolve('entities/areas/新实体.md'),
    read: () => Promise.resolve(''),
    write: () => Promise.resolve(),
    archiveEntity: locator => Promise.resolve({ path: locator, archived: true }),
    restoreEntity: locator => Promise.resolve({ path: locator, archived: false }),
    setRelation: () => Promise.resolve(),
    workspace: loader(workspace),
    mailFetch: () => Promise.resolve({ since: '', stale: false, hasMore: false, messages: [] }),
    mailMarkRead: () => Promise.resolve({ lastReadAt: '' }),
    analyseMail: () => Promise.resolve({ sessionId: '', title: '', analysis: { verdicts: [], people: [], todos: [], projects: [], resources: [], memories: [], newProjects: [], meetings: [], deletions: [], archives: [] } }),
    registerResource: () => Promise.resolve('resources/新资源.pdf'),
    memoryList: () => Promise.resolve({ groups: [] }),
    memoryAdd: () => Promise.resolve({ path: '.dsh/yantao/memory/global.md', entry: { id: 'm1', text: 'x' } }),
    memoryDelete: () => Promise.resolve(),
    memoryProposalList: () => Promise.resolve({ groups: [] }),
    memoryProposalApprove: () => Promise.resolve({
      path: '.dsh/yantao/memory/proposals/global.md',
      targetPath: '.dsh/yantao/memory/global.md',
      entry: { id: 'm1', text: 'x' },
    }),
    memoryProposalDiscard: () => Promise.resolve({ path: '.dsh/yantao/memory/proposals/global.md' }),
    capabilityRuns: [],
    onDistillCapability: () => {},
    distillingRunId: null,
    capabilityList: () => Promise.resolve({ capabilities: [], unregistered: [] }),
    capabilityDeclaration: () => Promise.resolve(DECLARATION),
    capabilityCreate: () => Promise.resolve({ path: '.dsh/skills/新能力' }),
    capabilityAdopt: () => Promise.resolve({ path: '.dsh/skills/新能力' }),
    capabilityRegister: () => Promise.resolve({ path: '.dsh/skills/yantao.json' }),
    promptShortcutList: () => Promise.resolve({ shortcuts: [] }),
    promptShortcutSave: () => Promise.resolve({ shortcuts: [], path: '.dsh/yantao/prompt-shortcuts.json' }),
    fillShortcut: () => {},
    onRunCapability: () => {},
    onRefine: () => {},
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
    for (const label of ['资源', '待办', '记忆', '能力']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(await screen.findByText('周报.eml')).toBeTruthy()
  })

  it('renders the 能力 tab as the capability panel', async () => {
    const capabilityList = vi.fn(() => Promise.resolve({ capabilities: CAPABILITIES, unregistered: [] }))
    render(<IntakeRail {...railProps({ capabilityList })} />)
    fireEvent.click(screen.getByText('能力'))
    await unfoldInventory()
    expect(await screen.findByText('mail')).toBeTruthy()
    // Twice: once at mount for the row menus' 能力 group, once when the tab
    // renders the panel.
    expect(capabilityList).toHaveBeenCalledTimes(2)
  })

  it('opens a 资源 row read-only', async () => {
    const onOpenFile = vi.fn()
    render(<IntakeRail {...railProps({ onOpenFile })} />)
    fireEvent.click(await screen.findByText('周报.eml'))
    expect(onOpenFile).toHaveBeenCalledWith('resources/周报.eml', 'read')
  })

  it('renders 待办 as a board of 待办 / 已完成 panes loaded through the remote', async () => {
    const loadTodos = vi.fn(() => Promise.resolve(TODOS))
    const { container } = render(<IntakeRail {...railProps({ loadTodos })} />)
    fireEvent.click(screen.getByText('待办'))
    // The pane titles are asserted on their block markers: the tab itself is
    // also named 待办, so a global text query would see both.
    await waitFor(() => {
      const blocks = [...container.querySelectorAll('[data-todo-block]')].map(node => node.textContent)
      expect(blocks).toEqual(['待办', '已完成'])
    })
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

  it('leaves its tab alone when the other rail owns the selection', async () => {
    // 会议 now lives in the workspace rail; a selected meeting must not pull
    // any intake tab forward.
    render(<IntakeRail {...railProps({ selection: 'entities/meetings/周会.md' })} />)
    expect(await screen.findByText('周报.eml')).toBeTruthy()
  })

  it('registers a dropped file as a resource and reloads the tree', async () => {
    const registerResource = vi.fn(() => Promise.resolve('resources/三体.epub'))
    const load = vi.fn(loader(intake))
    const { container } = render(<IntakeRail {...railProps({ load, registerResource })} />)
    expect(await screen.findByText('周报.eml')).toBeTruthy()
    const rail = container.firstElementChild as HTMLElement
    const file = new File(['书的内容'], '三体.epub', { type: 'application/octet-stream' })
    await act(async () => {
      fireEvent.dragOver(rail)
      fireEvent.drop(rail, { dataTransfer: { files: [file] } })
    })
    // The bytes go through a FileReader, so the registration lands a tick
    // after the drop.
    await waitFor(() => { expect(registerResource).toHaveBeenCalledOnce() })
    const [droppedName, droppedPayload] = registerResource.mock.calls[0] as unknown as [string, string]
    expect(droppedName).toBe('三体.epub')
    // The content arrives base64-encoded: the file's UTF-8 bytes, not its text.
    const bytes = new TextEncoder().encode('书的内容')
    let binary = ''
    bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
    expect(droppedPayload).toBe(btoa(binary))
    // The tree reloaded and the rail switched to the 资源 tab.
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })

  it('reports a failed drop per file and still registers the rest', async () => {
    const registerResource = vi.fn()
      .mockRejectedValueOnce(new Error('资源「a.pdf」已登记过'))
      .mockResolvedValueOnce('resources/b.pdf')
    const { container } = render(<IntakeRail {...railProps({ registerResource })} />)
    expect(await screen.findByText('周报.eml')).toBeTruthy()
    const rail = container.firstElementChild as HTMLElement
    await act(async () => {
      fireEvent.drop(rail, {
        dataTransfer: { files: [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')] },
      })
    })
    await waitFor(() => { expect(registerResource).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(/a.pdf：资源「a.pdf」已登记过/)).toBeTruthy()
  })

  it('keeps a rail drop away from the conversation\'s document-level drop target', async () => {
    const registerResource = vi.fn(() => Promise.resolve('resources/三体.epub'))
    const { container } = render(<IntakeRail {...railProps({ registerResource })} />)
    expect(await screen.findByText('周报.eml')).toBeTruthy()
    const rail = container.firstElementChild as HTMLElement
    // The conversation's composer listens for file drops at the document
    // level; a drop on the rail registers the resource and nothing else.
    const conversationDrop = vi.fn()
    document.addEventListener('drop', conversationDrop)
    try {
      await act(async () => {
        fireEvent.drop(rail, { dataTransfer: { files: [new File(['x'], 'x.pdf')] } })
      })
    } finally {
      document.removeEventListener('drop', conversationDrop)
    }
    await waitFor(() => { expect(registerResource).toHaveBeenCalledOnce() })
    expect(conversationDrop).not.toHaveBeenCalled()
  })

  it('offers the matching capability on a resource row\'s menu and runs it', async () => {
    const onRunCapability = vi.fn()
    const { container } = render(
      <IntakeRail {...railProps({
        capabilityList: () => Promise.resolve({ capabilities: ROW_CAPABILITIES, unregistered: [] }),
        onRunCapability,
      })} />,
    )
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    const group = await waitFor(() => {
      const found = container.querySelector('[data-row-capabilities="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    // Only the human capability accepting .eml matches; the meeting-scoped one
    // and the agent-only one stay off the menu.
    expect(within(group).getByText('eml-digest')).toBeTruthy()
    expect(within(group).queryByText('meeting-minutes')).toBeNull()
    expect(within(group).queryByText('agent-only')).toBeNull()
    fireEvent.click(within(group).getByText('eml-digest'))
    expect(onRunCapability).toHaveBeenCalledWith(ROW_CAPABILITIES[0], 'resources/周报.eml')
    // Running a capability closes the menu: the gesture's effect lands in the
    // conversation, and a lingering menu reads as "nothing happened".
    await waitFor(() => { expect(container.querySelector('[data-row-menu]')).toBeNull() })
  })

  it('offers no 提炼 on a resource row\'s menu, but 提炼到实体 starts the distill gesture (ADR-0030)', async () => {
    const onRefine = vi.fn()
    render(<IntakeRail {...railProps({ onRefine })} />)
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    // A resource row is not an entity (ADR-0041 决定 2): no archive gesture —
    // and entities being undeletable (决定 8) leaves no delete either.
    expect(await screen.findByText('拷贝链接')).toBeTruthy()
    expect(screen.queryByText('归档')).toBeNull()
    expect(screen.queryByText('提炼')).toBeNull()
    fireEvent.click(screen.getByText('提炼到实体'))
    // The name comes from the path's tail, not the row's (stripped) label.
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'distill',
      resource: { path: 'resources/周报.eml', name: '周报.eml' },
    })
  })

  it('copies the absolute path off a resource row\'s 拷贝链接 menu item', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { container } = render(<IntakeRail {...railProps({ kbRoot: 'D:\\yantao-data\\' })} />)
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('拷贝链接'))
    // The root's trailing separator is trimmed and the join is forward-slashed:
    // a path that pastes cleanly into Explorer, Obsidian or a chat.
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('D:/yantao-data/resources/周报.eml') })
    await waitFor(() => { expect(container.querySelector('[data-row-menu]')).toBeNull() })
  })

  it('copies an entity\'s absolute path too, and falls back to the relative path without a root', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const entity = render(<WorkspaceRail {...railProps({ load: loader(workspace), kbRoot: 'D:/yantao-data' })} />)
    fireEvent.click(screen.getByText('人物'))
    fireEvent.contextMenu(await screen.findByText('张三'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('拷贝链接'))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('D:/yantao-data/entities/people/张三.md') })
    await waitFor(() => { expect(entity.container.querySelector('[data-row-menu]')).toBeNull() })
    entity.unmount()

    // No root known yet: the relative path is still worth having.
    const relative = render(<IntakeRail {...railProps()} />)
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('拷贝链接'))
    await waitFor(() => { expect(writeText).toHaveBeenLastCalledWith('resources/周报.eml') })
    relative.unmount()
  })

  it('hands a resource row\'s KB path to the drag payload (ADR-0029 决定 2)', async () => {
    const setData = vi.fn()
    render(<IntakeRail {...railProps()} />)
    const row = await screen.findByText('周报.eml')
    fireEvent.dragStart(row, { dataTransfer: { setData } })
    expect(setData).toHaveBeenCalledWith(RESOURCE_DRAG_TYPE, 'resources/周报.eml')
  })
})

describe('ResourceTree', () => {
  /** A resource section with a root file and two nested levels (ADR-0028 决定 3). */
  const nestedResources: KbTreeSection[] = [{
    id: 'resources',
    files: [
      { name: '周报.eml', path: 'resources/周报.eml' },
      { name: '报告/笔记.md', path: 'resources/报告/笔记.md' },
      { name: '报告/2026-09/周报.md', path: 'resources/报告/2026-09/周报.md' },
    ],
  }]

  it('groups the flat wire list into a tree whose root keeps the top-level files', () => {
    const root = groupResourceFiles(nestedResources[0]!.files)
    expect(root.dir).toBe('')
    expect(root.files.map(file => file.path)).toEqual(['resources/周报.eml'])
    const 报告 = root.children[0]!
    expect(root.children.map(child => child.dir)).toEqual(['报告'])
    expect(报告.files.map(file => file.path)).toEqual(['resources/报告/笔记.md'])
    const 九月 = 报告.children[0]!
    expect(报告.children.map(child => child.dir)).toEqual(['报告/2026-09'])
    expect(九月.files.map(file => file.path))
      .toEqual(['resources/报告/2026-09/周报.md'])
  })

  it('renders directories collapsed by default; a click expands level by level', async () => {
    render(<IntakeRail {...railProps({ load: loader(nestedResources) })} />)
    // Default folded: only the directory rows and the root-level file show.
    const 报告 = await screen.findByText('▸ 报告')
    expect(报告.getAttribute('data-resource-dir')).toBe('报告')
    expect(报告.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('▾ 2026-09')).toBeNull()
    expect(screen.queryByText('笔记.md')).toBeNull()
    expect(screen.queryByText('周报.md')).toBeNull()
    expect(screen.getByText('周报.eml')).toBeTruthy()
    // Expanding one level reveals the nested directory, itself still folded;
    // the row's label is the segment alone, the full path stays on the data attribute.
    fireEvent.click(报告)
    expect(screen.getByText('▾ 报告').getAttribute('aria-expanded')).toBe('true')
    const 九月 = screen.getByText('▸ 2026-09')
    expect(九月.getAttribute('data-resource-dir')).toBe('报告/2026-09')
    expect(screen.getByText('笔记.md')).toBeTruthy()
    expect(screen.queryByText('周报.md')).toBeNull()
    // The second level unfolds the same way.
    fireEvent.click(九月)
    expect(screen.getByText('▾ 2026-09').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('周报.md')).toBeTruthy()
  })

  it('folds a directory again on the second click', async () => {
    render(<IntakeRail {...railProps({ load: loader(nestedResources) })} />)
    const 报告 = await screen.findByText('▸ 报告')
    fireEvent.click(报告)
    const opened = screen.getByText('▾ 报告')
    expect(opened.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('笔记.md')).toBeTruthy()
    fireEvent.click(opened)
    const folded = screen.getByText('▸ 报告')
    expect(folded.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('笔记.md')).toBeNull()
    expect(screen.getByText('周报.eml')).toBeTruthy()
  })

  it('distills every file under a directory from its right-click menu, however nested (ADR-0030)', async () => {
    const onRefine = vi.fn()
    render(<IntakeRail {...railProps({ load: loader(nestedResources), onRefine })} />)
    // The directory stays folded: the gestures are gathered from the wire
    // list, not from what the tree happens to render.
    fireEvent.contextMenu(await screen.findByText('▸ 报告'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼到实体'))
    expect(onRefine).toHaveBeenCalledTimes(2)
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'distill',
      resource: { path: 'resources/报告/笔记.md', name: '笔记.md' },
    })
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'distill',
      resource: { path: 'resources/报告/2026-09/周报.md', name: '周报.md' },
    })
  })
})

describe('WorkspaceRail', () => {
  it('keeps a file drag over the rail away from the conversation\'s document-level listeners', async () => {
    const { container } = render(<WorkspaceRail {...railProps({ load: loader(workspace) })} />)
    expect(await screen.findByText('健康')).toBeTruthy()
    const rail = container.firstElementChild as HTMLElement
    const documentDragOver = vi.fn()
    document.addEventListener('dragover', documentDragOver)
    try {
      fireEvent.dragOver(rail)
    } finally {
      document.removeEventListener('dragover', documentDragOver)
    }
    expect(documentDragOver).not.toHaveBeenCalled()
  })

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

  it('archives a project row from its right-click menu, without a confirmation step (ADR-0041 决定 6/7)', async () => {
    const load = vi.fn(loader(workspace))
    const archiveEntity = vi.fn((locator: string) => Promise.resolve({ path: locator, archived: true }))
    render(<WorkspaceRail {...railProps({ load, archiveEntity })} />)
    fireEvent.click(await screen.findByText('项目'))
    fireEvent.contextMenu(await screen.findByText('dsh 学习'), { clientX: 40, clientY: 60 })
    await act(async () => {
      fireEvent.click(await screen.findByText('归档'))
    })
    expect(archiveEntity).toHaveBeenCalledWith('entities/projects/dsh 学习.md')
    // The flip only moves the row into the section's 归档 group. The row menu
    // no longer refreshes the tree itself — the host's flipArchive bumps its
    // tree key and the rails reload from that broadcast (exactly once), so in
    // this isolated rail the load ran only at mount.
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('folds archived entities into the section\'s own 归档 group, collapsed by default (ADR-0041 决定 7)', async () => {
    const mixed: KbTreeSection[] = workspace.map(section =>
      section.id === 'projects'
        ? {
          ...section,
          files: [...section.files, { name: '旧项目', path: 'entities/projects/旧项目.md', archived: true }],
        }
        : section)
    render(<WorkspaceRail {...railProps({ load: loader(mixed) })} />)
    fireEvent.click(await screen.findByText('项目'))
    // The active row shows directly; the archived one stays inside its own
    // type's section, folded into the group at its bottom.
    expect(await screen.findByText('dsh 学习')).toBeTruthy()
    expect(screen.queryByText('旧项目')).toBeNull()
    const group = await screen.findByText(/^▸ 归档（1）$/)
    expect(group.getAttribute('data-archive-group')).toBe('projects')
    fireEvent.click(group)
    expect(await screen.findByText('旧项目')).toBeTruthy()
    expect(screen.getByText(/^▾ 归档（1）$/)).toBeTruthy()
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
    fireEvent.contextMenu(await screen.findByText('张三'), { clientX: 40, clientY: 60 })
    const current = await screen.findByText('✓ 同事')
    expect(current.getAttribute('data-relation')).toBe('peer')
    await act(async () => {
      fireEvent.click(screen.getByText('下属'))
    })
    expect(setRelation).toHaveBeenCalledWith('entities/people/张三.md', 'subordinate')
    // The tree reloaded, so the row shows what the file now carries.
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the human\'s tab through a tree reload — a relation write must not yank it back', async () => {
    // A 领域 file is the one the centre pane shows; the human has since moved
    // to 人物 and changes a relation there. The write reloads the tree, the
    // reveal effect re-runs with the same selection — and must leave 人物 up.
    const load = vi.fn(loader(workspace))
    const { rerender } = render(
      <WorkspaceRail {...railProps({ load, selection: 'entities/areas/健康.md' })} />,
    )
    await screen.findByText('健康')
    fireEvent.click(screen.getByText('人物'))
    expect(await screen.findByText('张三')).toBeTruthy()
    await act(async () => {
      rerender(<WorkspaceRail {...railProps({ load, selection: 'entities/areas/健康.md', refreshKey: 1 })} />)
    })
    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.queryByText('健康')).toBeNull()
  })

  it('offers no relation on 我自己 — 自己 is what makes a file the KB\'s owner', async () => {
    const setRelation = vi.fn(() => Promise.resolve())
    render(<WorkspaceRail {...railProps({ load: loader(workspace), setRelation })} />)
    fireEvent.click(await screen.findByText('人物'))
    fireEvent.contextMenu(await screen.findByText('我自己'), { clientX: 40, clientY: 60 })
    expect(await screen.findByText('知识库主人，不可改')).toBeTruthy()
    expect(screen.queryByText('同事')).toBeNull()
  })

  it('offers no relation on a row that is not a person', async () => {
    const setRelation = vi.fn(() => Promise.resolve())
    render(<WorkspaceRail {...railProps({ load: loader(workspace), setRelation })} />)
    fireEvent.click(await screen.findByText('领域'))
    fireEvent.contextMenu(await screen.findByText('健康'), { clientX: 40, clientY: 60 })
    expect(await screen.findByText('归档')).toBeTruthy()
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

  it('offers the matching capability on a project row\'s menu and runs it', async () => {
    const onRunCapability = vi.fn()
    const { container } = render(
      <WorkspaceRail {...railProps({
        load: loader(workspace),
        capabilityList: () => Promise.resolve({ capabilities: ROW_CAPABILITIES, unregistered: [] }),
        onRunCapability,
      })} />,
    )
    fireEvent.click(await screen.findByText('项目'))
    fireEvent.contextMenu(await screen.findByText('dsh 学习'), { clientX: 40, clientY: 60 })
    const group = await waitFor(() => {
      const found = container.querySelector('[data-row-capabilities="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    // Entity rows match by type: the project-scoped capability is offered,
    // the resource-suffixed one is not.
    expect(within(group).getByText('project-review')).toBeTruthy()
    expect(within(group).queryByText('eml-digest')).toBeNull()
    fireEvent.click(within(group).getByText('project-review'))
    expect(onRunCapability).toHaveBeenCalledWith(ROW_CAPABILITIES[2], 'entities/projects/dsh 学习.md')
  })

  it('offers 提炼 on a project row\'s menu and starts the refine gesture (ADR-0029 决定 2)', async () => {
    const onRefine = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), onRefine })} />)
    fireEvent.click(await screen.findByText('项目'))
    fireEvent.contextMenu(await screen.findByText('dsh 学习'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼'))
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'refine',
      entityPath: 'entities/projects/dsh 学习.md',
      entityName: 'dsh 学习',
      entityType: 'project',
    })
  })

  it('starts the 归入 gesture when a library resource drops on a project row', async () => {
    const onRefine = vi.fn()
    const registerResource = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), onRefine, registerResource })} />)
    fireEvent.click(await screen.findByText('项目'))
    const row = await screen.findByText('dsh 学习')
    await act(async () => {
      fireEvent.drop(row, {
        dataTransfer: { getData: (type: string) => (type === RESOURCE_DRAG_TYPE ? 'resources/周报.eml' : ''), files: [] },
      })
    })
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'intake',
      entityPath: 'entities/projects/dsh 学习.md',
      entityName: 'dsh 学习',
      entityType: 'project',
      resource: { path: 'resources/周报.eml', name: '周报.eml' },
    })
    // A library drag is already in the KB: no registration happens.
    expect(registerResource).not.toHaveBeenCalled()
  })

  it('registers an OS file dropped on a project row, then starts the 归入 gesture', async () => {
    const registerResource = vi.fn(() => Promise.resolve('resources/纪要.pdf'))
    const onRefine = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), registerResource, onRefine })} />)
    fireEvent.click(await screen.findByText('项目'))
    const row = await screen.findByText('dsh 学习')
    await act(async () => {
      fireEvent.drop(row, {
        dataTransfer: { getData: () => '', files: [new File(['内容'], '纪要.pdf')] },
      })
    })
    await waitFor(() => { expect(registerResource).toHaveBeenCalledOnce() })
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'intake',
      entityPath: 'entities/projects/dsh 学习.md',
      entityName: 'dsh 学习',
      entityType: 'project',
      resource: { path: 'resources/纪要.pdf', name: '纪要.pdf' },
    })
  })

  // 会议 moved here from the intake rail: a meeting is an entity like any
  // other, so the workspace rail's generic tab machinery carries it.

  it('creates a meeting inline, refreshes the tree, and opens it', async () => {
    const load = vi.fn(loader(workspace))
    const createEntity = vi.fn(() => Promise.resolve('entities/meetings/新会议.md'))
    const onOpenFile = vi.fn()
    render(<WorkspaceRail {...railProps({ load, createEntity, onOpenFile })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.click(await screen.findByText('+ 新建'))
    const input = screen.getByPlaceholderText('会议名称')
    await act(async () => {
      fireEvent.change(input, { target: { value: '新会议' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    // Only a person is asked for a relation; a meeting sends none.
    expect(createEntity).toHaveBeenCalledWith('meeting', '新会议', undefined)
    expect(load).toHaveBeenCalledTimes(2)
    expect(onOpenFile).toHaveBeenCalledWith('entities/meetings/新会议.md', 'edit')
  })

  it('cancels an inline meeting name with Escape', async () => {
    const createEntity = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), createEntity })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.click(await screen.findByText('+ 新建'))
    const input = screen.getByPlaceholderText('会议名称')
    fireEvent.change(input, { target: { value: '不要建' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('会议名称')).toBeNull()
    expect(createEntity).not.toHaveBeenCalled()
  })

  it('cancels an inline meeting name with the 取消 button', async () => {
    const createEntity = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), createEntity })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.click(await screen.findByText('+ 新建'))
    fireEvent.click(screen.getByText('取消'))
    expect(screen.queryByPlaceholderText('会议名称')).toBeNull()
    expect(createEntity).not.toHaveBeenCalled()
  })

  it('archives a meeting row from its right-click menu (ADR-0041 决定 2: meetings are entities too)', async () => {
    const load = vi.fn(loader(workspace))
    const archiveEntity = vi.fn((locator: string) => Promise.resolve({ path: locator, archived: true }))
    render(<WorkspaceRail {...railProps({ load, archiveEntity })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.contextMenu(await screen.findByText('周会'), { clientX: 40, clientY: 60 })
    await act(async () => {
      fireEvent.click(await screen.findByText('归档'))
    })
    expect(archiveEntity).toHaveBeenCalledWith('entities/meetings/周会.md')
    // The tree reload comes from the host's tree-key broadcast, not from the
    // row menu — see the project-row archive test above.
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('restores an archived entity from its row menu — the same seam, the other direction (ADR-0041 决定 6)', async () => {
    const archivedWorkspace: KbTreeSection[] = workspace.map(section =>
      section.id === 'meetings'
        ? { ...section, files: section.files.map(file => ({ ...file, archived: true })) }
        : section)
    const load = vi.fn(loader(archivedWorkspace))
    const restoreEntity = vi.fn((locator: string) => Promise.resolve({ path: locator, archived: false }))
    render(<WorkspaceRail {...railProps({ load, restoreEntity })} />)
    fireEvent.click(screen.getByText('会议'))
    // The archived row lives inside the section's folded 归档 group.
    fireEvent.click(await screen.findByText(/^▸ 归档/))
    fireEvent.contextMenu(await screen.findByText('周会'), { clientX: 40, clientY: 60 })
    await act(async () => {
      fireEvent.click(await screen.findByText('还原'))
    })
    expect(restoreEntity).toHaveBeenCalledWith('entities/meetings/周会.md')
    // The tree reload comes from the host's tree-key broadcast, not from the
    // row menu — see the project-row archive test above.
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('closes a meeting row\'s menu on Escape', async () => {
    render(<WorkspaceRail {...railProps({ load: loader(workspace) })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.contextMenu(await screen.findByText('周会'), { clientX: 40, clientY: 60 })
    expect(await screen.findByText('归档')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByText('归档')).toBeNull()
  })

  it('offers the matching capability on a meeting row\'s menu', async () => {
    const { container } = render(
      <WorkspaceRail {...railProps({
        load: loader(workspace),
        capabilityList: () => Promise.resolve({ capabilities: ROW_CAPABILITIES, unregistered: [] }),
      })} />,
    )
    fireEvent.click(screen.getByText('会议'))
    fireEvent.contextMenu(await screen.findByText('周会'), { clientX: 40, clientY: 60 })
    const group = await waitFor(() => {
      const found = container.querySelector('[data-row-capabilities="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(within(group).getByText('meeting-minutes')).toBeTruthy()
    expect(within(group).queryByText('eml-digest')).toBeNull()
  })

  it('offers 提炼 on a meeting row\'s menu and starts the refine gesture (ADR-0029 决定 2)', async () => {
    const onRefine = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), onRefine })} />)
    fireEvent.click(screen.getByText('会议'))
    fireEvent.contextMenu(await screen.findByText('周会'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼'))
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'refine',
      entityPath: 'entities/meetings/周会.md',
      entityName: '周会',
      entityType: 'meeting',
    })
  })

  it('starts the 归入 gesture when a library resource drops on a meeting row', async () => {
    const onRefine = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), onRefine })} />)
    fireEvent.click(screen.getByText('会议'))
    const row = await screen.findByText('周会')
    await act(async () => {
      fireEvent.drop(row, {
        dataTransfer: { getData: (type: string) => (type === RESOURCE_DRAG_TYPE ? 'resources/周报.eml' : ''), files: [] },
      })
    })
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'intake',
      entityPath: 'entities/meetings/周会.md',
      entityName: '周会',
      entityType: 'meeting',
      resource: { path: 'resources/周报.eml', name: '周报.eml' },
    })
  })

  it('registers an OS file dropped on a meeting row, then starts the 归入 gesture', async () => {
    const registerResource = vi.fn(() => Promise.resolve('resources/纪要.pdf'))
    const onRefine = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), registerResource, onRefine })} />)
    fireEvent.click(screen.getByText('会议'))
    const row = await screen.findByText('周会')
    await act(async () => {
      fireEvent.drop(row, {
        dataTransfer: { getData: () => '', files: [new File(['内容'], '纪要.pdf')] },
      })
    })
    await waitFor(() => { expect(registerResource).toHaveBeenCalledOnce() })
    expect(onRefine).toHaveBeenCalledWith({
      mode: 'intake',
      entityPath: 'entities/meetings/周会.md',
      entityName: '周会',
      entityType: 'meeting',
      resource: { path: 'resources/纪要.pdf', name: '纪要.pdf' },
    })
  })

  it('rejects a multi-file drop on a meeting row with a message (ADR-0029 台账 #4)', async () => {
    const registerResource = vi.fn()
    const onRefine = vi.fn()
    render(<WorkspaceRail {...railProps({ load: loader(workspace), registerResource, onRefine })} />)
    fireEvent.click(screen.getByText('会议'))
    const row = await screen.findByText('周会')
    await act(async () => {
      fireEvent.drop(row, {
        dataTransfer: { getData: () => '', files: [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')] },
      })
    })
    expect(await screen.findByText('一次只归入一个文件。')).toBeTruthy()
    expect(registerResource).not.toHaveBeenCalled()
    expect(onRefine).not.toHaveBeenCalled()
  })
})

/** Two capabilities as `capabilityList` answers them (ADR-0021). */
const CAPABILITIES: KbCapabilitySummary[] = [
  { name: 'mail', description: '读 Outlook 邮件', source: 'project', entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'] },
  { name: 'paper-digest', description: '摘要一篇论文', source: 'project', entry: 'scripts/entry.py', runtime: 'python', invocation: ['human'] },
]

/** The declaration stub every detail view gets (ADR-0043 决定 7); the section's own assertions live in capability-panel.client.spec.tsx. */
const DECLARATION: KbCapabilityDeclarationResult = {
  name: 'mail',
  sidecar: { present: false, problem: 'sidecar 不存在：目录内没有 yantao.json，SKILL.md 也没有 metadata.yantao 段。' },
  route: { registered: false },
  agentInvocable: false,
}

/** Capabilities for the row-menu matching tests (ADR-0021 决定 7, ADR-0023 决定 2). */
const ROW_CAPABILITIES: KbCapabilitySummary[] = [
  { name: 'eml-digest', description: '读一封邮件', source: 'project', entry: 'scripts/entry.py', runtime: 'python', invocation: ['human'], appliesTo: { resource: ['.eml'] } },
  { name: 'meeting-minutes', description: '整理会议纪要', source: 'project', entry: 'scripts/entry.py', runtime: 'python', invocation: ['human'], appliesTo: { entity: ['meeting'] } },
  { name: 'project-review', description: '回顾一个项目', source: 'project', entry: 'scripts/entry.py', runtime: 'python', invocation: ['human'], appliesTo: { entity: ['project'] } },
  { name: 'agent-only', description: '只给智能体调用', source: 'project', entry: 'scripts/entry.py', runtime: 'python', invocation: ['agent'], appliesTo: { resource: ['.eml'] } },
]

/** The capability panel's faces, all spies. */
function capabilityProps(overrides: Partial<Parameters<typeof CapabilityPanel>[0]> = {}): Parameters<typeof CapabilityPanel>[0] {
  return {
    t,
    load: () => Promise.resolve({ capabilities: CAPABILITIES, unregistered: [] }),
    loadDeclaration: () => Promise.resolve(DECLARATION),
    create: () => Promise.resolve({ path: '.dsh/skills/新能力' }),
    adopt: () => Promise.resolve({ path: '.dsh/skills/新能力' }),
    register: () => Promise.resolve({ path: '.dsh/skills/yantao.json' }),
    mail: () => <div data-mail-stub="true">邮件面板</div>,
    loadShortcuts: () => Promise.resolve({ shortcuts: [] }),
    saveShortcuts: () => Promise.resolve({ shortcuts: [], path: '.dsh/yantao/prompt-shortcuts.json' }),
    fillShortcut: () => {},
    runs: [],
    onDistill: () => {},
    distilling: null,
    ...overrides,
  }
}

/**
 * Unfold the capability inventory (ADR-0040: the 能力 tab's first screen is
 * the 惯用提示词 list; the inventory sits behind this toggle by default).
 */
async function unfoldInventory(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /能力清单/ }))
}

describe('CapabilityPanel', () => {
  it('lists the registered capabilities with their descriptions', async () => {
    render(<CapabilityPanel {...capabilityProps()} />)
    await unfoldInventory()
    expect(await screen.findByText('mail')).toBeTruthy()
    expect(screen.getByText('读 Outlook 邮件')).toBeTruthy()
    expect(screen.getByText('paper-digest')).toBeTruthy()
    expect(screen.getByText('+ 新建能力')).toBeTruthy()
  })

  it('opens the mail capability\'s detail with the connector panel embedded', async () => {
    render(<CapabilityPanel {...capabilityProps()} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('mail'))
    expect(await screen.findByText('邮件面板')).toBeTruthy()
    expect(screen.getByText('← 返回清单')).toBeTruthy()
  })

  it('hands the capability\'s persisted state to the mail detail', async () => {
    const capabilities = [{ ...CAPABILITIES[0]!, state: { lastReadAt: '2026-01-31T00:00:00+00:00' } }]
    const mail = vi.fn(() => <div data-mail-stub="true">邮件面板</div>)
    render(<CapabilityPanel {...capabilityProps({ load: () => Promise.resolve({ capabilities, unregistered: [] }), mail })} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('mail'))
    await screen.findByText('邮件面板')
    expect(mail).toHaveBeenCalledWith({ lastReadAt: '2026-01-31T00:00:00+00:00' })
  })

  it('returns to the list from a detail', async () => {
    render(<CapabilityPanel {...capabilityProps()} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('paper-digest'))
    fireEvent.click(await screen.findByText('← 返回清单'))
    expect(await screen.findByText('mail')).toBeTruthy()
  })

  it('scaffolds a new capability through 新建能力 and opens its detail', async () => {
    const capabilities = [...CAPABILITIES]
    const load = vi.fn(() => Promise.resolve({ capabilities, unregistered: [] }))
    const create = vi.fn((name: string) => {
      capabilities.push({ name, description: '', source: 'project', entry: 'scripts/entry.py', runtime: 'python', invocation: ['human'] })
      return Promise.resolve({ path: `.dsh/skills/${name}` })
    })
    render(<CapabilityPanel {...capabilityProps({ load, create })} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('+ 新建能力'))
    const input = screen.getByPlaceholderText('能力名称（如 paper-digest）')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'paper-digest' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(create).toHaveBeenCalledWith('paper-digest')
    expect(await screen.findByText('paper-digest')).toBeTruthy()
    expect(screen.getByText('← 返回清单')).toBeTruthy()
  })

  it('surfaces a refused scaffold as the row\'s error', async () => {
    const create = vi.fn(() => Promise.reject(new Error('能力名称不合规范')))
    render(<CapabilityPanel {...capabilityProps({ create })} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('+ 新建能力'))
    const input = screen.getByPlaceholderText('能力名称（如 paper-digest）')
    await act(async () => {
      fireEvent.change(input, { target: { value: '大写' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(await screen.findByText('能力名称不合规范')).toBeTruthy()
    expect(screen.queryByText('← 返回清单')).toBeNull()
  })

  /** One 未注册 row as `capabilityList` reports it (ADR-0025 决定 1). */
  const unregistered = (overrides: Partial<KbUnregisteredSkill> = {}): KbUnregisteredSkill => ({
    name: 'notes-helper',
    description: '整理笔记',
    source: 'user',
    directory: 'C:/Users/me/.dsh/skills/notes-helper',
    userInvocable: true,
    flat: false,
    ...overrides,
  })

  /** One flat 未注册 row: no directory to carry a sidecar. */
  const flatUnregistered = (name: string, extra: Partial<KbUnregisteredSkill> = {}): KbUnregisteredSkill => ({
    name,
    description: '扁平技能',
    source: 'user',
    userInvocable: true,
    flat: true,
    ...extra,
  })

  it('lists 未注册 skills with their grey reasons and never opens a confirm for a greyed row', async () => {
    const rows = [
      unregistered(),
      flatUnregistered('quick'),
      unregistered({ name: 'hidden', userInvocable: false }),
    ]
    render(<CapabilityPanel {...capabilityProps({ load: () => Promise.resolve({ capabilities: [], unregistered: rows }) })} />)
    await unfoldInventory()
    expect(await screen.findByText('未注册技能（ADR-0025）')).toBeTruthy()
    expect(screen.getByText('notes-helper')).toBeTruthy()
    expect(screen.getByText('扁平单文件技能不支持采纳')).toBeTruthy()
    expect(screen.getByText('SKILL.md 已标记 user-invocable: false')).toBeTruthy()
    fireEvent.click(screen.getByText('quick'))
    expect(screen.queryByText(/采纳「quick」/)).toBeNull()
  })

  it('adopts through the inline confirm: target path, route preview, then the detail', async () => {
    const adopt = vi.fn(() => {
      capabilities.push({ name: 'notes-helper', description: '整理笔记', source: 'user', invocation: ['human'] })
      return Promise.resolve({ path: '.dsh/skills/notes-helper' })
    })
    const capabilities: KbCapabilitySummary[] = []
    const load = vi.fn(() => Promise.resolve({ capabilities, unregistered: [unregistered()] }))
    render(<CapabilityPanel {...capabilityProps({ load, adopt })} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('notes-helper'))
    expect(await screen.findByText(/采纳「notes-helper」/)).toBeTruthy()
    expect(screen.getByText(/\.dsh\/skills\/notes-helper\//)).toBeTruthy()
    expect(screen.getByText('{"path":"notes-helper","invocation":["human"]}')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('采纳')) })
    expect(adopt).toHaveBeenCalledWith('notes-helper')
    expect(await screen.findByText('← 返回清单')).toBeTruthy()
  })

  it('warns in the confirm when the source carries its own declaration', async () => {
    const rows = [unregistered({ sidecar: { entry: 'run.py', invocation: ['human', 'agent'] } })]
    render(<CapabilityPanel {...capabilityProps({ load: () => Promise.resolve({ capabilities: [], unregistered: rows }) })} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('notes-helper'))
    expect(await screen.findByText(/外带声明不会静默生效/)).toBeTruthy()
  })

  it('registers an in-KB skill through the guided dialog, human-only by default', async () => {
    const capabilities: KbCapabilitySummary[] = []
    const register = vi.fn(() => {
      capabilities.push({ name: 'notes-helper', description: '整理笔记', source: 'custom', invocation: ['human'] })
      return Promise.resolve({ path: '.dsh/skills/yantao.json' })
    })
    const rows = [unregistered({ inKb: true, reason: '能力「notes-helper」没有能力声明（yantao.json 或 SKILL.md 的 metadata.yantao 段）。' })]
    const load = vi.fn(() => Promise.resolve({ capabilities, unregistered: rows }))
    render(<CapabilityPanel {...capabilityProps({ load, register })} />)
    await unfoldInventory()
    expect(await screen.findByText(/没有能力声明/)).toBeTruthy()
    fireEvent.click(screen.getByText('notes-helper'))
    expect(await screen.findByText(/注册「notes-helper」为能力/)).toBeTruthy()
    expect(screen.getByText('{"path":"notes-helper","invocation":["human"]}')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('注册')) })
    expect(register).toHaveBeenCalledWith('notes-helper', { agentInvoke: false, resourceMenu: false, selectionMenu: false })
    expect(await screen.findByText('← 返回清单')).toBeTruthy()
  })

  it('carries the dialog checkboxes into the register reach', async () => {
    const register = vi.fn(() => Promise.resolve({ path: '.dsh/skills/yantao.json' }))
    const rows = [unregistered({ name: 'scripted', inKb: true, reason: '能力「scripted」没有能力声明。' })]
    render(<CapabilityPanel {...capabilityProps({ load: () => Promise.resolve({ capabilities: [], unregistered: rows }), register })} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('scripted'))
    await screen.findByText(/注册「scripted」为能力/)
    fireEvent.click(screen.getByRole('checkbox', { name: /允许 agent 调用/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /所有资源的右键菜单/ }))
    expect(screen.getByText('{"path":"scripted","invocation":["human","agent"],"appliesTo":{"resource":true}}')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('注册')) })
    expect(register).toHaveBeenCalledWith('scripted', { agentInvoke: true, resourceMenu: true, selectionMenu: false })
  })

  it('announces plugin routing in the register dialog and registers under the repository name', async () => {
    const register = vi.fn(() => Promise.resolve({ path: '.dsh/skills/yantao.json' }))
    const rows = [unregistered({
      name: 'diagram-design-repo',
      description: '插件仓库，内含技能：diagram-design',
      inKb: true,
      plugin: true,
      pluginSkills: ['diagram-design'],
      reason: '插件仓库：顶层没有 SKILL.md，注册将在中央路由 .dsh/skills/yantao.json 为内含技能各写一条路由',
    })]
    render(<CapabilityPanel {...capabilityProps({ load: () => Promise.resolve({ capabilities: [], unregistered: rows }), register })} />)
    await unfoldInventory()
    fireEvent.click(await screen.findByText('diagram-design-repo'))
    expect(await screen.findByText(/注册「diagram-design-repo」为能力/)).toBeTruthy()
    expect(screen.getByText(/这是插件仓库：注册将在/)).toBeTruthy()
    expect(screen.getByText(/各写一条路由，仓库目录原地保留/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('注册')) })
    expect(register).toHaveBeenCalledWith('diagram-design-repo', { agentInvoke: false, resourceMenu: false, selectionMenu: false })
  })

  it('never opens the register dialog for a greyed in-KB row', async () => {
    const rows = [flatUnregistered('quick', { inKb: true, reason: '能力「quick」没有能力声明。' })]
    render(<CapabilityPanel {...capabilityProps({ load: () => Promise.resolve({ capabilities: [], unregistered: rows }) })} />)
    await unfoldInventory()
    await screen.findByText('未注册技能（ADR-0025）')
    expect(screen.getByText('扁平单文件技能没有自己的目录，无法注册为能力')).toBeTruthy()
    fireEvent.click(screen.getByText('quick'))
    expect(screen.queryByText(/注册「quick」为能力/)).toBeNull()
  })
})

/** The frame's file channel and first-run faces, all spies. */
interface FrameFaces {
  readonly read: FileReader
  readonly write: FileWriter
  readonly archiveEntity: EntityArchiver
  readonly restoreEntity: EntityArchiver
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
  readonly promptSession: SessionPrompter
  readonly capabilityList: CapabilityLoader
  readonly capabilityDeclaration: CapabilityDeclarationLoader
  readonly capabilityRun: CapabilityRunner
  readonly promptShortcutList: PromptShortcutLister
  readonly promptShortcutSave: PromptShortcutSaver
  readonly fillShortcut: ShortcutFiller
  readonly scheduleList: ScheduleLister
  readonly scheduleSave: ScheduleSaver
  readonly scheduleMark: ScheduleMarker
  readonly runSchedule: ScheduleRunner
  readonly mailFetch: MailFetcher
  readonly mailMarkRead: MailMarker
  readonly analyseMail: MailAnalyser
  readonly refine: RefineRunner
  readonly validate: ValidateRunner
  readonly sessionDetail: SessionDetailLoader
}

/** Build the frame's spies; `read` answers every path with the same content. */
function faces(overrides: Partial<FrameFaces> = {}): FrameFaces {
  return {
    links: path => Promise.resolve({ path, outgoing: [], incoming: [] }),
    read: () => Promise.resolve(TODO_FILE),
    write: () => Promise.resolve(),
    archiveEntity: locator => Promise.resolve({ path: locator, archived: true }),
    restoreEntity: locator => Promise.resolve({ path: locator, archived: false }),
    setRelation: () => Promise.resolve(),
    todos: () => Promise.resolve(TODOS),
    writeTodos: () => Promise.resolve({ path: 'entities/todos.md', text: TODO_FILE }),
    createEntity: () => Promise.resolve('entities/areas/新实体.md'),
    root: () => Promise.resolve({ root: '/kb', configured: true }),
    setRoot: () => Promise.resolve({ root: '/kb', configured: true, created: [], existing: [] }),
    pickDirectory: () => Promise.resolve(null),
    revision: () => Promise.resolve({ root: '/kb', revision: 0 }),
    openExternal: () => Promise.resolve({ target: '' }),
    promptSession: () => Promise.resolve(),
    sessionDetail: () => Promise.resolve({ items: [], usage: null }),
    capabilityList: () => Promise.resolve({ capabilities: [], unregistered: [] }),
    capabilityDeclaration: () => Promise.resolve(DECLARATION),
    capabilityRun: () => Promise.resolve({ name: '', runAt: '', artifacts: [] }),
    promptShortcutList: () => Promise.resolve({ shortcuts: [] }),
    promptShortcutSave: () => Promise.resolve({ shortcuts: [], path: '.dsh/yantao/prompt-shortcuts.json' }),
    fillShortcut: () => {},
    scheduleList: () => Promise.resolve({ schedules: [] }),
    scheduleSave: () => Promise.resolve({ schedules: [], path: '.dsh/yantao/schedules.json' }),
    scheduleMark: () => Promise.resolve({ schedules: [], path: '.dsh/yantao/schedules.json' }),
    runSchedule: () => Promise.resolve({ sessionId: '', answer: '' }),
    mailFetch: () => Promise.resolve({ since: '', stale: false, hasMore: false, messages: [] }),
    mailMarkRead: () => Promise.resolve({ lastReadAt: '' }),
    analyseMail: () => Promise.resolve({ sessionId: '', title: '', analysis: { verdicts: [], people: [], todos: [], projects: [], resources: [], memories: [], newProjects: [], meetings: [], deletions: [], archives: [] } }),
    refine: () => Promise.resolve({ sessionId: '', title: '', relevant: true, reason: '' }),
    validate: () => Promise.resolve({
      sessionId: '', title: '', reason: '',
      preScan: { entities: 0, orphans: [], broken: [] },
      stats: { entities: 0, prescan: 0, findings: 0, filtered: 0, tokens: 0, elapsedMs: 0 },
    }),
    ...overrides,
  }
}

/** Render the frame with a stub conversation seat. */
function renderFrame(override: Partial<FrameFaces> = {}, onKbRootChanged: () => void = () => {}): ReactElement {
  const kb = faces(override)
  return (
    <Frame
      t={t}
      renderSlot={key => <div data-seat={key}>{key === 'conversation' ? 'middle' : null}</div>}
      panels={createPanelSeat()}
      intake={loader(intake)}
      workspace={loader(workspace)}
      read={kb.read}
      write={kb.write}
      archiveEntity={kb.archiveEntity}
      restoreEntity={kb.restoreEntity}
      setRelation={kb.setRelation}
      createEntity={kb.createEntity}
      root={kb.root}
      setRoot={kb.setRoot}
      pickDirectory={kb.pickDirectory}
      links={kb.links}
      revision={kb.revision}
      openExternal={kb.openExternal}
      todos={kb.todos}
      mailFetch={kb.mailFetch}
      mailMarkRead={kb.mailMarkRead}
      analyseMail={kb.analyseMail}
      refine={kb.refine}
      validate={kb.validate}
      registerResource={() => Promise.resolve('resources/新资源.pdf')}
      memoryList={() => Promise.resolve({ groups: [] })}
      memoryAdd={() => Promise.resolve({ path: '.dsh/yantao/memory/global.md', entry: { id: 'm1', text: 'x' } })}
      memoryDelete={() => Promise.resolve()}
      capabilityList={kb.capabilityList}
      capabilityDeclaration={kb.capabilityDeclaration}
      capabilityCreate={() => Promise.resolve({ path: '.dsh/skills/新能力' })}
      capabilityAdopt={() => Promise.resolve({ path: '.dsh/skills/新能力' })}
      capabilityRegister={() => Promise.resolve({ path: '.dsh/skills/yantao.json' })}
      capabilityRun={kb.capabilityRun}
      promptSession={kb.promptSession}
      promptShortcutList={kb.promptShortcutList}
      promptShortcutSave={kb.promptShortcutSave}
      fillShortcut={kb.fillShortcut}
      scheduleList={kb.scheduleList}
      scheduleSave={kb.scheduleSave}
      scheduleMark={kb.scheduleMark}
      runSchedule={kb.runSchedule}
      sessionDetail={kb.sessionDetail}
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

  it('archives an open entity from its detail view, flipping the button to 还原 (ADR-0041 决定 7)', async () => {
    const archiveEntity = vi.fn((locator: string) => Promise.resolve({ path: locator, archived: true }))
    const { container } = render(renderFrame({ archiveEntity }))
    fireEvent.click(await screen.findByText('健康'))
    const tab = container.querySelector('[data-tab="entities/areas/健康.md"]') as HTMLElement
    // The button rides the reading view's own bar, next to 在 Obsidian 中打开.
    const button = await within(tab).findByText('归档')
    expect(button.getAttribute('data-archive-toggle')).toBe('true')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(archiveEntity).toHaveBeenCalledWith('entities/areas/健康.md')
    // The label flips from the RPC's answer — the draft's envelope is stale.
    expect(await within(tab).findByText('还原')).toBeTruthy()
  })

  it('shows 还原 on an archived entity\'s detail view and restores it', async () => {
    const restoreEntity = vi.fn((locator: string) => Promise.resolve({ path: locator, archived: false }))
    const { container } = render(renderFrame({
      restoreEntity,
      read: () => Promise.resolve('---\ntype: area\ncreated: 2026-09-08\narchive: true\n---\n\n## 状态\n\n旧\n'),
    }))
    fireEvent.click(await screen.findByText('健康'))
    const tab = container.querySelector('[data-tab="entities/areas/健康.md"]') as HTMLElement
    const button = await within(tab).findByText('还原')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(restoreEntity).toHaveBeenCalledWith('entities/areas/健康.md')
    expect(await within(tab).findByText('归档')).toBeTruthy()
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
        t={t}
        renderSlot={key => <div data-seat={key}>middle</div>}
        panels={createPanelSeat()}
        intake={load}
        workspace={loader(workspace)}
        read={kb.read}
        write={kb.write}
        archiveEntity={kb.archiveEntity}
        restoreEntity={kb.restoreEntity}
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
        analyseMail={() => Promise.resolve({ sessionId: '', title: '', analysis: { verdicts: [], people: [], todos: [], projects: [], resources: [], memories: [], newProjects: [], meetings: [], deletions: [], archives: [] } })}
        refine={() => Promise.resolve({ sessionId: '', title: '', relevant: true, reason: '' })}
        validate={() => Promise.resolve({
          sessionId: '', title: '', reason: '',
          preScan: { entities: 0, orphans: [], broken: [] },
          stats: { entities: 0, prescan: 0, findings: 0, filtered: 0, tokens: 0, elapsedMs: 0 },
        })}
        registerResource={() => Promise.resolve('resources/新资源.pdf')}
        memoryList={() => Promise.resolve({ groups: [] })}
        memoryAdd={() => Promise.resolve({ path: '.dsh/yantao/memory/global.md', entry: { id: 'm1', text: 'x' } })}
        memoryDelete={() => Promise.resolve()}
        capabilityList={() => Promise.resolve({ capabilities: [], unregistered: [] })}
        capabilityCreate={() => Promise.resolve({ path: '.dsh/skills/新能力' })}
        capabilityAdopt={() => Promise.resolve({ path: '.dsh/skills/新能力' })}
        capabilityRegister={() => Promise.resolve({ path: '.dsh/skills/yantao.json' })}
        capabilityRun={() => Promise.resolve({ name: '', runAt: '', artifacts: [] })}
        promptSession={kb.promptSession}
        promptShortcutList={kb.promptShortcutList}
        promptShortcutSave={kb.promptShortcutSave}
        fillShortcut={kb.fillShortcut}
        scheduleList={kb.scheduleList}
        scheduleSave={kb.scheduleSave}
        runSchedule={kb.runSchedule}
        sessionDetail={() => Promise.resolve({ items: [], usage: null })}
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

  it('sends an instruction capability as the `/name @path` gesture message (ADR-0026 决定 4)', async () => {
    const promptSession = vi.fn(() => Promise.resolve())
    const capabilityRun = vi.fn(() => Promise.resolve({ name: 'eml-triage', runAt: '', artifacts: [] }))
    const { container } = render(renderFrame({
      promptSession,
      capabilityList: () => Promise.resolve({
        capabilities: [{
          name: 'eml-triage', description: '分诊一封邮件', source: 'project', invocation: ['human'],
          appliesTo: { resource: ['.eml'] },
        }],
        unregistered: [],
      }),
      capabilityRun,
    }))
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    const group = await waitFor(() => {
      const found = container.querySelector('[data-row-capabilities="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    fireEvent.click(within(group).getByText('eml-triage'))
    // The gesture is a plain user message — no SKILL.md fetch, no client-side
    // concatenation; the controller's pre-step injects the body (ADR-0025
    // 决定 3), and the transcript itself is the notification.
    await waitFor(() => { expect(promptSession).toHaveBeenCalledWith('/eml-triage @resources/周报.eml') })
    expect(capabilityRun).not.toHaveBeenCalled()
  })

  it('reports a failed session prompt in the frame\'s notice', async () => {
    const promptSession = vi.fn(() => Promise.reject(new Error('会话通道不可用，无法发送。')))
    const { container } = render(renderFrame({
      promptSession,
      capabilityList: () => Promise.resolve({
        capabilities: [{
          name: 'eml-triage', description: '分诊一封邮件', source: 'project', invocation: ['human'],
          appliesTo: { resource: ['.eml'] },
        }],
        unregistered: [],
      }),
    }))
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    const group = await waitFor(() => {
      const found = container.querySelector('[data-row-capabilities="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    fireEvent.click(within(group).getByText('eml-triage'))
    expect(await screen.findByText('发送失败：会话通道不可用，无法发送。')).toBeTruthy()
  })

  it('lists a running capability in the 任务 tab and cancels it from there (ADR-0031)', async () => {
    let kill: (() => void) | null = null
    const capabilityRun = vi.fn((_args: unknown, signal?: AbortSignal): Promise<KbCapabilityRunResult> =>
      new Promise((_resolve, reject) => {
        kill = () => { reject(new Error('aborted')) }
        signal?.addEventListener('abort', () => { kill?.() }, { once: true })
      }))
    const { container } = render(renderFrame({
      capabilityList: () => Promise.resolve({
        capabilities: [{
          name: 'slow-report', description: '慢慢跑', source: 'project', invocation: ['human'],
          appliesTo: { resource: ['.eml'] }, entry: 'run.py', runtime: 'python',
        }],
        unregistered: [],
      }),
      capabilityRun,
    }))
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    const group = await waitFor(() => {
      const found = container.querySelector('[data-row-capabilities="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    fireEvent.click(within(group).getByText('slow-report'))
    expect(await screen.findByText('能力「slow-report」执行中…')).toBeTruthy()

    // The 任务 tab shows the run with a badge, running on top.
    fireEvent.click(screen.getByText('任务'))
    const pane = await waitFor(() => {
      const found = document.querySelector('[data-tasks-pane="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(document.querySelector('[data-tasks-badge="true"]')?.textContent).toBe('1')
    const line = pane.querySelector('[data-task-row]') as HTMLElement
    expect(line.getAttribute('data-task-status')).toBe('running')
    expect(line.textContent).toContain('能力「slow-report」')

    // 取消 on the row reaches the runner's abort signal and ends the row.
    fireEvent.click(within(line).getByText('取消'))
    await waitFor(() => { expect(line.getAttribute('data-task-status')).toBe('cancelled') })
    expect((capabilityRun.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true)
  })

  it('opens the validate run\'s detail drawer from its 查看 verb (ADR-0035)', async () => {
    const sessionDetail = vi.fn((): Promise<SessionDetail> => Promise.resolve({
      items: [
        { kind: 'user', seq: 0, turn: 1, text: '【预扫 · 孤儿条目（入链不超过 1）】', injected: true },
      ],
      usage: null,
    }))
    render(renderFrame({
      sessionDetail,
      validate: () => Promise.resolve({
        sessionId: 'sess-validate', title: '', reason: '',
        preScan: { entities: 3, orphans: [], broken: [] },
        stats: { entities: 3, prescan: 0, findings: 2, filtered: 0, tokens: 456, elapsedMs: 1200 },
      }),
    }))
    // The scoped entry: the 人物 tab's 校验 button beside 新建.
    fireEvent.click(await screen.findByText('人物'))
    fireEvent.click(await screen.findByText('校验'))

    fireEvent.click(screen.getByText('任务'))
    const pane = await waitFor(() => {
      const found = document.querySelector('[data-tasks-pane="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    const line = pane.querySelector('[data-task-row]') as HTMLElement
    await waitFor(() => { expect(line.getAttribute('data-task-status')).toBe('done') })

    // 查看 opens the ADR-0033 drawer over the run's session log — the
    // prescan lists and the model's judgement ride inside that log.
    fireEvent.click(within(line).getByText('查看'))
    const drawer = await waitFor(() => {
      const found = document.querySelector('[data-task-detail-panel="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(drawer.getAttribute('aria-label')).toBe('实体校验（人物）')
    await waitFor(() => { expect(sessionDetail).toHaveBeenCalledWith('sess-validate', expect.anything()) })
  })

  it('lists the mail fetch as a task row and cancels it from there (ADR-0031 落地注记二)', async () => {
    const mailFetch = vi.fn((_args: unknown, signal?: AbortSignal): Promise<KbMailFetchResult> =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }))
    render(renderFrame({
      capabilityList: () => Promise.resolve({
        capabilities: [{
          name: 'mail', description: '读 Outlook 邮件', source: 'project',
          entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'],
        }],
        unregistered: [],
      }),
      mailFetch,
    }))
    fireEvent.click(screen.getByText('能力'))
    await unfoldInventory()
    fireEvent.click(await screen.findByText('mail'))
    fireEvent.click(await screen.findByText('往后 →'))

    // The fetch is an execution the workbench started, so it is a row of its
    // own — 「读取邮件」 — visible while the reader subprocess works.
    fireEvent.click(screen.getByText('任务'))
    const pane = await waitFor(() => {
      const found = document.querySelector('[data-tasks-pane="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    const line = Array.from(pane.querySelectorAll('[data-task-row]'))
      .find(row => row.textContent?.includes('读取邮件')) as HTMLElement
    expect(line.getAttribute('data-task-status')).toBe('running')

    // 取消 on the row aborts the fetch's own signal, not the analysis's.
    fireEvent.click(within(line).getByText('取消'))
    await waitFor(() => { expect(line.getAttribute('data-task-status')).toBe('cancelled') })
    expect((mailFetch.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true)
  })

  it('carries the mail analysis row from 待确认 through the write to 已写入 (ADR-0031 落地注记二)', async () => {
    render(renderFrame({
      capabilityList: () => Promise.resolve({
        capabilities: [{
          name: 'mail', description: '读 Outlook 邮件', source: 'project',
          entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'],
        }],
        unregistered: [],
      }),
      mailFetch: () => Promise.resolve({
        since: '', stale: false, hasMore: false,
        messages: [{
          id: 'a', entryId: 'a', receivedAt: '2026-09-09T10:00:00+00:00',
          senderName: '张三', senderAddress: 'zhangsan@example.com',
          subject: '季度汇报', body: '正文', truncated: false, toMe: 'to',
        }],
      }),
      analyseMail: () => Promise.resolve({
        sessionId: 'session-1',
        title: '邮件分析 2026-09-21',
        analysis: {
          verdicts: [{ mail: 1, importance: 'focus', why: '上级主送' }],
          people: [{ name: '张三', relation: 'peer', reason: '一起做汇报' }],
          todos: [{ title: '发汇报', due: '2026-09-12', body: '' }],
          projects: [{ name: '飞书迁移', note: '对方确认了时间' }],
          resources: [{ name: '汇报模板', summary: '两句话', mail: 1 }],
          memories: [],
          newProjects: [],
          meetings: [],
          deletions: [],
          archives: [],
        },
      }),
    }))
    fireEvent.click(screen.getByText('能力'))
    await unfoldInventory()
    fireEvent.click(await screen.findByText('mail'))
    fireEvent.click(await screen.findByText('往后 →'))
    await screen.findByText(/1 封 · /)
    fireEvent.click(screen.getByText('分析这 1 封'))
    await screen.findByText('邮件分析 2026-09-21')

    // The review card parks the row at 待确认…
    fireEvent.click(screen.getByText('任务'))
    const pane = await waitFor(() => {
      const found = document.querySelector('[data-tasks-pane="true"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    const line = Array.from(pane.querySelectorAll('[data-task-row]'))
      .find(row => row.textContent?.includes('邮件分析')) as HTMLElement
    expect(line.getAttribute('data-task-status')).toBe('waiting')
    expect(line.textContent).toContain('提议待确认')

    // …and confirming the writes must carry the SAME row on to 已写入 —
    // not strand it at 待确认 (the regression this test pins).
    fireEvent.click(screen.getByText('全部接受'))
    fireEvent.click(screen.getByText('确认写入（4）'))
    await waitFor(() => { expect(line.getAttribute('data-task-status')).toBe('done') })
    expect(line.textContent).toContain('已写入 4 项')
  })

  it('runs the 提炼 gesture into a proposal card and applies the confirmed writes (ADR-0029)', async () => {
    const write = vi.fn((_path: string, _content: string) => Promise.resolve())
    const refine = vi.fn(() => Promise.resolve({
      sessionId: 's1',
      title: '提炼 dsh 学习',
      relevant: true,
      reason: '',
      proposal: {
        title: '提炼 dsh 学习',
        actions: [
          {
            kind: 'edit-section', path: 'entities/projects/dsh 学习.md', section: '目标',
            before: '', after: '跑通 hello world', why: '补充了目标',
          },
          {
            kind: 'append-log', entityPath: 'entities/projects/dsh 学习.md', entityName: 'dsh 学习',
            text: '提炼了一次', reason: '提炼记录',
          },
        ],
      } satisfies Proposal,
    }))
    render(renderFrame({ write, refine }))
    fireEvent.click(await screen.findByText('项目'))
    fireEvent.contextMenu(await screen.findByText('dsh 学习'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼'))
    // The gesture reaches the runner with the workspace's entity names as the
    // [[双链]] candidates.
    await waitFor(() => {
      expect(refine).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'refine',
        entityPath: 'entities/projects/dsh 学习.md',
        entityName: 'dsh 学习',
        entityType: 'project',
        siblings: ['dsh 学习', '健康', '我自己', '张三', '周会'],
      }))
    })
    // The verdict opens the shared proposal card, edit-section group included.
    expect(await screen.findByText('提炼 dsh 学习')).toBeTruthy()
    expect(document.querySelector('[data-proposal-group="edit-section"]')).not.toBeNull()
    fireEvent.click(screen.getByText('全部接受'))
    await act(async () => {
      fireEvent.click(screen.getByText('确认写入（2）'))
    })
    await waitFor(() => { expect(write).toHaveBeenCalled() })
    const written = write.mock.calls.map(call => call[1]).join('\n')
    expect(written).toContain('跑通 hello world')
    // The card is gone once the writes land.
    expect(document.querySelector('[data-proposal-card="true"]')).toBeNull()
  })

  it('toasts the reason and opens no card for an irrelevant resource (ADR-0029 决定 2)', async () => {
    const refine = vi.fn(() => Promise.resolve({
      sessionId: 's1',
      title: '提炼 dsh 学习',
      relevant: false,
      reason: '内容与项目无关',
    }))
    const { container } = render(renderFrame({ refine }))
    fireEvent.click(await screen.findByText('项目'))
    const row = await screen.findByText('dsh 学习')
    await act(async () => {
      fireEvent.drop(row, {
        dataTransfer: { getData: (type: string) => (type === RESOURCE_DRAG_TYPE ? 'resources/周报.eml' : ''), files: [] },
      })
    })
    expect(await screen.findByText('「周报.eml」与「dsh 学习」无关：内容与项目无关')).toBeTruthy()
    expect(container.querySelector('[data-proposal-card="true"]')).toBeNull()
  })

  it('hands the distill gesture the whole roster from both trees (ADR-0030)', async () => {
    const refine = vi.fn(() => Promise.resolve({
      sessionId: 's1',
      title: '提炼 周报.eml',
      relevant: true,
      reason: '',
      proposal: { title: '提炼 周报.eml', actions: [] },
    }))
    render(renderFrame({ refine }))
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼到实体'))
    await waitFor(() => {
      expect(refine).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'distill',
        resource: { path: 'resources/周报.eml', name: '周报.eml' },
        // The workspace's projects / areas / people / meetings — the
        // resources and todo sections contribute nothing.
        roster: [
          { name: 'dsh 学习', type: 'project', path: 'entities/projects/dsh 学习.md' },
          { name: '健康', type: 'area', path: 'entities/areas/健康.md' },
          { name: '我自己', type: 'person', path: 'entities/people/我自己.md' },
          { name: '张三', type: 'person', path: 'entities/people/张三.md' },
          { name: '周会', type: 'meeting', path: 'entities/meetings/周会.md' },
        ],
      }))
    })
  })

  it('pauses on the verdict\'s questions, and the answers continue the same run (ADR-0030)', async () => {
    const continueWithAnswers = vi.fn(() => Promise.resolve({
      sessionId: 's1',
      title: '提炼 周报.eml',
      relevant: true,
      reason: '',
      proposal: { title: '提炼 周报.eml', actions: [] },
    }))
    const refine = vi.fn(() => Promise.resolve({
      sessionId: 's1',
      title: '提炼 周报.eml',
      relevant: true,
      reason: '需要一点背景',
      questions: [{ question: '这份纪要属于哪个项目？', why: '决定落到哪个实体' }],
      continueWithAnswers,
    }))
    render(renderFrame({ refine }))
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼到实体'))
    // The verdict came back with questions: the dialog opens, no card yet.
    expect(await screen.findByText('这份纪要属于哪个项目？')).toBeTruthy()
    expect(document.querySelector('[data-proposal-card="true"]')).toBeNull()
    fireEvent.change(document.querySelector('[data-question-input="0"]') as HTMLInputElement, {
      target: { value: '飞书迁移' },
    })
    fireEvent.click(screen.getByText('提交回答'))
    await waitFor(() => { expect(continueWithAnswers).toHaveBeenCalledWith(['飞书迁移']) })
    // The continued run's proposal opens the card; the dialog is gone.
    expect(await screen.findByText('提炼 周报.eml')).toBeTruthy()
    expect(document.querySelector('[data-proposal-card="true"]')).not.toBeNull()
    expect(document.querySelector('[data-question-dialog="true"]')).toBeNull()
  })

  it('abandons the question dialog and the run ends without a card (ADR-0030)', async () => {
    const continueWithAnswers = vi.fn()
    const refine = vi.fn(() => Promise.resolve({
      sessionId: 's1',
      title: '提炼 周报.eml',
      relevant: true,
      reason: '',
      questions: [{ question: '这份纪要属于哪个项目？', why: '' }],
      continueWithAnswers,
    }))
    const { container } = render(renderFrame({ refine }))
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼到实体'))
    fireEvent.click(await screen.findByText('放弃本次提炼'))
    expect(document.querySelector('[data-question-dialog="true"]')).toBeNull()
    expect(container.querySelector('[data-proposal-card="true"]')).toBeNull()
    expect(continueWithAnswers).not.toHaveBeenCalled()
  })

  it('runs queued distill gestures one at a time — the next starts when the card closes (ADR-0030)', async () => {
    const refine = vi.fn(() => Promise.resolve({
      sessionId: 's1',
      title: '提炼',
      relevant: true,
      reason: '',
      proposal: {
        title: '提炼',
        actions: [{ kind: 'append-log' as const, entityPath: 'entities/meetings/周会.md', entityName: '周会', text: 'x', reason: 'y' }],
      },
    }))
    render(renderFrame({ refine }))
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼到实体'))
    await waitFor(() => { expect(refine).toHaveBeenCalledTimes(1) })
    // The second gesture lands while the first card is still open: queued.
    fireEvent.contextMenu(screen.getByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(screen.getByText('提炼到实体'))
    await act(async () => {})
    expect(refine).toHaveBeenCalledTimes(1)
    // Closing the card releases the gate and the queued run starts. (Scoped:
    // the queued gesture's own 取消 also exists in the hidden 任务 pane.)
    const card = document.querySelector('[data-proposal-card="true"]') as HTMLElement
    fireEvent.click(within(card).getByText('取消'))
    await waitFor(() => { expect(refine).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText('提炼')).toBeTruthy()
  })

  it('skips an empty distill resource with a toast and keeps the queue moving (ADR-0030 修订)', async () => {
    const refine = vi.fn()
      .mockResolvedValueOnce({
        sessionId: '',
        title: '提炼 空笔记.md',
        relevant: true,
        reason: '内容为空（只有标题）',
        skippedEmpty: true,
      })
      .mockResolvedValueOnce({
        sessionId: 's1',
        title: '提炼',
        relevant: true,
        reason: '',
        proposal: {
          title: '提炼',
          actions: [{ kind: 'append-log' as const, entityPath: 'entities/meetings/周会.md', entityName: '周会', text: 'x', reason: 'y' }],
        },
      })
    render(renderFrame({ refine }))
    fireEvent.contextMenu(await screen.findByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(await screen.findByText('提炼到实体'))
    await waitFor(() => { expect(refine).toHaveBeenCalledTimes(1) })
    expect(await screen.findByText('「周报.eml」是空文件（只有标题），已跳过。')).toBeTruthy()
    // The gate was released by the skip: the next gesture needs no dismissal.
    fireEvent.contextMenu(screen.getByText('周报.eml'), { clientX: 40, clientY: 60 })
    fireEvent.click(screen.getByText('提炼到实体'))
    await waitFor(() => { expect(refine).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText('提炼')).toBeTruthy()
  })

  it('opens the selection menu in the reading view and sends the raw text (ADR-0025 决定 5)', async () => {
    const promptSession = vi.fn(() => Promise.resolve())
    const { container } = render(renderFrame({ promptSession }))
    fireEvent.click(await screen.findByText('健康'))
    const body = await within(
      container.querySelector('[data-tab="entities/areas/健康.md"]') as HTMLElement,
    ).findByText('写下第一个待办')
    const selection = {
      anchorNode: container.querySelector('[data-markdown-body="true"]'),
      toString: () => '选中的文字',
    }
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
    try {
      fireEvent.mouseUp(body)
    } finally {
      spy.mockRestore()
    }
    fireEvent.click(await screen.findByText('发送到会话'))
    // 「发送到会话」 needs no capability: the selection *is* the prompt.
    await waitFor(() => { expect(promptSession).toHaveBeenCalledWith('选中的文字') })
    expect(await screen.findByText('已发送到当前会话。')).toBeTruthy()
  })

  it('runs a selection capability as the `/name` gesture message (ADR-0026 决定 4)', async () => {
    const promptSession = vi.fn(() => Promise.resolve())
    const capabilityRun = vi.fn(() => Promise.resolve({ name: 'notes-helper', runAt: '', artifacts: [] }))
    const { container } = render(renderFrame({
      promptSession,
      capabilityRun,
      capabilityList: () => Promise.resolve({
        capabilities: [{
          name: 'notes-helper', description: '整理一段笔记', source: 'project', invocation: ['human'],
          appliesTo: { selection: true },
        }],
        unregistered: [],
      }),
    }))
    fireEvent.click(await screen.findByText('健康'))
    const body = await within(
      container.querySelector('[data-tab="entities/areas/健康.md"]') as HTMLElement,
    ).findByText('写下第一个待办')
    const selection = {
      anchorNode: container.querySelector('[data-markdown-body="true"]'),
      toString: () => '选中的文字',
    }
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
    try {
      fireEvent.mouseUp(body)
    } finally {
      spy.mockRestore()
    }
    fireEvent.click(await screen.findByText('notes-helper'))
    // The gesture message carries the selection inline; the SKILL.md body is
    // the pre-step's job, not the client's.
    await waitFor(() => { expect(promptSession).toHaveBeenCalledWith('/notes-helper 选中的文字') })
    expect(capabilityRun).not.toHaveBeenCalled()
  })

  it('leaves the selection menu out of a non-opting capability and foreign textareas', async () => {
    const { container } = render(renderFrame({
      capabilityList: () => Promise.resolve({
        capabilities: [{
          name: 'script-cap', description: '脚本型', source: 'project', entry: 'scripts/entry.py', runtime: 'python',
          invocation: ['human'], appliesTo: { selection: true },
        }],
        unregistered: [],
      }),
    }))
    fireEvent.click(await screen.findByText('健康'))
    const body = await within(
      container.querySelector('[data-tab="entities/areas/健康.md"]') as HTMLElement,
    ).findByText('写下第一个待办')
    const selection = {
      anchorNode: container.querySelector('[data-markdown-body="true"]'),
      toString: () => '选中的文字',
    }
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
    try {
      fireEvent.mouseUp(body)
    } finally {
      spy.mockRestore()
    }
    // The menu opens, but the script-type capability never appears — only
    // instruction capabilities are offered on the selection.
    expect(await screen.findByText('发送到会话')).toBeTruthy()
    expect(screen.queryByText('script-cap')).toBeNull()
    expect(container.querySelector('[data-selection-capability]')).toBeNull()
  })
})
