/**
 * The workbench's brand mark: the PARAP wordmark, filling the hero's
 * `conversation.hero.brand.mark` slot so the middle column stops borrowing
 * upstream's fish. Drawn in `currentColor` like the fallback it replaces, so
 * it follows the active theme without a colour of its own.
 *
 * Two stacked lines: PARAP in big caps, then the five words it stands for —
 * projects, areas, resources, archives, people — in small grey underneath.
 * The headline locale string is empty; this mark IS the brand text. The
 * sizes are pinned (48/16): the slot's 34px suggestion belongs to the fish
 * it replaced, not to a two-line wordmark.
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

const capsStyle = { fontSize: 48, fontWeight: 700, lineHeight: 1.1, letterSpacing: '0.06em' } as const

const wordsStyle = { fontSize: 16, fontWeight: 400, lineHeight: 1.3, opacity: 0.55 } as const

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
