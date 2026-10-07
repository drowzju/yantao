/**
 * The footer's 洞察 button (ADR-0050): sits right of 调度, opens the centre
 * pane's insights tab. Its border doubles as the context-pressure stroke —
 * amber past 80%, red past 95% — the same thresholds the status bar paints,
 * so the footer answers "how full is the context" before the tab is even
 * opened. Rendered inside the `footer.insights` slot (`session-maybe` scope):
 * the slot machinery threads the current session's projection seat through,
 * and the tab-activation gesture arrives as the owner prop the Frame hands
 * its slot outlets.
 */

import type { ReactElement } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the `contextPressure` projection key merge.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { DANGER_PERCENT, WARNING_PERCENT } from '../insights.ts'
import type { WorkbenchT } from '../locales.ts'

export interface InsightsFooterButtonProps {
  useProjection: UseProjection
  /** Current session identity, absent while no session is selected. */
  readonly sessionId: string | undefined
  /**
   * Open the centre pane's insights tab (the Frame's owner prop). Optional:
   * the slot's composed prop type doesn't carry owner props, and the button
   * degrades to a pressure-stroke indicator when absent.
   */
  readonly onOpen?: (() => void) | undefined
  /** The workbench dictionary's bound translator (slot locale seat). */
  readonly t: WorkbenchT
}

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 10px',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  fontSize: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'var(--yt-font-ui)',
  color: 'inherit',
} as const

/** Three ascending bars — the dashboard glyph. */
function BarsIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <rect x="1" y="7" width="2.4" height="4" rx="0.5" fill="currentColor" />
      <rect x="4.8" y="4" width="2.4" height="7" rx="0.5" fill="currentColor" />
      <rect x="8.6" y="1" width="2.4" height="10" rx="0.5" fill="currentColor" />
    </svg>
  )
}

export function InsightsFooterButton({ useProjection, onOpen, t }: InsightsFooterButtonProps): ReactElement {
  const pressure = useProjection('contextPressure')
  // Same resolution order the status bar uses (ADR-0039).
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const capacity = pressure?.contextWindow
  const percent = used !== undefined && capacity !== undefined && capacity > 0
    ? Math.min(100, Math.round(used / capacity * 100))
    : null
  const stroke = percent === null
    ? 'var(--yt-border-subtle)'
    : percent > DANGER_PERCENT ? 'var(--yt-error)' : percent > WARNING_PERCENT ? 'var(--yt-warning-text)' : 'var(--yt-border-subtle)'

  return (
    <button
      type="button"
      style={{ ...buttonStyle, borderColor: stroke }}
      data-insights-button="true"
      aria-label={t('insights.open')}
      title={t('insights.open')}
      onClick={onOpen}
    >
      <BarsIcon />
      {t('insights.open')}
    </button>
  )
}
