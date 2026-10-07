/**
 * The 洞察 tab's pane (ADR-0050): a root-scoped Frame child that owns the
 * tab's chrome and renders the current-session dashboard through its
 * `insights.session` child slot. The nesting is deliberate — the pane itself
 * is root scope so it exists (and later hosts the cross-session overview,
 * batch 3) even while no session is open, while the dashboard rides the
 * `session-maybe` child slot so the slot machinery threads the current
 * session's projection seat through, exactly the footer.status precedent.
 */

import type { ReactElement } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

export type InsightPaneProps = PropsRenderSlots<'insights.session'>

export function InsightPane({ renderSlot }: InsightPaneProps): ReactElement {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {renderSlot('insights.session', {})}
    </div>
  )
}
