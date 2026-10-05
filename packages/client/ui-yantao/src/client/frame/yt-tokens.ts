/**
 * The `--yt-*` design-token family (docs/yantao/design.md §2–4), written onto
 * `body.style` by the {@link ./theme-presenter.ts} alongside the upstream
 * alias tokens. Two scheme-dependent colour sets (light/dark) plus one
 * scheme-independent set (the type and space ladders). Components reference
 * the variables and never the values, so a scheme switch reskins every pane
 * without touching component code.
 */

/** Colour tokens keyed by the theme snapshot's `colorScheme`. */
export const YT_COLOR_TOKENS: { light: Record<string, string>; dark: Record<string, string> } = {
  light: {
    '--yt-surface-primary': '#fbfaf7',
    '--yt-surface-secondary': '#f1f0ec',
    '--yt-surface-raised': '#fffdf7',
    '--yt-text-primary': '#2e2b26',
    '--yt-text-secondary': '#6b6455',
    // 2026-10-05 对比度修订：muted 从 #9a9488（2.9:1）加深到对三张浅表
    // 全部 ≥4.5:1，同时保住比 secondary 浅一档的层级。
    '--yt-text-muted': '#726c5e',
    '--yt-border-subtle': '#e6e2d8',
    '--yt-border-strong': '#d8d2c4',
    '--yt-accent': '#4a7fd4',
    // 文字级的 accent：--yt-accent 作文字在 accent-bg 上只有 3.6:1，
    // 芯片与链接一类的文字场合用这一档。
    '--yt-accent-text': '#3a66b5',
    // 实心 accent 面（主按钮）：白字在其上 5.6:1。
    '--yt-accent-strong': '#3a66b5',
    '--yt-accent-bg': '#eef3ff',
    '--yt-accent-border': '#c7d7ff',
    '--yt-success': '#4f9d5d',
    '--yt-success-text': '#38754a',
    '--yt-success-bg': '#eaf4ec',
    '--yt-warning': '#d8a13a',
    '--yt-warning-text': '#7f6335',
    '--yt-warning-bg': '#fdf3d8',
    '--yt-error': '#b4453a',
    '--yt-error-bg': '#fbe9e7',
  },
  dark: {
    '--yt-surface-primary': '#1b1916',
    '--yt-surface-secondary': '#242220',
    '--yt-surface-raised': '#211f1c',
    '--yt-text-primary': '#e8e4dc',
    '--yt-text-secondary': '#a8a296',
    '--yt-text-muted': '#918b80',
    '--yt-border-subtle': '#35322d',
    '--yt-border-strong': '#454138',
    '--yt-accent': '#7ba3e0',
    '--yt-accent-text': '#7ba3e0',
    '--yt-accent-strong': '#7ba3e0',
    '--yt-accent-bg': '#232c3d',
    '--yt-accent-border': '#3a4d75',
    '--yt-success': '#6fb87d',
    '--yt-success-text': '#6fb87d',
    '--yt-success-bg': '#2a3328',
    '--yt-warning': '#d8a13a',
    '--yt-warning-text': '#d8b96a',
    '--yt-warning-bg': '#3a3222',
    // 从 #d06a5e 提亮：error 作文字压 error-bg 要过 4.5:1。
    '--yt-error': '#da8177',
    '--yt-error-bg': '#3a2422',
  },
}

/** Scheme-independent tokens: the type ladder (§3) and the space ladder (§4). */
export const YT_STATIC_TOKENS: Record<string, string> = {
  '--yt-type-label': '12px',
  '--yt-type-body': '13px',
  '--yt-type-section': '14px',
  '--yt-type-title': '16px',
  '--yt-type-display': '20px',
  '--yt-space-1': '4px',
  '--yt-space-2': '8px',
  '--yt-space-3': '12px',
  '--yt-space-4': '16px',
  '--yt-space-5': '24px',
  '--yt-space-6': '32px',
  // 交互控件的最小高度（2026-10-05 命中目标修订）：裁决类按钮的误触代价是
  // 写脏知识库，Fitts 定律不吃商量——按钮统一 minHeight 到这一档。
  '--yt-control-min-h': '28px',
}

/**
 * The full `--yt-*` set for one colour scheme — the ladders overlaid with the
 * scheme's colours — in the order the presenter writes them.
 * @param scheme - the active snapshot's colour scheme.
 * @returns every token name and value to write onto the body.
 */
export function ytTokensFor(scheme: string): Record<string, string> {
  return { ...YT_STATIC_TOKENS, ...(scheme === 'dark' ? YT_COLOR_TOKENS.dark : YT_COLOR_TOKENS.light) }
}
