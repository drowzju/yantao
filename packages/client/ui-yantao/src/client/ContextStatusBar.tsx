/**
 * Footer context-occupancy status bar (ADR-0039): the workbench's own,
 * always-visible reading of the CURRENT session's context pressure — a
 * segmented bar plus a percentage, sitting beside the 配置 button in the
 * footer strip. Click opens a detail popover: the heuristic composition
 * (system prompt with the yantao share called out, tool definitions,
 * conversation) and the remaining budget.
 *
 * Data planes: the `contextPressure` / `contextBreakdown` projections feed
 * the bar and the three composition rows; the yantao injection share is
 * priced on demand through the `yantaoKb.promptInjection` Remote when the
 * panel opens. No session, or no provider sample yet, reads as a muted
 * `--` — the workbench's own runs (capabilities, mail analyses) are
 * separate sessions and never bleed into this figure.
 */

import { useEffect, useRef, useState } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { KbPromptInjectionResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { useDialogModal } from './use-dialog-modal.ts'
import type { WorkbenchT } from './locales.ts'
import css from './ContextStatusBar.module.css'

export interface ContextStatusBarProps {
  useProjection: UseProjection
  /** Current session identity, absent while no session is selected. */
  readonly sessionId: string | undefined
  /** Price the yantao layer's own system-prompt share (ADR-0039). */
  readonly promptInjection: () => Promise<KbPromptInjectionResult>
  /** The workbench dictionary's bound translator (slot locale seat). */
  readonly t: WorkbenchT
}

/** Occupancy thresholds: amber past 80%, red past 95%. */
const WARNING_PERCENT = 80
const DANGER_PERCENT = 95

/**
 * Format a token count compactly for the status bar and its panel.
 * @param value - token count.
 * @returns `842`, `12.3k`, or `1.2M` style figures.
 */
export function formatTokens(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${Math.round(value / 100) / 10}k`
  return `${Math.round(value / 100_000) / 10}M`
}

export function ContextStatusBar({ useProjection, sessionId, promptInjection, t }: ContextStatusBarProps) {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const [open, setOpen] = useState(false)
  const [injection, setInjection] = useState<KbPromptInjectionResult | null>(null)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  // Same resolution order the composer ring uses: the provider-anchored
  // projection first, the raw last-sample pressure as its fallback.
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const capacity = pressure?.contextWindow
  const hasData = used !== undefined && capacity !== undefined && capacity > 0
  const percent = hasData ? Math.min(100, Math.round(used / capacity * 100)) : null
  const tone = percent === null
    ? css.idle
    : percent > DANGER_PERCENT ? css.danger : percent > WARNING_PERCENT ? css.warning : ''

  // The yantao share is priced only when the panel asks for it: one RPC per
  // open, the latest answer winning (a reopen refetches — the injection
  // follows the KB's behavior memory, so a cached figure would lie).
  useEffect(() => {
    if (!open) return
    let stale = false
    void promptInjection().then(
      (result) => { if (!stale) setInjection(result) },
      () => { if (!stale) setInjection(null) },
    )
    return () => { stale = true }
  }, [open, promptInjection])

  // Outside click / Escape close, one document listener while open.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // 模态纪律（2026-10-05 收敛）：弹层打开时焦点进面板、关闭时还给触发点、
  // Tab 圈在面板里——此前开合全不管焦点，键盘用户「进了又出不来」。外点
  // 关闭仍由上面的 document 监听负责，两层各管各的通道。
  const { cardRef, onPanelKeyDown } = useDialogModal({ active: open, onClose: () => { setOpen(false) } })

  const ariaLabel = percent === null
    ? (sessionId === undefined ? t('context.noSession') : t('context.unavailable'))
    : t('context.aria', { percent })

  const injectionTotal = injection === null
    ? null
    : injection.staticTokens + injection.behaviorMemoryTokens

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={`${css.trigger} ${tone}`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={ariaLabel}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.bar}>
          {percent !== null && <span className={css.fill} style={{ transform: `scaleX(${percent / 100})` }} />}
        </span>
        <span className={css.reading}>{percent === null ? '--' : `${percent}%`}</span>
      </button>
      {open && (
        <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('context.title')} tabIndex={-1} ref={cardRef} onKeyDown={onPanelKeyDown} style={{ outline: 'none' }}>
          <p className={css.panelTitle}>{t('context.title')}</p>
          {!hasData ? (
            <p className={css.footnote}>{sessionId === undefined ? t('context.noSession') : t('context.unavailable')}</p>
          ) : (
            <>
              <dl className={css.rows}>
                {breakdown !== undefined && (
                  <>
                    <div className={css.row}>
                      <dt className={css.rowDt}>{t('context.system')}</dt>
                      <dd className={css.rowDd}>
                        {`~${formatTokens(breakdown.systemTokens)} · ${capacity > 0 ? Math.round(breakdown.systemTokens / capacity * 100) : 0}%`}
                      </dd>
                    </div>
                    {injectionTotal !== null && (
                      <div className={css.row}>
                        <dt className={`${css.rowDt} ${css.subRow}`}>{t('context.yantao')}</dt>
                        <dd className={css.rowDd}>
                          {`~${formatTokens(injectionTotal)} · ${capacity > 0 ? Math.round(injectionTotal / capacity * 100) : 0}%`}
                        </dd>
                      </div>
                    )}
                    <div className={css.row}>
                      <dt className={css.rowDt}>{t('context.tools')}</dt>
                      <dd className={css.rowDd}>
                        {`~${formatTokens(breakdown.toolsTokens)} · ${capacity > 0 ? Math.round(breakdown.toolsTokens / capacity * 100) : 0}%`}
                      </dd>
                    </div>
                    <div className={css.row}>
                      <dt className={css.rowDt}>{t('context.messages')}</dt>
                      <dd className={css.rowDd}>
                        {`~${formatTokens(breakdown.messageTokens)} · ${capacity > 0 ? Math.round(breakdown.messageTokens / capacity * 100) : 0}%`}
                      </dd>
                    </div>
                  </>
                )}
                <div className={css.row}>
                  <dt className={css.rowDt}>{t('context.remaining')}</dt>
                  <dd className={css.rowDd}>{`${formatTokens(Math.max(0, capacity - used))} · ${Math.max(0, 100 - (percent ?? 0))}%`}</dd>
                </div>
              </dl>
              <p className={css.footnote}>{t('context.estimated')}</p>
            </>
          )}
        </div>
      )}
    </span>
  )
}
