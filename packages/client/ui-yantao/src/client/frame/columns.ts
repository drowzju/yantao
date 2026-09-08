/**
 * The workbench frame's own column geometry (ADR-0011). Ported in spirit from
 * ui-layout's concession chain but symmetric: both rails concede, and the
 * wider one concedes first so neither side is privileged. Pure — the frame
 * feeds it the viewport and the two width preferences (0 = collapsed).
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only as the last resort. */
export interface FrameColumns { intake: number; center: number; workspace: number }

/** Rail drag floor. */
export const RAIL_MIN = 200
/** Rail drag ceiling. */
export const RAIL_MAX = 420
/** Rail width before any user drag. */
export const RAIL_DEFAULT = 280
/** Collapsed rail: an icon column. */
export const RAIL_COLLAPSED = 40
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 480
/** Viewport width below which both rails start collapsed. */
export const NARROW = 1024

/**
 * Clamp a rail width into its drag range.
 * @param px - requested width.
 * @returns the clamped width.
 */
export function clampRail(px: number): number {
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(px)))
}

/**
 * Solve the three column widths for one viewport frame. No hysteresis: the
 * output is a function of (viewport, preferences) only, so re-widening the
 * window restores the rails automatically.
 * @param viewport - available frame width in px.
 * @param intake - left rail preference in px (0 = collapsed).
 * @param workspace - right rail preference in px (0 = collapsed).
 * @returns resolved widths.
 */
export function solveColumns(viewport: number, intake: number, workspace: number): FrameColumns {
  let left = intake === 0 ? RAIL_COLLAPSED : clampRail(intake)
  let right = workspace === 0 ? RAIL_COLLAPSED : clampRail(workspace)
  const deficit = left + right + CENTER_MIN - viewport
  if (deficit <= 0) return { intake: left, center: viewport - left - right, workspace: right }

  // Concede from the wider rail first, then from the other; neither goes below
  // RAIL_MIN — a still-negative center is the honest last resort.
  const [first, second] = right >= left ? ['right', 'left'] as const : ['left', 'right'] as const
  const giveFirst = Math.min(deficit, (first === 'right' ? right : left) - RAIL_MIN)
  if (first === 'right') right -= giveFirst
  else left -= giveFirst
  const giveSecond = Math.min(deficit - giveFirst, (second === 'right' ? right : left) - RAIL_MIN)
  if (giveSecond > 0) {
    if (second === 'right') right -= giveSecond
    else left -= giveSecond
  }
  return { intake: left, center: Math.max(0, viewport - left - right), workspace: right }
}
