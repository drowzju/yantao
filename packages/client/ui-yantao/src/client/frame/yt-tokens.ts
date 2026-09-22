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
    '--yt-text-muted': '#9a9488',
    '--yt-border-subtle': '#e6e2d8',
    '--yt-border-strong': '#d8d2c4',
    '--yt-accent': '#4a7fd4',
    '--yt-accent-bg': '#eef3ff',
    '--yt-accent-border': '#c7d7ff',
    '--yt-success': '#4f9d5d',
    '--yt-warning': '#d8a13a',
    '--yt-warning-text': '#8a6d3a',
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
    '--yt-text-muted': '#7a756b',
    '--yt-border-subtle': '#35322d',
    '--yt-border-strong': '#454138',
    '--yt-accent': '#7ba3e0',
    '--yt-accent-bg': '#232c3d',
    '--yt-accent-border': '#3a4d75',
    '--yt-success': '#6fb87d',
    '--yt-warning': '#d8a13a',
    '--yt-warning-text': '#d8b96a',
    '--yt-warning-bg': '#3a3222',
    '--yt-error': '#d06a5e',
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
