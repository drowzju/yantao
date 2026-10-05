/**
 * The two button faces every surface shares (design.md §7, 2026-10-05 第三轮
 * 评审 #7 的裁决)：主行动一律实心 accent 面——这是页面上唯一的实心彩色，
 * 视线落点不需要竞争；次级动作穿幽灵装。之前主钮有两副面孔（裁决卡的实心
 * vs 调度面板的 accent-bg 淡底），淡底回归它的文档角色——选中态。
 */

/** 主行动钮（写入 N 项 / 保存 / 批准 / 提交回答）：实心 accent，字随主题取表面色。 */
export const primaryButtonStyle = {
  padding: '4px 12px',
  minHeight: 'var(--yt-control-min-h)',
  background: 'var(--yt-accent-strong)',
  border: '1px solid transparent',
  borderRadius: 6,
  color: 'var(--yt-surface-primary)',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
  cursor: 'pointer',
} as const

/** 次级动作（取消 / 全部接受 / 全部忽略 / 丢弃）：安静的幽灵钮。 */
export const ghostButtonStyle = {
  padding: '4px 10px',
  minHeight: 'var(--yt-control-min-h)',
  background: 'transparent',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  color: 'var(--yt-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
  cursor: 'pointer',
} as const

/** Disabled 的统一弱化：内联样式画不了 :disabled，随 props 现算。 */
export const disabledOverlay = { opacity: 0.45, cursor: 'default' } as const
