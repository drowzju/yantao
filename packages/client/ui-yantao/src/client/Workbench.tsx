/**
 * The two workbench rails, each its own slot entry: the intake rail occupies
 * the host layout's `sidebar` column (so the frame's own drag handle sizes it
 * and `toggleSidebar` collapses it), and the workspace rail rides the
 * frame-wide `shell.overlay` layer. Pure presentation over plain data — every
 * fact arrives as a prop and every action as a callback.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbTreeSection, KbTreeSectionId } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { remoteMessage } from './remote.ts'

/** Loads one rail's sections; rejects with a message the rail can render. */
export type TreeLoader = () => Promise<readonly KbTreeSection[]>

/** Left-rail panels in display order; `connector` has no KB files yet (ADR-0010 reserves it). */
const INTAKE_PANEL_IDS: readonly (KbTreeSectionId | 'connector')[] = ['resources', 'todos', 'meetings', 'connector']

/** Right-rail tabs in display order. */
const WORKSPACE_TAB_IDS: readonly KbTreeSectionId[] = ['areas', 'people', 'projects']

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

/** The expanded intake rail: it fills the sidebar column the frame hands it. */
const railStyle = {
  width: '100%',
  height: '100%',
  padding: 12,
  boxSizing: 'border-box',
  overflowY: 'auto',
  background: '#fbfaf7',
  fontFamily: FONT,
  fontSize: 13,
} as const

/** The collapsed intake rail: a centered icon column (SIDEBAR_COLLAPSED wide). */
const collapsedStyle = {
  width: '100%',
  height: '100%',
  paddingTop: 12,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  background: '#fbfaf7',
  fontFamily: FONT,
  fontSize: 13,
} as const

/** The floating workspace rail: it opts back into pointer events inside the click-through overlay layer. */
const overlayStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 280,
  padding: 12,
  boxSizing: 'border-box',
  overflowY: 'auto',
  background: '#fbfaf7',
  borderLeft: '1px solid #e6e2d8',
  pointerEvents: 'auto',
  fontFamily: FONT,
  fontSize: 13,
} as const

/** The same rail retracted to a handle, so the middle column can take the width back. */
const overlayCollapsedStyle = { ...overlayStyle, width: 28, padding: 4, overflowY: 'hidden' } as const

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

/** One rail's load state: the sections it renders, the last failure, and the refresh action. */
interface RailState {
  readonly sections: readonly KbTreeSection[] | null
  readonly error: string | null
  readonly refresh: () => void
}

/**
 * Load one rail's sections once on mount and on every refresh.
 * @param load - the loader the plugin's inject face supplies.
 * @returns the load state.
 */
function useRail(load: TreeLoader): RailState {
  const [sections, setSections] = useState<readonly KbTreeSection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The loader is a fresh closure on every render (it comes from the inject
  // face), so the mount-only effect reads it through a ref instead of taking
  // it as a dependency.
  const latest = useRef(load)
  latest.current = load
  const refresh = useCallback((): void => {
    latest.current().then(
      (next) => { setSections(next); setError(null) },
      (failure: unknown) => { setError(remoteMessage(failure)) },
    )
  }, [])
  useEffect(() => { refresh() }, [refresh])
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

/** Presentational props of the intake rail (the `sidebar` slot occupant). */
export interface IntakeRailProps {
  /** Sidebar owner share: true while the frame renders the compact collapsed rail. */
  readonly collapsed: boolean
  /** Load the intake sections (resources / todos / meetings). */
  readonly load: TreeLoader
}

/** Presentational props of the workspace rail (a `shell.overlay` entry). */
export interface WorkspaceRailProps {
  /** Load the workspace sections (areas / people / projects). */
  readonly load: TreeLoader
}

/**
 * The intake rail: 资源 / 待办 / 会议 / 连接, filling the sidebar column.
 * @param props - see {@link IntakeRailProps}.
 * @returns the rail element.
 */
export function IntakeRail({ collapsed, load }: IntakeRailProps): ReactElement {
  const { sections, error, refresh } = useRail(load)
  const [selection, setSelection] = useState<string | null>(null)
  if (collapsed) {
    return (
      <div style={collapsedStyle}>
        <button type="button" style={rowStyle} title="刷新知识库" onClick={refresh}>⟳</button>
        {error !== null && <span style={{ color: '#b4453a' }} title={error}>!</span>}
      </div>
    )
  }
  return (
    <div style={railStyle}>
      <button type="button" style={rowStyle} onClick={refresh}>⟳ 刷新</button>
      {error !== null && <div style={errorStyle}>{error}</div>}
      {INTAKE_PANEL_IDS.map(id => (
        <Section
          key={id}
          id={id}
          section={sections?.find(entry => entry.id === id)}
          selection={selection}
          onSelect={setSelection}
        />
      ))}
    </div>
  )
}

/**
 * The workspace rail: 领域 / 人物 / 项目 as tabs, floating over the frame's
 * right edge because the host has only one right-hand column (`details`,
 * which ui-chat occupies with tool details). It retracts to a handle so the
 * middle column can take the width back.
 * @param props - see {@link WorkspaceRailProps}.
 * @returns the rail element.
 */
export function WorkspaceRail({ load }: WorkspaceRailProps): ReactElement {
  const { sections, error, refresh } = useRail(load)
  const [tab, setTab] = useState<KbTreeSectionId>('areas')
  const [selection, setSelection] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <div style={overlayCollapsedStyle}>
        <button type="button" style={rowStyle} title="展开工作区" onClick={() => { setOpen(true) }}>‹</button>
      </div>
    )
  }
  return (
    <div style={overlayStyle}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button type="button" style={rowStyle} title="收起工作区" onClick={() => { setOpen(false) }}>›</button>
        <button type="button" style={rowStyle} title="刷新知识库" onClick={refresh}>⟳</button>
      </div>
      {error !== null && <div style={errorStyle}>{error}</div>}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {WORKSPACE_TAB_IDS.map(id => (
          <button
            key={id}
            type="button"
            style={tab === id ? selectedRowStyle : rowStyle}
            onClick={() => { setTab(id) }}
          >
            {LABELS[id]}
          </button>
        ))}
      </div>
      <Section
        id={tab}
        section={sections?.find(entry => entry.id === tab)}
        selection={selection}
        onSelect={setSelection}
        showHeading={false}
      />
    </div>
  )
}
