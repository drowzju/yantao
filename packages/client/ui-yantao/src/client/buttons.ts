/**
 * The two button faces every surface shares (DESIGN.md §7, 2026-10-05 第三轮
 * 评审 #7 的裁决)：主行动一律实心 accent 面——这是页面上唯一的实心彩色，
 * 视线落点不需要竞争；次级动作穿幽灵装。之前主钮有两副面孔（裁决卡的实心
 * vs 调度面板的 accent-bg 淡底），淡底回归它的文档角色——选中态。
 */

/** 主行动钮（写入 N 项 / 保存 / 批准 / 提交回答）：实心 accent，字走 --yt-on-accent
    （2026-10-14 落地：暗色的 strong 是亮 accent，文字翻墨色才过对比度——
    此前取 --yt-surface-primary 碰巧同值，语义不对）。 */
export const primaryButtonStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-3)',
  minHeight: 'var(--yt-control-min-h)',
  background: 'var(--yt-accent-strong)',
  border: '1px solid transparent',
  borderRadius: 6,
  color: 'var(--yt-on-accent)',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
  cursor: 'pointer',
} as const

/** 次级动作（取消 / 全部接受 / 全部忽略 / 丢弃）：安静的幽灵钮。 */
export const ghostButtonStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  minHeight: 'var(--yt-control-min-h)',
  background: 'transparent',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  color: 'var(--yt-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
  cursor: 'pointer',
} as const

/** 行内小工具钮（↑↓ / 编辑 / ✕ / 通知条芯片 / 提名卡裁决）：label 字号、
    无边框、弱墨色——危险动作武装后自行叠加深红浮起。此前四个面板各养一份
    微缩幽灵（InboxPane 丢弃、CapabilityPanel 快捷工具、MemoryPanel 裁决、
    Frame 通知芯片），字号与内边距各有出入。 */
export const toolButtonStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  color: 'var(--yt-text-muted)',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-label)',
  cursor: 'pointer',
} as const

/** 表单行的次级钮（新增 / 打开全文 / 保存草稿）：浮起表面 + 细边框 +
    body 字号——比幽灵钮重一档，但不抢主行动的视线。此前 SchedulePane
    私养一份，TodoBoard / CapabilityPanel 则是裸 UA 按钮（连最小命中
    高度都没有）。 */
export const raisedButtonStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  color: 'var(--yt-text-primary)',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
  cursor: 'pointer',
} as const

/** Disabled 的统一弱化：内联样式画不了 :disabled，随 props 现算。
    2026-10-12 复检对比度审计：opacity 整体减淡会把实心 accent 底与近白字
    一起向背后的表面收敛（浅色实测 ≈1.9:1、暗色 ≈2.4:1），弱到看不出那
    里本来有个钮。主行动的禁用态改走专用面——弱表面 + muted 字，muted
    本就按对表面 ≥4.5:1 调过；WCAG 1.4.3 豁免禁用件，这里求的是可感知。 */
export const primaryButtonDisabledStyle = {
  ...primaryButtonStyle,
  background: 'var(--yt-surface-secondary)',
  color: 'var(--yt-text-muted)',
  border: '1px solid var(--yt-border-subtle)',
  cursor: 'default',
} as const

/** 栏头页签的唯一构造（2026-10-12 评审 P1-2 + 用户实证的高度不一）：
    左采集栏、中栏、右工作区栏的 tab 头共用这两面——border-box 28px
    命中高、同一字阶同一内边距；激活态一律 accent 洗染。此前中栏自养
    一副凸面页签、两栏用裸 row 按钮撑高度，同屏三种「当前在哪」。
    激活态只换底与边，不动字色——accent-bg 上的正文墨色对比足够。 */
export const tabItemStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--yt-space-1)',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  // 拆开写而非 border 简写：激活面只改 borderColor，简写+单属性混用会
  // 触发 React 的 shorthand 冲突警告（vitest stderr 实测）。
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
  // 长文件名页签不许折行——折行会把 28px 命中高撑爆，条带随之参差。
  whiteSpace: 'nowrap',
  cursor: 'pointer',
} as const

export const tabItemActiveStyle = {
  ...tabItemStyle,
  background: 'var(--yt-accent-bg)',
  borderColor: 'var(--yt-accent-border)',
} as const

/** 行内危险钮武装态（2026-10-12 评审 P1-1）：两击武装的首击之后的样子——
    危险墨色浮起，让「再击就执行」在落地前看得见。配 toolButtonStyle
    使用：未武装穿 tool 面（§7 幽灵装），武装即换这一面。 */
export const toolButtonArmedStyle = {
  ...toolButtonStyle,
  color: 'var(--yt-error)',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-strong)',
  whiteSpace: 'nowrap',
} as const
