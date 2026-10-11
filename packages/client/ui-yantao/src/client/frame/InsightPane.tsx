/**
 * The 洞察 tab's pane (ADR-0050; ADR-0057 added the sub-tab shell): two
 * mutually-exclusive sub-pages — 关系图谱 (the frame's GraphPane, injected
 * as the `graph` owner prop) and 上下文信息 (the original split: the
 * current-session dashboard (`insights.session`, `session-maybe` scope, so
 * the slot machinery threads the current session's projection seat through)
 * above the cross-session overview (`insights.overview`, root scope)). The
 * sub-choice lives in component state — remembered within the session, never
 * persisted — and defaults to 上下文信息.
 * The context split is REAL: the pane never scrolls (`overflow: hidden`) —
 * the dashboard is `flex: 1` with its own scroll, the overview is an
 * explicit-px-height flex item whose top edge is a draggable divider;
 * dragging redistributes, and both regions always stay fully inside the pane.
 * The overview sits LAST and mounts expanded with its data unloaded — only
 * an explicit button (never a mount, a drag or an expand gesture) fires the
 * first ledger read, which can fold every stored session, so it must never
 * delay the panels above.
 * The overview's 「查看洞察」 opens a session without leaving the tab, and
 * the dashboard region re-threads to the newly current session.
 */

import { useState, type ReactElement, type ReactNode } from 'react'
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
  /**
   * The 关系图谱 sub-page's body (ADR-0057): the frame's GraphPane element,
   * handed in as an owner prop so the slot shell stays data-free.
   */
  readonly graph: ReactNode
}

/** The two sub-pages, in strip order. */
type InsightSub = 'graph' | 'context'

const SUB_LABELS: Record<InsightSub, string> = {
  graph: '关系图谱',
  context: '上下文信息',
}

const subButtonStyle = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'var(--yt-font-ui)',
  fontSize: 12,
  padding: '2px 10px',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  color: 'var(--yt-text-secondary)',
} as const

const activeSubButtonStyle = {
  ...subButtonStyle,
  background: 'var(--yt-surface-raised)',
  borderColor: 'var(--yt-border-subtle)',
  color: 'inherit',
} as const

export function InsightPane({ renderSlot, onSwitchToConversation, active = true, graph }: InsightPaneProps): ReactElement {
  // Remembered for the session only (ADR-0057): switching centre tabs hides
  // the pane but never unmounts it, so the choice survives the round trip.
  const [sub, setSub] = useState<InsightSub>('context')
  if (!active) {
    return <div style={{ flex: 1, minWidth: 0, minHeight: 0 }} data-insights-pane="idle" />
  }
  return (
    <div
      style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      data-insights-pane={sub}
    >
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px 0', flexShrink: 0 }}>
        {(Object.keys(SUB_LABELS) as InsightSub[]).map(key => (
          <button
            key={key}
            type="button"
            data-hover="tab"
            data-insights-sub={key}
            style={sub === key ? activeSubButtonStyle : subButtonStyle}
            onClick={() => { setSub(key) }}
          >
            {SUB_LABELS[key]}
          </button>
        ))}
      </div>
      {sub === 'graph' ? (
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }} data-insights-graph="true">
          {graph}
        </div>
      ) : (
        <div
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          data-insights-pane="split"
        >
          {renderSlot('insights.session', {})}
          {renderSlot('insights.overview', { onSwitchToConversation })}
        </div>
      )}
    </div>
  )
}
