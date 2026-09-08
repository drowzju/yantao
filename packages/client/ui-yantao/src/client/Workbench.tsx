/**
 * The two workbench rails (ADR-0011). Both are plain children of our own
 * frame now — real grid columns, not slot entries — so they carry the same
 * shape: fill the column when expanded, render a compact icon column when the
 * frame collapses them. Pure presentation over plain data: every fact arrives
 * as a prop and every action as a callback.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbTreeSection, KbTreeSectionId } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { EntityCreator, FileReader, FileWriter } from './remote.ts'
import type { KbCreatableEntityType } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { remoteMessage } from './remote.ts'
import type { TabMode } from './tabs.ts'
import { TodoList } from './TodoList.tsx'
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

/** KB-relative path of the todo singleton (its tree row carries the same path). */
export const TODO_PATH = 'entities/todos.md'

/** Panel and tab labels — yantao's working language, until this plugin owns a dictionary. */
const LABELS: Record<string, string> = {
  resources: '资源',
  todos: '待办',
  meetings: '会议',
  connector: '连接',
  areas: '领域',
  people: '人物',
  projects: '项目',
}

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
  showHeading = true,
}: {
  id: KbTreeSectionId | 'connector'
  section: KbTreeSection | undefined
  selection: string | null
  onSelect: (path: string) => void
  showHeading?: boolean
}): ReactElement {
  return (
    <div>
      {showHeading && <div style={titleStyle}>{LABELS[id]}</div>}
      {id === 'connector' && <div style={{ color: '#9a9488', padding: '4px 6px' }}>预留（连接抽象见 ADR-0010）</div>}
      {section === undefined && id !== 'connector' && <div style={{ color: '#9a9488', padding: '4px 6px' }}>（空）</div>}
      {section?.files.map(file => (
        <button
          key={file.path}
          type="button"
          style={selection === file.path ? selectedRowStyle : rowStyle}
          onClick={() => { onSelect(file.path) }}
          title={file.path}
        >
          {file.name}
          {file.archived === true && <span style={{ color: '#9a9488' }}> · 已归档</span>}
          {file.relation !== undefined && <span style={{ color: '#9a9488' }}> · {file.relation}</span>}
        </button>
      ))}
    </div>
  )
}

/** The compact column both rails render while collapsed. */
function CompactRail({
  label,
  error,
  refresh,
  onExpand,
  side,
}: {
  label: string
  error: string | null
  refresh: () => void
  onExpand: () => void
  side: 'intake' | 'workspace'
}): ReactElement {
  return (
    <div style={compactStyle}>
      <button type="button" style={rowStyle} title={label} onClick={onExpand}>
        {side === 'intake' ? '›' : '‹'}
      </button>
      <button type="button" style={rowStyle} title="刷新知识库" onClick={refresh}>⟳</button>
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
  /** Ask the frame to expand this rail again. */
  readonly onExpand: () => void
  /** Open a KB file in the centre pane. */
  readonly onOpenFile: (path: string, mode: TabMode) => void
  /** Read one KB file's content. */
  readonly read: FileReader
  /** Write one KB file's content. */
  readonly write: FileWriter
  /** Create one entity and resolve its path. */
  readonly createEntity: EntityCreator
  /** Re-open the first-run directory choice. */
  readonly onChangeDirectory: () => void
}

/** The strip both rails use for their tabs, plus the shared rail header. */
function RailHeader({
  error,
  refresh,
  onChangeDirectory,
}: {
  error: string | null
  refresh: () => Promise<void>
  onChangeDirectory: () => void
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      <button type="button" style={{ ...rowStyle, width: 'auto' }} onClick={() => { void refresh() }}>
        ⟳ 刷新
      </button>
      <button type="button" style={{ ...rowStyle, width: 'auto' }} onClick={onChangeDirectory}>
        更改目录
      </button>
      {error !== null && <span style={{ color: '#b4453a' }} title={error}>!</span>}
    </div>
  )
}

/**
 * The intake rail: 资源 / 待办 / 会议 / 连接 as tabs. 待办 renders the
 * singleton checklist inline; 会议 can create a meeting inline; 资源 rows open
 * read-only.
 * @param props - see {@link RailProps}.
 * @returns the rail element.
 */
export function IntakeRail(props: RailProps): ReactElement {
  const { collapsed, load, refreshKey, onExpand, onOpenFile, read, write, createEntity, onChangeDirectory } = props
  const { sections, error, refresh } = useRail(load, refreshKey)
  const [tab, setTab] = useState<KbTreeSectionId | 'connector'>('resources')
  const [selection, setSelection] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (collapsed) {
    return (
      <CompactRail label="展开输入栏" error={error} refresh={() => { void refresh() }} onExpand={onExpand} side="intake" />
    )
  }

  /** Create an entity of this section's kind, reload the tree, and open it. */
  const create = async (kind: KbCreatableEntityType, name: string): Promise<void> => {
    const path = await createEntity(kind, name)
    await refresh()
    onOpenFile(path, 'edit')
  }

  const todoSection = sections?.find(entry => entry.id === 'todos')
  const todoPath = todoSection?.files[0]?.path ?? TODO_PATH

  return (
    <div style={railStyle}>
      <RailHeader error={error} refresh={refresh} onChangeDirectory={onChangeDirectory} />
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {INTAKE_PANEL_IDS.map(id => (
          <button
            key={id}
            type="button"
            style={tab === id ? { ...tabRowStyle, background: '#eef3ff', borderColor: '#c7d7ff' } : tabRowStyle}
            onClick={() => { setTab(id) }}
          >
            {LABELS[id]}
          </button>
        ))}
      </div>
      {actionError !== null && <div style={errorStyle}>{actionError}</div>}
      {tab === 'todos' && (
        <TodoList
          path={todoPath}
          read={read}
          write={write}
          onOpenFile={() => { onOpenFile(todoPath, 'edit') }}
        />
      )}
      {tab === 'connector' && <div style={{ color: '#9a9488', padding: '4px 6px' }}>预留（连接抽象见 ADR-0010）</div>}
      {tab !== 'todos' && tab !== 'connector' && (
        <Section
          id={tab}
          section={sections?.find(entry => entry.id === tab)}
          selection={selection}
          onSelect={(path) => { setSelection(path); onOpenFile(path, tab === 'resources' ? 'read' : 'edit') }}
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
  const { collapsed, load, refreshKey, onExpand, onOpenFile, createEntity, onChangeDirectory } = props
  const { sections, error, refresh } = useRail(load, refreshKey)
  const [tab, setTab] = useState<KbTreeSectionId>('areas')
  const [selection, setSelection] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (collapsed) {
    return (
      <CompactRail label="展开工作栏" error={error} refresh={() => { void refresh() }} onExpand={onExpand} side="workspace" />
    )
  }

  const kind = ENTITY_KINDS[tab]
  /** Create an entity of this tab's kind, reload the tree, and open it. */
  const create = async (name: string): Promise<void> => {
    if (kind === undefined) return
    const path = await createEntity(kind, name)
    await refresh()
    onOpenFile(path, 'edit')
  }

  return (
    <div style={railStyle}>
      <RailHeader error={error} refresh={refresh} onChangeDirectory={onChangeDirectory} />
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {WORKSPACE_TAB_IDS.map(id => (
          <button
            key={id}
            type="button"
            style={tab === id ? { ...tabRowStyle, background: '#eef3ff', borderColor: '#c7d7ff' } : tabRowStyle}
            onClick={() => { setTab(id) }}
          >
            {LABELS[id]}
          </button>
        ))}
      </div>
      {actionError !== null && <div style={errorStyle}>{actionError}</div>}
      <Section
        id={tab}
        section={sections?.find(entry => entry.id === tab)}
        selection={selection}
        onSelect={(path) => { setSelection(path); onOpenFile(path, 'edit') }}
        showHeading={false}
      />
      <NewEntityRow
        label="+ 新建"
        placeholder={`${LABELS[tab]}名称`}
        submit={name => create(name).catch((failure: unknown) => {
          setActionError(failure instanceof Error ? failure.message : String(failure))
        })}
      />
    </div>
  )
}
