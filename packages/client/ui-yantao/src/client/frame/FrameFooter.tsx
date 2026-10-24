/**
 * The window's footer strip (2026-10-24 评审 P2-4 拆分): the four fixed-tab
 * switches (任务/提议/调度/洞察) sit at the bottom-left, the four low-frequency
 * dialog entries (模型配置/工作空间 CLI/钉钉/快捷键) at the bottom-right.
 *
 * Split out of Frame.tsx verbatim — same faces, same data-* stamps, same
 * focus hand-back — so the frame keeps only layout and cross-module state.
 * The switches and the centre tab strip point at the same destinations on
 * purpose (DESIGN §5 补充): the footer is the way back in for a closed tab,
 * and the only home of the badges once its tab is gone.
 */
import type { ReactElement, ReactNode } from 'react'
import { toolButtonStyle } from '../buttons.ts'
import { INBOX_TAB, INSIGHTS_TAB, SCHEDULE_TAB, TASKS_TAB } from '../tabs.ts'
import type { WorkbenchT } from '../locales.ts'

/** What the strip renders: the counters, the pressure mark, and the five doors. */
export interface FrameFooterProps {
  /** The workbench dictionary's bound translator. */
  readonly t: WorkbenchT
  /** The centre pane's active tab key — the switches' aria-current source. */
  readonly activeTab: string
  /** Whether the 洞察 tab is closed: its switch then carries the pressure mark. */
  readonly insightsClosed: boolean
  /** Running task rows — the 任务 badge. */
  readonly runningTasks: number
  /** Pending proposals plus pending memory proposals — the 提议 badge. */
  readonly pendingInbox: number
  /** The insights pressure mark, already rendered by the slot (ADR-0057). */
  readonly insightsPressure: ReactNode
  /** Switch to one centre tab (opens it first when it is closed). */
  readonly onActivate: (tab: string) => void
  readonly onOpenConfig: () => void
  readonly onOpenWsCli: () => void
  readonly onOpenDingtalk: () => void
  readonly onOpenShortcuts: () => void
}

const stripStyle = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  padding: 'var(--yt-space-1) var(--yt-space-3)',
  borderTop: '1px solid var(--yt-border-subtle)',
  background: 'var(--yt-surface-primary)',
} as const

/** 页脚「配置」「快捷键」是常驻低频入口：穿共享 tool 面（无边框、label
    字号、弱墨），只保留比行内工具宽一档的内边距（2026-10-14 复评 B：
    此前是裸 UA 按钮，页脚与暖纸界面像两个软件）。 */
const buttonStyle = { ...toolButtonStyle, padding: 'var(--yt-space-1) var(--yt-space-3)' } as const

/** 页脚开关的激活面（2026-10-23 评审 P1-4）：四个开关与中栏页签同目的地，
    此前点已激活的那个毫无反馈、读屏也听不出「当前在哪」——§5 要求全工作台
    只有一种「当前在哪」的说法，页脚这处现在也给出同一句话（accent 底 + 字）。 */
function switchFace(active: boolean): React.CSSProperties {
  return active
    ? { ...buttonStyle, background: 'var(--yt-accent-bg)', color: 'var(--yt-accent-text)' }
    : buttonStyle
}

/** The switches' counter pill (2026-10-15): same cut as the 任务 hub's
    sub-tab badges — accent ground, on-accent ink — so one number reads the
    same everywhere. */
const badgeStyle = {
  borderRadius: 8,
  background: 'var(--yt-accent)',
  color: 'var(--yt-on-accent)',
  fontSize: 'var(--yt-type-label)',
  lineHeight: '16px',
  padding: '0 var(--yt-space-2)',
  marginLeft: 'var(--yt-space-1)',
} as const

/**
 * Render the footer strip.
 * @param props - see {@link FrameFooterProps}.
 * @returns the strip element.
 */
export function FrameFooter({
  t, activeTab, insightsClosed, runningTasks, pendingInbox, insightsPressure,
  onActivate, onOpenConfig, onOpenWsCli, onOpenDingtalk, onOpenShortcuts,
}: FrameFooterProps): ReactElement {
  return (
    <div style={stripStyle}>
      <button
        style={switchFace(activeTab === TASKS_TAB)}
        aria-current={activeTab === TASKS_TAB ? 'page' : undefined}
        data-footer-tasks="true"
        data-hover="true"
        onClick={() => { onActivate(TASKS_TAB) }}
      >
        {t('footer.tasks')}
        {runningTasks > 0 && <span data-footer-badge="tasks" style={badgeStyle}>{runningTasks}</span>}
      </button>
      <button
        style={switchFace(activeTab === INBOX_TAB)}
        aria-current={activeTab === INBOX_TAB ? 'page' : undefined}
        data-footer-inbox="true"
        data-hover="true"
        onClick={() => { onActivate(INBOX_TAB) }}
      >
        {t('footer.inbox')}
        {pendingInbox > 0 && <span data-footer-badge="inbox" style={badgeStyle}>{pendingInbox}</span>}
      </button>
      <button
        style={switchFace(activeTab === SCHEDULE_TAB)}
        aria-current={activeTab === SCHEDULE_TAB ? 'page' : undefined}
        data-footer-schedule="true"
        data-hover="true"
        onClick={() => { onActivate(SCHEDULE_TAB) }}
      >
        {t('footer.schedule')}
      </button>
      <button
        style={switchFace(activeTab === INSIGHTS_TAB)}
        aria-current={activeTab === INSIGHTS_TAB ? 'page' : undefined}
        data-footer-insights="true"
        data-hover="true"
        onClick={() => { onActivate(INSIGHTS_TAB) }}
      >
        {t('footer.insights')}
        {/* The pressure alarm rides the tab label while the tab is open;
            once it closes, the footer switch is its only home — the alarm
            must stay globally visible (ADR-0057). */}
        {insightsClosed && insightsPressure}
      </button>
      {/* 右侧四个对话框入口（2026-10-24 用户反馈）：点开后模态会把焦点还给
          按钮，程序化聚焦触发 :focus-visible 蓝框，与左侧四个 tab 开关
          （焦点随即走进内容区）观感不一致——开对话框前主动交还焦点。 */}
      <button style={{ ...buttonStyle, marginLeft: 'auto' }} data-config-button="true" data-hover="true" onClick={(event) => { event.currentTarget.blur(); onOpenConfig() }}>
        {t('config.open')}
      </button>
      {/* 2026-10-23：工作空间无头 CLI 的 key/模型配置，独立低频入口。 */}
      <button style={buttonStyle} data-wscli-button="true" data-hover="true" onClick={(event) => { event.currentTarget.blur(); onOpenWsCli() }}>
        {t('wscli.open')}
      </button>
      {/* ADR-0060 决定 2：底部状态条的钉钉入口，配置对话框沿模型配置范式。 */}
      <button style={buttonStyle} data-dingtalk-button="true" data-hover="true" onClick={(event) => { event.currentTarget.blur(); onOpenDingtalk() }}>
        {t('dingtalk.open')}
      </button>
      {/* 2026-10-09 第四轮评审 P1：8 条热键注册后无处可见——这个只读目录
          是它们的展示面，键帽实时读注册表 catalog（改键/平台差异自动跟随）。 */}
      <button style={buttonStyle} data-shortcuts-button="true" data-hover="true" onClick={(event) => { event.currentTarget.blur(); onOpenShortcuts() }}>
        {t('shortcuts.open')}
      </button>
    </div>
  )
}
