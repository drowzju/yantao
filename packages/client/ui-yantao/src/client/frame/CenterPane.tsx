/**
 * The centre pane's tab strip: the permanent 对话 tab, the four fixed flat
 * tabs (任务 / 提议 / 调度 / 洞察 — no more 任务 hub with sub-pages, flattened
 * 2026-10-15), plus one closeable tab per open KB file. 提议 is pinned open
 * (no close button); 任务/调度/洞察 are closeable and reopen from the footer.
 * Fixed and file panes are never unmounted — an inactive tab's column is only
 * hidden (a closed fixed tab's too) — because remounting would cost the human
 * their place: the conversation's scroll and draft, the schedule editor's
 * text, an open proposal card.
 *
 * Pure presentation: the tab state and every file action arrive as props; the
 * fixed tabs' bodies arrive pre-assembled from the frame (ADR-0057, flattened
 * 2026-10-15).
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import {
  CONVERSATION_TAB, INBOX_TAB, INSIGHTS_TAB, SCHEDULE_TAB, TASKS_TAB,
  type ClosableFixedTab, type FileTab, type FixedTabsOpen, type TabState,
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
  /** Which closeable fixed tabs (任务/调度/洞察) are open — a closed one shows no tab label but keeps its pane mounted. 提议 is always open. */
  readonly fixedOpen: FixedTabsOpen
  /** Close one closeable fixed tab (任务/调度/洞察); the footer switches reopen it. */
  readonly onCloseFixed: (tab: ClosableFixedTab) => void
  /** Render the host's conversation surface (rendered once, then only hidden). */
  readonly renderConversation: () => ReactNode
  /** Render one file tab's pane. */
  readonly renderFile: (tab: FileTab) => ReactNode
  /** The frame's task rows: the 任务 tab dot's running count. */
  readonly taskRows: readonly TaskRow[]
  /** The 提议 tab dot's trigger: pending proposals plus the pending memory queue (2026-10-15). */
  readonly inboxPending: number
  /** The 任务 tab's pane — rendered once, then only hidden. */
  readonly tasksPane: ReactNode
  /** The 提议 tab's pane — rendered once, then only hidden. */
  readonly inboxPane: ReactNode
  /** The 调度 tab's pane — rendered once, then only hidden. */
  readonly schedulePane: ReactNode
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
// 外层，键盘用户看到的聚焦位置与「当前在哪」脱节。徽记（信号点/压力点）
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

/** 页签与它的关闭钮同住一个 presentation 壳（2026-10-23 评审 P2）：tablist
    的直接子元素只该是 tab，此前关闭钮/保存状态点混居其中，读屏把它们当成
    页签朗读。壳在无障碍树里透明，display:contents 让布局与原先的 Fragment
    逐像素一致。 */
const groupStyle = { display: 'contents' } as const

/** One tab panel's DOM id, derived from the tab key (file paths included). */
function panelId(key: string): string {
  return `yt-tabpanel-${key.replace(/[^\w-]/g, '_')}`
}

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

/** The status dot beside a file tab's title. Sits outside the tab button
    (sibling, not adornment), so it must speak for itself — title alone does
    not reach screen readers (2026-10-14 impeccable P2 修复). */
function StatusDot({ status, t }: { status: SaveStatus; t: WorkbenchT }): ReactElement {
  return (
    <span
      data-status={status}
      role="img"
      aria-label={t(STATUS_KEYS[status])}
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

/** One fixed tab's blue presence dot: accent ground, aria-hidden (the signal
    reaches screen readers through the tab button's accessible name). */
function SignalDot(): ReactElement {
  return (
    <span
      data-fixed-tab-dot="true"
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
  onActivate,
  onClose,
  fixedOpen,
  onCloseFixed,
  renderConversation,
  renderFile,
  taskRows,
  inboxPending,
  tasksPane,
  inboxPane,
  schedulePane,
  insightsPane,
  insightsPressure,
  t,
}: CenterPaneProps): ReactElement {
  // The conversation is rendered unconditionally and only hidden: remounting
  // it would drop the host's scroll position and composer draft. The fixed
  // panes stay mounted even when their tab is closed — reopening is instant
  // and the schedule draft / open card survive the close.
  const conversationActive = tabs.active === CONVERSATION_TAB
  const tasksActive = tabs.active === TASKS_TAB && fixedOpen.tasks
  const inboxActive = tabs.active === INBOX_TAB
  const scheduleActive = tabs.active === SCHEDULE_TAB && fixedOpen.schedule
  const insightsActive = tabs.active === INSIGHTS_TAB && fixedOpen.insights
  // Only an editable file has two views; a read-only original is one <pre>.
  // The 阅读 / 源码 switch itself lives in the file pane's own header
  // (Frame.renderFile): a strip-end control vanished once enough file tabs
  // crowded the single-line strip, so it rides with the active tab instead.
  const running = runningCount(taskRows)
  return (
    <div style={paneStyle}>
      {/* 页签条带补语义角色（2026-10-14 impeccable P2 修复）：读屏此前只听到
          一排裸按钮，不知道这是一组页签、哪一个是当前页。 */}
      <div style={stripStyle} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={conversationActive}
          aria-controls={panelId(CONVERSATION_TAB)}
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
        {fixedOpen.tasks && (
          <span style={groupStyle} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={tasksActive}
              aria-controls={panelId(TASKS_TAB)}
              style={tabFace(tasksActive)}
              data-hover="tab"
              data-selected={tasksActive ? '' : undefined}
              data-center-tab={TASKS_TAB}
              // 蓝点本身保持 aria-hidden（装饰随钮走），但信号必须抵达读屏——
              // 由页签按钮的可访问名报出（2026-10-14 impeccable P2 修复）。
              aria-label={running > 0 ? `${t('center.tasks')}，${t('center.tasks.signal')}` : undefined}
              onClick={() => { onActivate(TASKS_TAB) }}
            >
              {t('center.tasks')}
              {running > 0 && <SignalDot />}
            </button>
            <button
              type="button"
              style={closeButtonStyle}
              title={t('center.close')}
              aria-label={`${t('center.close')} ${t('center.tasks')}`}
              data-hover="close"
              data-center-tab-close={TASKS_TAB}
              onClick={() => { onCloseFixed('tasks') }}
            >
              ×
            </button>
          </span>
        )}
        {/* 提议 is pinned: open by default, no close button (2026-10-15 平铺化
            用户裁决) — the one fixed landing page beside 对话. */}
        <button
          type="button"
          role="tab"
          aria-selected={inboxActive}
          aria-controls={panelId(INBOX_TAB)}
          style={tabFace(inboxActive)}
          data-hover="tab"
          data-selected={inboxActive ? '' : undefined}
          data-center-tab={INBOX_TAB}
          aria-label={inboxPending > 0 ? `${t('center.inbox')}，${t('center.inbox.signal')}` : undefined}
          onClick={() => { onActivate(INBOX_TAB) }}
        >
          {t('center.inbox')}
          {inboxPending > 0 && <SignalDot />}
        </button>
        {fixedOpen.schedule && (
          <span style={groupStyle} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={scheduleActive}
              aria-controls={panelId(SCHEDULE_TAB)}
              style={tabFace(scheduleActive)}
              data-hover="tab"
              data-selected={scheduleActive ? '' : undefined}
              data-center-tab={SCHEDULE_TAB}
              onClick={() => { onActivate(SCHEDULE_TAB) }}
            >
              {t('center.schedule')}
            </button>
            <button
              type="button"
              style={closeButtonStyle}
              title={t('center.close')}
              aria-label={`${t('center.close')} ${t('center.schedule')}`}
              data-hover="close"
              data-center-tab-close={SCHEDULE_TAB}
              onClick={() => { onCloseFixed('schedule') }}
            >
              ×
            </button>
          </span>
        )}
        {fixedOpen.insights && (
          <span style={groupStyle} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={insightsActive}
              aria-controls={panelId(INSIGHTS_TAB)}
              style={tabFace(insightsActive)}
              data-hover="tab"
              data-selected={insightsActive ? '' : undefined}
              data-center-tab={INSIGHTS_TAB}
              onClick={() => { onActivate(INSIGHTS_TAB) }}
            >
              {t('center.insights')}
              {/* ADR-0057: the context-pressure dot (amber past 80%, red past
                  95%) — the retired footer button's stroke, relocated to the tab
                  label so the alarm stays globally visible. 2026-10-15 起 tab
                  可关闭：关闭时压力点挪到 footer 的洞察开关上（见 Frame）。 */}
              {insightsPressure}
            </button>
            <button
              type="button"
              style={closeButtonStyle}
              title={t('center.close')}
              aria-label={`${t('center.close')} ${t('center.insights')}`}
              data-hover="close"
              data-center-tab-close={INSIGHTS_TAB}
              onClick={() => { onCloseFixed('insights') }}
            >
              ×
            </button>
          </span>
        )}
        {tabs.files.map((tab) => {
          const status = statuses[tab.path]
          return (
            <span key={tab.path} style={groupStyle} role="presentation">
              {status !== undefined && <StatusDot status={status} t={t} />}
              <button
                type="button"
                role="tab"
                aria-selected={tabs.active === tab.path}
                aria-controls={panelId(tab.path)}
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
            </span>
          )
        })}
      </div>
      <div style={bodyStyle}>
        <div
          role="tabpanel"
          id={panelId(CONVERSATION_TAB)}
          aria-label={t('center.conversation')}
          style={{ ...pageStyle, display: conversationActive ? 'flex' : 'none' }}
          data-tab={CONVERSATION_TAB}
        >
          {renderConversation()}
        </div>
        <div
          role="tabpanel"
          id={panelId(TASKS_TAB)}
          aria-label={t('center.tasks')}
          style={{ ...pageStyle, display: tasksActive ? 'flex' : 'none' }}
          data-tab={TASKS_TAB}
        >
          {tasksPane}
        </div>
        <div
          role="tabpanel"
          id={panelId(INBOX_TAB)}
          aria-label={t('center.inbox')}
          style={{ ...pageStyle, display: inboxActive ? 'flex' : 'none' }}
          data-tab={INBOX_TAB}
        >
          {inboxPane}
        </div>
        <div
          role="tabpanel"
          id={panelId(SCHEDULE_TAB)}
          aria-label={t('center.schedule')}
          style={{ ...pageStyle, display: scheduleActive ? 'flex' : 'none' }}
          data-tab={SCHEDULE_TAB}
        >
          {schedulePane}
        </div>
        <div
          role="tabpanel"
          id={panelId(INSIGHTS_TAB)}
          aria-label={t('center.insights')}
          style={{ ...pageStyle, display: insightsActive ? 'flex' : 'none' }}
          data-tab={INSIGHTS_TAB}
        >
          {insightsPane}
        </div>
        {tabs.files.map(tab => (
          <div
            key={tab.path}
            role="tabpanel"
            id={panelId(tab.path)}
            aria-label={tab.title}
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
