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
import { Fragment, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import {
  CONVERSATION_TAB, INSIGHTS_TAB, TASKS_TAB,
  type FileTab, type TabState,
} from '../tabs.ts'
import { runningCount, type TaskRow } from '../task-view.ts'
import { STATUS_KEYS, type SaveStatus } from '../editor/FileEditor.tsx'
import type { WorkbenchT } from '../locales.ts'
import { tabItemActiveStyle, tabItemStyle } from '../buttons.ts'

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
  gap: 'var(--yt-space-1)',
  padding: 'var(--yt-space-1) var(--yt-space-1) 0',
  borderBottom: '1px solid var(--yt-border-subtle)',
  background: 'var(--yt-surface-primary)',
} as const

// 页签本体走 buttons.ts 的 tabItem 面（2026-10-12 起三栏同构）——
// 此前的凸面页签（surface-raised）与两栏的 accent 洗染并存，是两套
// 「当前在哪」；本文件只保留条带自身的底线与底色。

// 页签是单层按钮（2026-10-12 复检 P2）：洗染与焦点环必须落在同一个元素上，
// 此前 div(tabItem)>button(label) 双层——焦点环画在内层、accent 洗染涂在
// 外层，键盘用户看到的聚焦位置与「当前在哪」脱节。徽记（运行点/压力点）
// 作为 aria-hidden 的装饰随钮走；文件页签的关闭钮是独立动作，留在兄弟位。
const tabFace = (active: boolean): CSSProperties => ({
  ...(active ? tabItemActiveStyle : tabItemStyle),
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
})

const closeButtonStyle = {
  borderWidth: 0,
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--yt-text-muted)',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
  padding: '0 var(--yt-space-2)',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
} as const

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
        <button
          type="button"
          style={tabFace(conversationActive)}
          data-hover="tab"
          /* data-selected 是激活页签的 hover 豁免凭证（2026-10-12 截图评审）：
             没有它，悬停激活页签被通用规则涂成中性灰——左栏激活页签悬停
             保持 accent，中栏闪灰，「一会蓝一会黑」的分裂感即来源于此。 */
          data-selected={conversationActive ? '' : undefined}
          data-center-tab={CONVERSATION_TAB}
          onClick={() => { onActivate(CONVERSATION_TAB) }}
        >
          {t('center.conversation')}
        </button>
        <button
          type="button"
          style={tabFace(tasksActive)}
          data-hover="tab"
          data-selected={tasksActive ? '' : undefined}
          data-center-tab={TASKS_TAB}
          onClick={() => { onActivate(TASKS_TAB) }}
        >
          {t('center.tasks')}
          {/* The blue dot replaces the twin numeric pills: a number on the
              parent tab could not say which sub-tab it belonged to, so the
              counts now ride the sub-tabs themselves and the parent only
              signals presence. */}
          {(running > 0 || inboxPending > 0) && (
            <span
              data-tasks-badge="true"
              aria-hidden="true"
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
        </button>
        <button
          type="button"
          style={tabFace(insightsActive)}
          data-hover="tab"
          data-selected={insightsActive ? '' : undefined}
          data-center-tab={INSIGHTS_TAB}
          onClick={() => { onActivate(INSIGHTS_TAB) }}
        >
          {t('center.insights')}
          {/* ADR-0057: the context-pressure dot (amber past 80%, red past
              95%) — the retired footer button's stroke, relocated to the tab
              label so the alarm stays globally visible. */}
          {insightsPressure}
        </button>
        {tabs.files.map((tab) => {
          const status = statuses[tab.path]
          return (
            <Fragment key={tab.path}>
              {status !== undefined && <StatusDot status={status} t={t} />}
              <button
                type="button"
                style={tabFace(tabs.active === tab.path)}
                title={tab.path}
                data-tab-button={tab.path}
                data-hover="tab"
                data-selected={tabs.active === tab.path ? '' : undefined}
                onClick={() => { onActivate(tab.path) }}
              >
                {tab.title}
              </button>
              <button
                type="button"
                style={closeButtonStyle}
                title={t('center.close')}
                aria-label={`${t('center.close')} ${tab.title}`}
                data-hover="close"
                onClick={() => { onClose(tab.path) }}
              >
                ×
              </button>
            </Fragment>
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
