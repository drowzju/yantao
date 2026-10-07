/**
 * The 洞察 tab's pane (ADR-0050): a root-scoped Frame child that owns the
 * tab's chrome and stacks its two regions — the cross-session overview
 * (`insights.overview`, root scope: it exists regardless of session
 * selection) above the current-session dashboard (`insights.session`,
 * `session-maybe` scope, so the slot machinery threads the current
 * session's projection seat through, exactly the footer.status precedent).
 * The overview's 「查看洞察」 opens a session without leaving the tab, and
 * the dashboard region re-threads to the newly current session.
 */

import type { ReactElement } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

export type InsightPaneProps = PropsRenderSlots<'insights.overview' | 'insights.session'> & {
  /** Swing the centre pane to the conversation tab (the Frame's owner prop). */
  readonly onSwitchToConversation?: (() => void) | undefined
}

export function InsightPane({ renderSlot, onSwitchToConversation }: InsightPaneProps): ReactElement {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {renderSlot('insights.overview', { onSwitchToConversation })}
      {renderSlot('insights.session', {})}
    </div>
  )
}
