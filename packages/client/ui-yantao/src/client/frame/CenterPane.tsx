/**
 * The centre pane: three permanent tabs — 对话, 任务 (ADR-0031; ADR-0057
 * merged 提议 and 调度 into it) and 洞察 (ADR-0050; ADR-0057 merged 图谱
 * into it) — plus one closeable tab per open KB file.
 * The conversation is never unmounted — an
 * inactive tab's column is only
 * hidden — because it is the host's surface (scroll position and the composer
 * draft are its own) and remounting it would cost the human their place. File
 * panes stay mounted for the same reason: a draft survives a tab switch.
 *
 * Pure presentation: the tab state and every file action arrive as props; the
 * merged tabs' bodies arrive pre-assembled from the frame (ADR-0057).
 */
import type { ReactElement, ReactNode } from 'react'
import {
  CONVERSATION_TAB, INSIGHTS_TAB, TASKS_TAB,
  type FileTab, type TabState,
} from '../tabs.ts'
import { runningCount, type TaskRow } from '../task-view.ts'
import { STATUS_KEYS, type SaveStatus } from '../editor/FileEditor.tsx'
import type { WorkbenchT } from '../locales.ts'

/** How an editable markdown file shows: its reading view or its source. */
export type ViewMode = 'read' | 'source'

/** Centre pane props. */
export interface CenterPaneProps {
  /** The open tabs. */
  readonly tabs: TabState
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
  /** The frame's task rows: the 任务 tab dot's running count. */
  readonly taskRows: readonly TaskRow[]
  /** The 任务 tab dot's other trigger: the undecided proposal backlog's size (ADR-0057). */
  readonly inboxPending: number
  /** The 任务 tab's assembled body — 任务｜提议 above, 调度 below (ADR-0057) — rendered once, then only hidden. */
  readonly tasksHub: ReactNode
  /** The 洞察 tab's pane (ADR-0050) — rendered once, then only hidden. */
  readonly insightsPane: ReactNode
  /** The 洞察 tab's pressure adornment (ADR-0057): the context-pressure dot riding the tab label. */
  readonly insightsPressure: ReactNode
  readonly t: WorkbenchT
}

const FONT = 'var(--yt-font-ui)'

const paneStyle = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
} as const

const stripStyle = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 2,
  padding: '4px 4px 0',
  borderBottom: '1px solid var(--yt-border-subtle)',
  background: 'var(--yt-surface-primary)',
} as const

const tabStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 6px',
  // 页签是中列的主点击面之一（2026-10-05 第三轮评审 P2#4）：28px 命中目标
  // 此前只覆盖了对话框系，这里补上。
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderBottomWidth: 0,
  borderRadius: '4px 4px 0 0',
  background: 'transparent',
} as const

const activeTabStyle = { ...tabStyle, background: 'var(--yt-surface-raised)', borderColor: 'var(--yt-border-subtle)' } as const

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

const closeButtonStyle = { borderWidth: 0, background: 'transparent', cursor: 'pointer', color: 'var(--yt-text-muted)' } as const

const bodyStyle = { position: 'relative', flex: 1, minHeight: 0, display: 'flex' } as const

const pageStyle = { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' } as const

/** Dot colour per save status. dirty 走语义琥珀：警告黄作 3:1 的图形色都
    不够（2.2:1），琥珀档在两张表上都过线。 */
const DOT_COLORS: Record<SaveStatus, string> = {
  loading: 'var(--yt-text-muted)',
  saved: 'var(--yt-success)',
  dirty: 'var(--yt-warning-text)',
  saving: 'var(--yt-accent)',
  failed: 'var(--yt-error)',
  conflict: 'var(--yt-error)',
}

/** The status dot beside a file tab's title. */
function StatusDot({ status, t }: { status: SaveStatus; t: WorkbenchT }): ReactElement {
  return (
    <span
      data-status={status}
      title={t(STATUS_KEYS[status])}
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

/** The 任务 tab's sole badge: a plain blue dot whenever any sub-tab has a
    signal (running tasks or pending proposals). The counts themselves moved
    onto the sub-tabs (任务 / 提议) where their ownership is unambiguous. */

/**
 * Render the centre pane's tab strip and its panes.
 * @param props - see {@link CenterPaneProps}.
 * @returns the centre pane element.
 */
export function CenterPane({
  tabs,
  statuses,
  onActivate,
  onClose,
  renderConversation,
  renderFile,
  taskRows,
  inboxPending,
  tasksHub,
  insightsPane,
  insightsPressure,
  t,
}: CenterPaneProps): ReactElement {
  // The conversation is rendered unconditionally and only hidden: remounting
  // it would drop the host's scroll position and composer draft.
  const conversationActive = tabs.active === CONVERSATION_TAB
  const tasksActive = tabs.active === TASKS_TAB
  const insightsActive = tabs.active === INSIGHTS_TAB
  // Only an editable file has two views; a read-only original is one <pre>.
  // The 阅读 / 源码 switch itself lives in the file pane's own header
  // (Frame.renderFile): a strip-end control vanished once enough file tabs
  // crowded the single-line strip, so it rides with the active tab instead.
  const running = runningCount(taskRows)
  return (
    <div style={paneStyle}>
      <div style={stripStyle}>
        <div style={conversationActive ? activeTabStyle : tabStyle}>
          <button type="button" style={labelButtonStyle} data-hover="tab" data-center-tab={CONVERSATION_TAB} onClick={() => { onActivate(CONVERSATION_TAB) }}>
            {t('center.conversation')}
          </button>
        </div>
        <div style={tasksActive ? activeTabStyle : tabStyle}>
          <button type="button" style={labelButtonStyle} data-hover="tab" data-center-tab={TASKS_TAB} onClick={() => { onActivate(TASKS_TAB) }}>
            {t('center.tasks')}
          </button>
          {/* The blue dot replaces the twin numeric pills: a number on the
              parent tab could not say which sub-tab it belonged to, so the
              counts now ride the sub-tabs themselves and the parent only
              signals presence. */}
          {(running > 0 || inboxPending > 0) && (
            <span
              data-tasks-badge="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                background: 'var(--yt-accent)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          )}
        </div>
        <div style={insightsActive ? activeTabStyle : tabStyle}>
          <button type="button" style={labelButtonStyle} data-hover="tab" data-center-tab={INSIGHTS_TAB} onClick={() => { onActivate(INSIGHTS_TAB) }}>
            {t('center.insights')}
          </button>
          {/* ADR-0057: the context-pressure dot (amber past 80%, red past
              95%) — the retired footer button's stroke, relocated to the tab
              label so the alarm stays globally visible. */}
          {insightsPressure}
        </div>
        {tabs.files.map((tab) => {
          const status = statuses[tab.path]
          return (
            <div key={tab.path} style={tabs.active === tab.path ? activeTabStyle : tabStyle}>
              {status !== undefined && <StatusDot status={status} t={t} />}
              <button
                type="button"
                style={labelButtonStyle}
                title={tab.path}
                data-tab-button={tab.path}
                data-hover="tab"
                onClick={() => { onActivate(tab.path) }}
              >
                {tab.title}
              </button>
              <button
                type="button"
                style={closeButtonStyle}
                title={t('center.close')}
                data-hover="close"
                onClick={() => { onClose(tab.path) }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <div style={bodyStyle}>
        <div style={{ ...pageStyle, display: conversationActive ? 'flex' : 'none' }} data-tab={CONVERSATION_TAB}>
          {renderConversation()}
        </div>
        <div
          style={{ ...pageStyle, display: tasksActive ? 'flex' : 'none' }}
          data-tab={TASKS_TAB}
        >
          {tasksHub}
        </div>
        <div style={{ ...pageStyle, display: insightsActive ? 'flex' : 'none' }} data-tab={INSIGHTS_TAB}>
          {insightsPane}
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
