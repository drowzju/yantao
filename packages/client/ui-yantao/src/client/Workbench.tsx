/**
 * The three-pane workbench skeleton: the intake rail on the left (资源 / 待办
 * / 会议 / 连接), the workspace rail on the right (领域 / 人物 / 项目 as
 * tabs), and a transparent middle that stays the host's agent surface until
 * the shared shell steps aside. Pure presentation — every fact arrives as
 * plain data and every action as a callback.
 */
import { useState, type ReactElement } from 'react'
import type { KbTreeSection, KbTreeSectionId } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'

/** Presentational props of the three-pane workbench. */
export interface WorkbenchProps {
  /** Intake sections (resources, todos, meetings), or null before the first load. */
  readonly intake: readonly KbTreeSection[] | null
  /** Workspace sections (areas, people, projects), or null before the first load. */
  readonly workspace: readonly KbTreeSection[] | null
  /** The last load failure's message, or null. */
  readonly error: string | null
  /** The selected KB-relative path, or null. */
  readonly selection: string | null
  /** Select one file. */
  readonly onSelect: (path: string) => void
  /** Reload both trees. */
  readonly onRefresh: () => void
}

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

const railStyle = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: 280,
  padding: 12,
  boxSizing: 'border-box',
  overflowY: 'auto',
  background: '#fbfaf7',
  borderRight: '1px solid #e6e2d8',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 13,
} as const

const titleStyle = { margin: '12px 0 4px', fontSize: 12, fontWeight: 600, color: '#6b6455' } as const

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

/** Render the three panes. */
export function Workbench({ intake, workspace, error, selection, onSelect, onRefresh }: WorkbenchProps): ReactElement {
  const [tab, setTab] = useState<KbTreeSectionId>('areas')
  return (
    // The overlay is click-through: the middle column is still the host's
    // agent surface, and only the two rails take pointer events.
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 900 }}>
      <div style={{ ...railStyle, left: 0, pointerEvents: 'auto' }}>
        <button type="button" style={rowStyle} onClick={onRefresh}>⟳ 刷新</button>
        {error !== null && <div style={{ color: '#b4453a', padding: '4px 6px' }}>{error}</div>}
        {INTAKE_PANEL_IDS.map(id => (
          <Section
            key={id}
            id={id}
            section={intake?.find(entry => entry.id === id)}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div style={{ ...railStyle, left: 'auto', right: 0, borderRight: 'none', borderLeft: '1px solid #e6e2d8', pointerEvents: 'auto' }}>
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
          section={workspace?.find(entry => entry.id === tab)}
          selection={selection}
          onSelect={onSelect}
          showHeading={false}
        />
      </div>
    </div>
  )
}
