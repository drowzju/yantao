/**
 * The two workbench rails (ADR-0011). Both are plain children of our own
 * frame now — real grid columns, not slot entries — so they carry the same
 * shape: fill the column when expanded, render a compact icon column when the
 * frame collapses them. Pure presentation over plain data: every fact arrives
 * as a prop and every action as a callback.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  KbPersonRelation, KbTreeFile, KbTreeSection, KbTreeSectionId,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type {
  EntityCreator, FileDeleter, FileReader, FileWriter, MailFetcher, MailMarker, TodoLoader, TodoWriter,
} from './remote.ts'
import type { MailAnalyser } from './mail-analysis.ts'
import type { MailWriteTarget } from './mail-apply.ts'
import { entitiesOfTree } from './mail-apply.ts'
import { MailPanel } from './MailPanel.tsx'
import type { KbCreatableEntityType } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { remoteMessage } from './remote.ts'
import type { TabMode } from './tabs.ts'
import { TodoBoard } from './TodoBoard.tsx'
import { NewEntityRow } from './NewEntityRow.tsx'

/** Loads one rail's sections; rejects with a message the rail can render. */
export type TreeLoader = () => Promise<readonly KbTreeSection[]>

/** Left-rail tabs in display order; `connector` has no KB files yet (ADR-0010 reserves it). */
const INTAKE_PANEL_IDS: readonly (KbTreeSectionId | 'connector')[] = ['resources', 'todos', 'meetings', 'connector']

/** Right-rail tabs in display order. */
const WORKSPACE_TAB_IDS: readonly KbTreeSectionId[] = ['areas', 'people', 'projects']

/** The entity kind each tree section creates. `todos` is a singleton — the server refuses it. */
const ENTITY_KINDS: Partial<Record<KbTreeSectionId, KbCreatableEntityType>> = {
  meetings: 'meeting',
  areas: 'area',
  people: 'person',
  projects: 'project',
}

/**
 * The section owning one path, when this rail's tree has it. Both rails read
 * the same selection, so each answers for its own half of the KB: a rail that
 * does not own the path simply keeps its tab.
 * @param sections - the rail's loaded sections.
 * @param path - the selected KB-relative path, if any.
 * @returns the owning section's id.
 */
function sectionOf(
  sections: readonly KbTreeSection[] | null,
  path: string | null,
): KbTreeSectionId | undefined {
  if (path === null) return undefined
  return sections?.find(section => section.files.some(file => file.path === path))?.id
}

/** Panel and tab labels — yantao's working language, until this plugin owns a dictionary. */
export const SECTION_LABELS: Record<string, string> = {
  resources: '资源',
  todos: '待办',
  meetings: '会议',
  connector: '连接',
  areas: '领域',
  people: '人物',
  projects: '项目',
}

/** The person relations the KB knows, as the rail reads them. */
export const RELATION_LABELS: Record<KbPersonRelation, string> = {
  self: '自己',
  subordinate: '下属',
  superior: '上级',
  peer: '同事',
  external: '外部',
}

/** The relation a new person gets until the human says otherwise. */
const DEFAULT_RELATION: KbPersonRelation = 'peer'

/**
 * One relation as the rail reads it. The wire value is whatever the file
 * carries — a human edits these in Obsidian — so a word the KB does not know
 * is shown as written rather than dropped.
 * @param relation - the frontmatter's `relation`.
 * @returns the Chinese label, or the value itself when there is no label.
 */
function relationLabel(relation: string): string {
  return Object.hasOwn(RELATION_LABELS, relation) ? RELATION_LABELS[relation as KbPersonRelation] : relation
}

/** The picker's options: the domain's five, in the rail's own words. */
const RELATION_OPTIONS: readonly { readonly value: KbPersonRelation; readonly label: string }[] = (
  Object.entries(RELATION_LABELS) as [KbPersonRelation, string][]
).map(([value, label]) => ({ value, label }))

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

/** The expanded rail: it fills the column the frame hands it. */
const railStyle = {
  width: '100%',
  height: '100%',
  padding: 12,
  boxSizing: 'border-box',
  overflowY: 'auto',
  fontFamily: FONT,
  fontSize: 13,
} as const

/** The collapsed rail: a centered icon column. */
const compactStyle = {
  width: '100%',
  height: '100%',
  paddingTop: 12,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  fontFamily: FONT,
  fontSize: 13,
} as const

const titleStyle = { margin: '12px 0 4px', fontSize: 12, fontWeight: 600, color: '#6b6455' } as const

const errorStyle = { color: '#b4453a', padding: '4px 6px' } as const

const rowStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '4px 6px',
  margin: '1px 0',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
} as const

const selectedRowStyle = { ...rowStyle, background: '#eef3ff', borderColor: '#c7d7ff' } as const

const tabRowStyle = { ...rowStyle, width: 'auto', flex: 1, textAlign: 'center' } as const

/** One rail's load state: the sections it renders, the last failure, and the refresh action. */
interface RailState {
  readonly sections: readonly KbTreeSection[] | null
  readonly error: string | null
  /** Reload the tree; resolves once the new sections are in state. */
  readonly refresh: () => Promise<void>
}

/**
 * Load one rail's sections once on mount, on every refresh, and whenever the
 * frame bumps its refresh key (a new KB root, a new entity).
 * @param load - the loader the frame supplies.
 * @param refreshKey - the frame's tree-generation counter.
 * @returns the load state.
 */
function useRail(load: TreeLoader, refreshKey: number): RailState {
  const [sections, setSections] = useState<readonly KbTreeSection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The loader is a fresh closure on every render (it comes from the inject
  // face), so the effect reads it through a ref instead of taking it as a
  // dependency.
  const latest = useRef(load)
  latest.current = load
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSections(await latest.current())
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh, refreshKey])
  return { sections, error, refresh }
}

/** Render one rail section: a heading (unless the tab strip already labels it) and its file rows. */
function Section({
  id,
  section,
  selection,
  onSelect,
  onMenu,
  showHeading = true,
}: {
  id: KbTreeSectionId | 'connector'
  section: KbTreeSection | undefined
  selection: string | null
  onSelect: (path: string) => void
  /** Open the row's right-click menu; absent for a section whose rows are not the human's to drop. */
  onMenu?: ((file: KbTreeFile, x: number, y: number) => void) | undefined
  showHeading?: boolean
}): ReactElement {
  return (
    <div>
      {showHeading && <div style={titleStyle}>{SECTION_LABELS[id]}</div>}
      {id === 'connector' && <div style={{ color: '#9a9488', padding: '4px 6px' }}>预留（连接抽象见 ADR-0010）</div>}
      {section === undefined && id !== 'connector' && <div style={{ color: '#9a9488', padding: '4px 6px' }}>（空）</div>}
      {section?.files.map(file => (
        <button
          key={file.path}
          type="button"
          style={selection === file.path ? selectedRowStyle : rowStyle}
          data-selected={selection === file.path || undefined}
          onClick={() => { onSelect(file.path) }}
          onContextMenu={onMenu === undefined ? undefined : (event) => {
            event.preventDefault()
            onMenu(file, event.clientX, event.clientY)
          }}
          title={file.path}
        >
          {file.name}
          {file.archived === true && <span style={{ color: '#9a9488' }}> · 已归档</span>}
          {file.relation !== undefined && (
            <span style={{ color: '#9a9488' }}>
              {' · '}
              {relationLabel(file.relation)}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** One row's right-click menu: the row it belongs to and where it opens. */
interface MenuTarget {
  readonly path: string
  readonly name: string
  readonly x: number
  readonly y: number
}

const menuStyle = {
  position: 'fixed',
  zIndex: 40,
  padding: 4,
  background: '#fff',
  border: '1px solid #e6e2d8',
  borderRadius: 4,
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  fontFamily: FONT,
  fontSize: 13,
} as const

const menuItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '3px 8px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const menuNoteStyle = { color: '#6b6455', padding: '2px 8px 4px' } as const

/**
 * The row menu: 删除 asks once before the file goes, and Escape or a click
 * anywhere else dismisses it. The `mousedown` that opened it has already been
 * dispatched, so it cannot close itself the moment it appears.
 * @param props - the targeted row, the busy flag, and the two actions.
 * @returns the menu element.
 */
function RowMenu(props: {
  target: MenuTarget
  busy: boolean
  onDelete: (path: string) => void
  onClose: () => void
}): ReactElement {
  const { target, busy, onDelete, onClose } = props
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [onClose])

  return (
    <div ref={ref} style={{ ...menuStyle, left: target.x, top: target.y }} data-row-menu={target.path}>
      {!confirming && (
        <button type="button" style={menuItemStyle} disabled={busy} onClick={() => { setConfirming(true) }}>
          删除「{target.name}」
        </button>
      )}
      {confirming && (
        <div>
          <div style={menuNoteStyle}>不可撤销，确认删除？</div>
          <button type="button" style={menuItemStyle} disabled={busy} onClick={() => { onDelete(target.path) }}>
            删除
          </button>
          <button type="button" style={menuItemStyle} onClick={onClose}>取消</button>
        </div>
      )}
    </div>
  )
}

/** What a rail needs from its row menu: the open menu, and the actions behind it. */
interface RowMenuHost {
  readonly menu: MenuTarget | null
  /** True while a delete is in flight. */
  readonly busy: boolean
  /** Open the menu on one row, at the pointer. */
  readonly open: (file: KbTreeFile, x: number, y: number) => void
  readonly close: () => void
  readonly remove: (path: string) => Promise<void>
}

/**
 * Own one rail's row menu: opening, dismissing, and the delete itself — the
 * file goes through the host, then the tree reloads and the centre pane drops
 * the tab that was showing it.
 * @param args - the delete channel and the three callbacks it reports to.
 * @returns the menu state and its actions.
 */
function useRowMenu(args: {
  readonly deleteFile: FileDeleter
  readonly refresh: () => Promise<void>
  readonly onCloseFile: (path: string) => void
  readonly onError: (message: string) => void
}): RowMenuHost {
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [busy, setBusy] = useState(false)
  // Every callback is a fresh closure on each render (inject face), so the
  // delete path reaches them through a ref.
  const latest = useRef(args)
  latest.current = args
  const remove = useCallback(async (path: string): Promise<void> => {
    setBusy(true)
    try {
      await latest.current.deleteFile(path)
      await latest.current.refresh()
      latest.current.onCloseFile(path)
      setMenu(null)
    } catch (failure: unknown) {
      latest.current.onError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }, [])
  const open = useCallback((file: KbTreeFile, x: number, y: number): void => {
    setMenu({ path: file.path, name: file.name, x, y })
  }, [])
  const close = useCallback((): void => { setMenu(null) }, [])
  return { menu, busy, open, close, remove }
}

/** The compact column both rails render while collapsed. */
function CompactRail({
  label,
  error,
  onExpand,
  side,
}: {
  label: string
  error: string | null
  onExpand: () => void
  side: 'intake' | 'workspace'
}): ReactElement {
  return (
    <div style={compactStyle}>
      <button type="button" style={rowStyle} title={label} onClick={onExpand}>
        {side === 'intake' ? '›' : '‹'}
      </button>
      {error !== null && <span style={{ color: '#b4453a' }} title={error}>!</span>}
    </div>
  )
}

/** Presentational props shared by both rails. */
export interface RailProps {
  /** True while the frame renders this rail as a compact icon column. */
  readonly collapsed: boolean
  /** Load this rail's sections. */
  readonly load: TreeLoader
  /** The frame's tree-generation counter: a bump reloads the tree. */
  readonly refreshKey: number
  /** The KB file the centre pane shows, shared by both rails; null while 对话 is active. */
  readonly selection: string | null
  /** Ask the frame to expand this rail again. */
  readonly onExpand: () => void
  /** Open a KB file in the centre pane. */
  readonly onOpenFile: (path: string, mode: TabMode) => void
  /** Drop a KB file's centre-pane tab — the half of a delete the rail owes the frame. */
  readonly onCloseFile: (path: string) => void
  /** Read the todo singleton as structured items (ADR-0018). */
  readonly loadTodos: TodoLoader
  /** Write the todo singleton's whole item list (ADR-0018). */
  readonly writeTodos: TodoWriter
  /** Create one entity and resolve its path. */
  readonly createEntity: EntityCreator
  /** Read one KB file's content — the connector appends notes with it (ADR-0019). */
  readonly read: FileReader
  /** Write one KB file's content (ADR-0019). */
  readonly write: FileWriter
  /** Delete one KB file — the row menu's 「删除」. */
  readonly deleteFile: FileDeleter
  /** Load the workspace side, so the mail analysis can name what exists (ADR-0019). */
  readonly workspace: TreeLoader
  /** Read the newest mails after the connector's cursor (ADR-0019). */
  readonly mailFetch: MailFetcher
  /** Move that cursor forward (ADR-0019). */
  readonly mailMarkRead: MailMarker
  /** Run one mail analysis in a dsh session (ADR-0019). */
  readonly analyseMail: MailAnalyser
}

/** The rail's error marker: it is the only thing left above the tab strip. */
function RailHeader({ error }: { error: string | null }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      {error !== null && <span style={{ color: '#b4453a' }} title={error}>!</span>}
    </div>
  )
}

/**
 * The intake rail: 资源 / 待办 / 会议 / 连接 as tabs. 待办 renders the
 * singleton as a TODO / DONE board inline (ADR-0018); 会议 can create a
 * meeting inline; 资源 rows open read-only.
 * @param props - see {@link RailProps}.
 * @returns the rail element.
 */
export function IntakeRail(props: RailProps): ReactElement {
  const {
    collapsed, load, refreshKey, selection, onExpand, onOpenFile, onCloseFile, loadTodos, writeTodos, createEntity,
    read, write, deleteFile, workspace, mailFetch, mailMarkRead, analyseMail,
  } = props
  const { sections, error, refresh } = useRail(load, refreshKey)
  const [tab, setTab] = useState<KbTreeSectionId | 'connector'>('resources')
  const [actionError, setActionError] = useState<string | null>(null)
  const rowMenu = useRowMenu({ deleteFile, refresh, onCloseFile, onError: setActionError })
  // Reveal a selection this rail owns: the tab carrying the file comes to the
  // front, so the highlighted row is a visible one. A selection owned by the
  // other rail leaves the human's own tab choice alone.
  useEffect(() => {
    const owner = sectionOf(sections, selection)
    if (owner !== undefined) setTab(owner)
  }, [sections, selection])

  if (collapsed) {
    return (
      <CompactRail label="展开输入栏" error={error} onExpand={onExpand} side="intake" />
    )
  }

  /** Create an entity of this section's kind, reload the tree, and open it. */
  const create = async (kind: KbCreatableEntityType, name: string): Promise<void> => {
    const path = await createEntity(kind, name)
    await refresh()
    onOpenFile(path, 'edit')
  }

  // ADR-0019: the writes a confirmed mail analysis lands on.
  const mailTarget: MailWriteTarget = {
    createEntity, read, write, todos: loadTodos, writeTodos,
  }

  return (
    <div style={railStyle}>
      <RailHeader error={error} />
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {INTAKE_PANEL_IDS.map(id => (
          <button
            key={id}
            type="button"
            style={tab === id ? { ...tabRowStyle, background: '#eef3ff', borderColor: '#c7d7ff' } : tabRowStyle}
            onClick={() => { setTab(id) }}
          >
            {SECTION_LABELS[id]}
          </button>
        ))}
      </div>
      {actionError !== null && <div style={errorStyle}>{actionError}</div>}
      {tab === 'todos' && (
        <TodoBoard
          load={loadTodos}
          write={writeTodos}
          refreshKey={refreshKey}
          onOpenFile={(path) => { onOpenFile(path, 'edit') }}
        />
      )}
      {tab === 'connector' && (
        <MailPanel
          fetch={mailFetch}
          mark={mailMarkRead}
          analyse={analyseMail}
          target={mailTarget}
          entities={async () => entitiesOfTree(await workspace())}
        />
      )}
      {tab !== 'todos' && tab !== 'connector' && (
        <Section
          id={tab}
          section={sections?.find(entry => entry.id === tab)}
          selection={selection}
          onSelect={(path) => { onOpenFile(path, tab === 'resources' ? 'read' : 'edit') }}
          onMenu={tab === 'meetings' ? rowMenu.open : undefined}
          showHeading={false}
        />
      )}
      {tab === 'meetings' && (
        <NewEntityRow
          label="+ 新建"
          placeholder="会议名称"
          submit={name => create('meeting', name).catch((failure: unknown) => {
            setActionError(failure instanceof Error ? failure.message : String(failure))
          })}
        />
      )}
      {rowMenu.menu !== null && (
        <RowMenu
          key={rowMenu.menu.path}
          target={rowMenu.menu}
          busy={rowMenu.busy}
          onDelete={(path) => { void rowMenu.remove(path) }}
          onClose={rowMenu.close}
        />
      )}
    </div>
  )
}

/**
 * The workspace rail: 领域 / 人物 / 项目 as tabs, each able to create its own
 * kind inline and open its entities as editable tabs.
 * @param props - see {@link RailProps}.
 * @returns the rail element.
 */
export function WorkspaceRail(props: RailProps): ReactElement {
  const {
    collapsed, load, refreshKey, selection, onExpand, onOpenFile, onCloseFile, createEntity, deleteFile,
  } = props
  const { sections, error, refresh } = useRail(load, refreshKey)
  const [tab, setTab] = useState<KbTreeSectionId>('areas')
  const [actionError, setActionError] = useState<string | null>(null)
  /** The relation a new person gets; 同事 unless the human picks another. */
  const [relation, setRelation] = useState<KbPersonRelation>(DEFAULT_RELATION)
  const rowMenu = useRowMenu({ deleteFile, refresh, onCloseFile, onError: setActionError })
  // Same reveal as the intake rail: a selection this rail owns pulls its tab
  // forward, one it does not own is left to the other rail.
  useEffect(() => {
    const owner = sectionOf(sections, selection)
    if (owner !== undefined) setTab(owner)
  }, [sections, selection])

  if (collapsed) {
    return (
      <CompactRail label="展开工作栏" error={error} onExpand={onExpand} side="workspace" />
    )
  }

  const kind = ENTITY_KINDS[tab]
  /** Create an entity of this tab's kind, reload the tree, and open it. */
  const create = async (name: string): Promise<void> => {
    if (kind === undefined) return
    // Only a person carries a relation, and only a person is asked for one.
    const path = await createEntity(kind, name, kind === 'person' ? relation : undefined)
    await refresh()
    onOpenFile(path, 'edit')
  }

  return (
    <div style={railStyle}>
      <RailHeader error={error} />
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {WORKSPACE_TAB_IDS.map(id => (
          <button
            key={id}
            type="button"
            style={tab === id ? { ...tabRowStyle, background: '#eef3ff', borderColor: '#c7d7ff' } : tabRowStyle}
            onClick={() => { setTab(id) }}
          >
            {SECTION_LABELS[id]}
          </button>
        ))}
      </div>
      {actionError !== null && <div style={errorStyle}>{actionError}</div>}
      <Section
        id={tab}
        section={sections?.find(entry => entry.id === tab)}
        selection={selection}
        onSelect={(path) => { onOpenFile(path, 'edit') }}
        onMenu={rowMenu.open}
        showHeading={false}
      />
      <NewEntityRow
        label="+ 新建"
        placeholder={`${SECTION_LABELS[tab]}名称`}
        choice={kind === 'person' ? {
          options: RELATION_OPTIONS,
          value: relation,
          onChange: (value) => { setRelation(value as KbPersonRelation) },
        } : undefined}
        submit={name => create(name).catch((failure: unknown) => {
          setActionError(failure instanceof Error ? failure.message : String(failure))
        })}
      />
      {rowMenu.menu !== null && (
        <RowMenu
          key={rowMenu.menu.path}
          target={rowMenu.menu}
          busy={rowMenu.busy}
          onDelete={(path) => { void rowMenu.remove(path) }}
          onClose={rowMenu.close}
        />
      )}
    </div>
  )
}
