/**
 * The workbench's brand mark: the PARAP wordmark, filling the hero's
 * `conversation.hero.brand.mark` slot so the middle column stops borrowing
 * upstream's fish. Drawn in `currentColor` like the fallback it replaces, so
 * it follows the active theme without a colour of its own.
 *
 * Two stacked lines: PARAP, then the five words it stands for — projects,
 * areas, resources, archives, people — in small secondary ink underneath.
 * The headline locale string is empty; this mark IS the brand text.
 *
 * 2026-10-23 评审 P2：此前 48px/700/0.06em 全在字阶之外——hero 是问候语的
 * 配角，却比页面上唯一的主标题（20px display）还响。字标回到阶梯上：
 * 20px semibold，五词 12px secondary，靠字重与次级墨色分层，不靠超档字号。
 * @module @deepseek-ai/dsh-client-ui-yantao/brand
 */
import type { ReactElement } from 'react'

/** Props the hero hands its brand mark (upstream's `HeroBrandMarkOwnerProps`). */
export interface YantaoMarkProps {
  /** Requested square edge in pixels — ignored; the wordmark pins its own sizes. */
  readonly size: number
  /** Host class preserving the surrounding mark geometry. */
  readonly className?: string | undefined
}

const wordmarkStyle = {
  display: 'inline-flex', flexDirection: 'column', alignItems: 'center', whiteSpace: 'nowrap',
} as const

const capsStyle = { fontSize: 'var(--yt-type-display)', fontWeight: 600, lineHeight: 1.3 } as const

// 2026-10-23 评审 B：16px 文字用 opacity 0.55 压淡 --yt-text-primary，实测
// 3.38:1，不过 AA（§2.2「不用比 muted 更浅的文字凑密度」）。改用 secondary
// token（5.77:1），层次靠 token 而不是透明度。
const wordsStyle = { fontSize: 'var(--yt-type-label)', fontWeight: 400, lineHeight: 1.4, color: 'var(--yt-text-secondary)' } as const

/**
 * Render the PARAP wordmark.
 * @param props - see {@link YantaoMarkProps}.
 * @returns the mark element.
 */
export function YantaoMark({ className }: YantaoMarkProps): ReactElement {
  return (
    <span className={className} style={wordmarkStyle} aria-label="PARAP: projects, areas, resources, archives, people">
      <span style={capsStyle} aria-hidden="true">PARAP</span>
      <span style={wordsStyle} aria-hidden="true">projects, areas, resources, archives, people</span>
    </span>
  )
}
