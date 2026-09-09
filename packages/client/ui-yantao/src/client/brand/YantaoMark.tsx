/**
 * The workbench's brand mark: the PARAP monogram, filling the hero's
 * `conversation.hero.brand.mark` slot so the middle column stops borrowing
 * upstream's fish. Drawn in `currentColor` like the fallback it replaces, so
 * it follows the active theme without a colour of its own.
 *
 * The shape is a P: a stem plus a bowl whose counter is knocked out with the
 * even-odd rule — two subpaths, no glyph font and no external asset.
 * @module @deepseek-ai/dsh-client-ui-yantao/brand
 */
import type { ReactElement } from 'react'

/** The bowl and its counter: outer half-round from y=4 to y=14, then the hole. */
const BOWL = 'M8.4 4H13.5A5 5 0 0 1 13.5 14H8.4V4Zm3.4 3.1v3.8h1.3a1.9 1.9 0 0 0 0-3.8h-1.3Z'

/** Props the hero hands its brand mark (upstream's `HeroBrandMarkOwnerProps`). */
export interface YantaoMarkProps {
  /** Requested square edge in pixels. */
  readonly size: number
  /** Host class preserving the surrounding mark geometry. */
  readonly className?: string | undefined
}

/**
 * Render the PARAP mark at the requested size.
 * @param props - see {@link YantaoMarkProps}.
 * @returns the mark element.
 */
export function YantaoMark({ size, className }: YantaoMarkProps): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="5" y="4" width="3.4" height="16" rx="1.7" />
      <path d={BOWL} fillRule="evenodd" />
    </svg>
  )
}
