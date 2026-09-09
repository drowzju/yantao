/**
 * The centre pane: one permanent 对话 tab plus one closeable tab per open KB
 * file. The conversation is never unmounted — an inactive tab's column is only
 * hidden — because it is the host's surface (scroll position and the composer
 * draft are its own) and remounting it would cost the human their place. File
 * panes stay mounted for the same reason: a draft survives a tab switch.
 *
 * Pure presentation: the tab state and every file action arrive as props.
 */
import type { ReactElement, ReactNode } from 'react'
import {
  CONVERSATION_TAB,
  type FileTab, type TabState,
} from '../tabs.ts'
import { STATUS_LABELS, type SaveStatus } from '../editor/FileEditor.tsx'

/** How the centre pane shows an editable markdown file (ADR-0014). */
export type ViewMode = 'read' | 'source'

/** Centre pane props. */
export interface CenterPaneProps {
  /** The open tabs. */
  readonly tabs: TabState
  /** Whether an editable file shows its reading view or its source. */
  readonly viewMode: ViewMode
  /** Switch an editable file between its reading view and its source. */
  readonly onViewMode: (mode: ViewMode) => void
  /** Save status per file path, reported by the mounted editors. */
  readonly statuses: Readonly<Record<string, SaveStatus>>
  /** Activate one tab key (a file path or the conversation). */
  readonly onActivate: (key: string) => void
  /** Close one file tab. */
  readonly onClose: (path: string) => void
  /** Render the host's conversation surface (rendered once, then only hidden). */
  readonly renderConversation: () => ReactNode
  /** Render one file tab's pane. */
  readonly renderFile: (tab: FileTab) => ReactNode
}

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

const paneStyle = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  fontFamily: FONT,
  fontSize: 13,
} as const

const stripStyle = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 2,
  padding: '4px 4px 0',
  borderBottom: '1px solid #e6e2d8',
  background: '#fbfaf7',
} as const

const tabStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 6px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderBottomWidth: 0,
  borderRadius: '4px 4px 0 0',
  background: 'transparent',
} as const

const activeTabStyle = { ...tabStyle, background: '#fff', borderColor: '#e6e2d8' } as const

const labelButtonStyle = {
  borderWidth: 0,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 13,
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const closeButtonStyle = { borderWidth: 0, background: 'transparent', cursor: 'pointer', color: '#9a9488' } as const

/** The 阅读 / 源码 switch: pushed to the end of the strip. */
const modeSwitchStyle = { display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto', padding: '0 4px' } as const

const modeButtonStyle = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 12,
  padding: '1px 6px',
} as const

const activeModeStyle = { ...modeButtonStyle, background: '#eef3ff', borderColor: '#c7d7ff' } as const

const bodyStyle = { position: 'relative', flex: 1, minHeight: 0, display: 'flex' } as const

const pageStyle = { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' } as const

/** Dot colour per save status. */
const DOT_COLORS: Record<SaveStatus, string> = {
  loading: '#c9c3b4',
  saved: '#4f9d5d',
  dirty: '#d8a13a',
  saving: '#4a7fd4',
  failed: '#b4453a',
  conflict: '#b4453a',
}

/** The status dot beside a file tab's title. */
function StatusDot({ status }: { status: SaveStatus }): ReactElement {
  return (
    <span
      data-status={status}
      title={STATUS_LABELS[status]}
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        background: DOT_COLORS[status],
        display: 'inline-block',
      }}
    />
  )
}

/**
 * Render the centre pane's tab strip and its panes.
 * @param props - see {@link CenterPaneProps}.
 * @returns the centre pane element.
 */
export function CenterPane({
  tabs,
  statuses,
  viewMode,
  onViewMode,
  onActivate,
  onClose,
  renderConversation,
  renderFile,
}: CenterPaneProps): ReactElement {
  // The conversation is rendered unconditionally and only hidden: remounting
  // it would drop the host's scroll position and composer draft.
  const conversationActive = tabs.active === CONVERSATION_TAB
  // Only an editable file has two views; a read-only original is one <pre>.
  const activeFile = tabs.files.find(tab => tab.path === tabs.active)
  const toggleable = activeFile?.mode === 'edit'
  return (
    <div style={paneStyle}>
      <div style={stripStyle}>
        <div style={conversationActive ? activeTabStyle : tabStyle}>
          <button type="button" style={labelButtonStyle} onClick={() => { onActivate(CONVERSATION_TAB) }}>
            对话
          </button>
        </div>
        {tabs.files.map((tab) => {
          const status = statuses[tab.path]
          return (
            <div key={tab.path} style={tabs.active === tab.path ? activeTabStyle : tabStyle}>
              {status !== undefined && <StatusDot status={status} />}
              <button
                type="button"
                style={labelButtonStyle}
                title={tab.path}
                data-tab-button={tab.path}
                onClick={() => { onActivate(tab.path) }}
              >
                {tab.title}
              </button>
              <button
                type="button"
                style={closeButtonStyle}
                title="关闭"
                onClick={() => { onClose(tab.path) }}
              >
                ×
              </button>
            </div>
          )
        })}
        {toggleable && (
          <div style={modeSwitchStyle} data-view-mode={viewMode}>
            <button
              type="button"
              style={viewMode === 'read' ? activeModeStyle : modeButtonStyle}
              onClick={() => { onViewMode('read') }}
            >
              阅读
            </button>
            <button
              type="button"
              style={viewMode === 'source' ? activeModeStyle : modeButtonStyle}
              onClick={() => { onViewMode('source') }}
            >
              源码
            </button>
          </div>
        )}
      </div>
      <div style={bodyStyle}>
        <div style={{ ...pageStyle, display: conversationActive ? 'flex' : 'none' }} data-tab={CONVERSATION_TAB}>
          {renderConversation()}
        </div>
        {tabs.files.map(tab => (
          <div
            key={tab.path}
            data-tab={tab.path}
            style={{ ...pageStyle, display: tabs.active === tab.path ? 'flex' : 'none' }}
          >
            {renderFile(tab)}
          </div>
        ))}
      </div>
    </div>
  )
}
