/**
 * The 洞察 tab's pane (ADR-0050): a root-scoped Frame child that owns the
 * tab's chrome and splits itself between its two regions — the
 * current-session dashboard (`insights.session`, `session-maybe` scope, so
 * the slot machinery threads the current session's projection seat
 * through) above the cross-session overview (`insights.overview`, root
 * scope: it exists regardless of session selection). The split is REAL:
 * the pane never scrolls (`overflow: hidden`) — the dashboard is `flex: 1`
 * with its own scroll, the overview is an explicit-px-height flex item
 * whose top edge is a draggable divider; dragging redistributes, and both
 * regions always stay fully inside the pane.
 * The overview sits LAST and mounts expanded with its data unloaded — only
 * an explicit button (never a mount, a drag or an expand gesture) fires the
 * first ledger read, which can fold every stored session, so it must never
 * delay the panels above.
 * The overview's 「查看洞察」 opens a session without leaving the tab, and
 * the dashboard region re-threads to the newly current session.
 */

import type { ReactElement } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

export type InsightPaneProps = PropsRenderSlots<'insights.overview' | 'insights.session'> & {
  /**
   * Swing the centre pane to the conversation tab (the Frame's owner prop,
   * required here so it can be forwarded to the `insights.overview` slot's
   * required `InsightsOverviewOwnerProps`).
   */
  readonly onSwitchToConversation: () => void
  /**
   * Whether the insights tab is the centre pane's active one (the Frame's
   * owner prop). While inactive the pane renders a quiet placeholder, so the
   * two regions' log reads and ledger fetches only start once the human
   * actually opens the tab; defaults to true for embedders without the prop.
   */
  readonly active?: boolean | undefined
}

export function InsightPane({ renderSlot, onSwitchToConversation, active = true }: InsightPaneProps): ReactElement {
  if (!active) {
    return <div style={{ flex: 1, minWidth: 0, minHeight: 0 }} data-insights-pane="idle" />
  }
  return (
    <div
      style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      data-insights-pane="split"
    >
      {renderSlot('insights.session', {})}
      {renderSlot('insights.overview', { onSwitchToConversation })}
    </div>
  )
}
