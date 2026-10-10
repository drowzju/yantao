/**
 * The 洞察 tab's cross-session overview (ADR-0050): the KPI trio (活跃会话 /
 * 累计 token / cache 命中率) with the 7天/30天/全部 range filter, the daily
 * bars and the eight-week heat grid over `yantaoUsage.dailyUsage`, and the
 * session-card wall folded from the session controller's list snapshot.
 *
 * One ledger fetch feeds every chart — personal scale keeps the whole ledger
 * a few hundred rows, so the range is a client-side slice and the heat grid
 * keeps its own fixed eight-week window. A heat cell click filters the cards
 * to that day's contributing sessions; a card's primary click opens the
 * session and swings to the conversation tab, the secondary 「查看洞察」
 * opens it and stays here — the current-session dashboard below re-threads
 * to the newly current session.
 *
 * The section mounts EXPANDED at 40% of the pane with a single
 * 「加载跨会话总览」 button as its body. The first ledger read can fold
 * every stored session (tens of seconds at personal scale), so it never
 * starts on its own — not on mount, and NOT on a divider drag either; the
 * load is always the explicit button. The visitor may cancel mid-fold, and
 * a failure offers 重试 instead of a dead panel. Heights are measured in
 * PX against the pane (a percentage cap silently never applied: its
 * containing block's height is indefinite), so the split is real and the
 * pane itself never scrolls. The top edge is a draggable divider in EVERY
 * face: dragging down past the threshold collapses to the slim bar, up
 * expands again; a double-click restores the default. 收起 folds to the
 * slim bar with the data retained — 展开 restores instantly without
 * refetching the ledger.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  DayUsageRecord, UsageBuckets, UsageWireDailyArgs, UsageWireDailyResult,
} from '@deepseek-ai/dsh-api-yantao-usage-controller/types'
import { formatTokens } from '../insights.ts'
import {
  barsForRange, cacheHitRateOf, distinctSessionsOf, filterSessionRows, grandTotalOf,
  heatmapCellsOf, sessionRowsOf, stampOf, todayKey,
} from '../overview.ts'
import type { OverviewRange } from '../overview.ts'
import type { WorkbenchT } from '../locales.ts'

export interface SessionOverviewProps {
  /** The session controller's list snapshot, reactive (global standard prop). */
  useSessions: UseSessions
  /** The whole day ledger, brought up to date first (the `yantaoUsage` read). */
  readonly dailyUsage: (args: UsageWireDailyArgs) => Promise<UsageWireDailyResult>
  /** One session's lifetime totals — the cold card's fallback read. */
  readonly fetchTotals: (sessionId: string) => Promise<UsageBuckets>
  /** Open one session in the workspace (it becomes the current session). */
  readonly openSession: (sessionId: string) => void
  /** Swing the centre pane to the conversation tab (the Frame's owner prop). */
  readonly onSwitchToConversation?: (() => void) | undefined
  /** The workbench dictionary's bound translator (slot locale seat). */
  readonly t: WorkbenchT
}

const FONT = 'var(--yt-font-ui)'

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
  padding: 12,
  // The section sits at the BOTTOM of the insights pane (below the session
  // dashboard), so its separator crowns it rather than foots it.
  borderTop: '1px solid var(--yt-border-subtle)',
  position: 'relative',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
} as const

// The draggable divider: the section's top edge, present in EVERY face
// (slim bar included). All heights are measured in px against the pane —
// a percentage would resolve against the slot wrapper's indefinite height
// and silently not apply, which is what let the section escape below the
// fold and made the pane itself scroll.
const DIVIDER_DEFAULT_SHARE = 0.40
const DIVIDER_MAX_SHARE = 0.85
const DIVIDER_MIN_HEIGHT = 96
// Dragging below this snaps the section to its slim bar; dragging back up
// expands it again — drags only resize, never firing the ledger load; the
// load stays on the explicit buttons.
const DIVIDER_COLLAPSE_BELOW = 140
// The drag cap when the split pane cannot be measured (marker missed):
// a generous ceiling so the drag still works, clamped by nothing.
const DIVIDER_FALLBACK_PANE_HEIGHT = 720

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
  padding: 12,
  borderRadius: 6,
  border: '1px solid var(--yt-border-subtle)',
  background: 'var(--yt-surface-primary)',
} as const

const cardTitleStyle = {
  margin: 0,
  fontSize: 'var(--yt-type-label)',
  fontWeight: 600,
  color: 'var(--yt-text-muted)',
} as const

const mutedStyle = { color: 'var(--yt-text-muted)' } as const

const pillButtonStyle = {
  fontSize: 'var(--yt-type-label)',
  fontFamily: FONT,
  padding: '0 6px',
  minHeight: 20,
  borderRadius: 4,
  cursor: 'pointer',
  borderWidth: 1,
  borderStyle: 'solid',
  color: 'inherit',
} as const

// The idle and collapsed faces are the same slim bar: title on the left,
// one action on the right. Its height is intrinsic (padding + one button);
// the px height mechanics live with the DIVIDER_* constants above.
const slimBarStyle = {
  ...sectionStyle,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
} as const

const slimActionButtonStyle = {
  ...pillButtonStyle,
  marginLeft: 'auto',
  padding: '4px 12px',
  minHeight: 26,
  borderColor: 'var(--yt-border-subtle)',
  background: 'var(--yt-surface-primary)',
} as const

/** The KPI trio's shared frame: label above, the figure below. */
function KpiCard({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <section style={cardStyle}>
      <p style={cardTitleStyle}>{label}</p>
      {children}
    </section>
  )
}

/** The four buckets in one muted line — the totals card's breakdown. */
function BucketLine({ buckets, t }: { buckets: UsageBuckets; t: WorkbenchT }): ReactElement {
  return (
    <p style={{ ...mutedStyle, margin: 0, fontSize: 'var(--yt-type-label)' }}>
      {`${t('insights.overview.bucket.input')} ${formatTokens(buckets.uncachedInputTokens)}`
        + ` · ${t('insights.overview.bucket.output')} ${formatTokens(buckets.outputTokens)}`
        + ` · ${t('insights.overview.bucket.cacheRead')} ${formatTokens(buckets.cacheReadTokens)}`
        + ` · ${t('insights.overview.bucket.cacheWrite')} ${formatTokens(buckets.cacheWriteTokens)}`}
    </p>
  )
}

/** Bar-label cadence: every bar in a week, every fifth in a month, none over the whole ledger. */
const LABEL_STRIDE: Record<OverviewRange, number> = { '7d': 1, '30d': 5, all: Number.POSITIVE_INFINITY }

/** The 每日用量 card: one bar per day in the range, grand-total height. */
function DailyBarsCard({ bars, range, t }: {
  bars: readonly DayUsageRecord[]
  range: OverviewRange
  t: WorkbenchT
}): ReactElement {
  const stride = LABEL_STRIDE[range]
  const peak = Math.max(1, ...bars.map(day => grandTotalOf(day)))
  return (
    <section style={cardStyle} data-insights-card="daily-bars">
      <p style={cardTitleStyle}>{t('insights.overview.bars.title')}</p>
      {bars.length === 0 ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{t('insights.overview.empty')}</p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 64 + 14 }}>
          {bars.map((day, index) => {
            const total = grandTotalOf(day)
            return (
              <span
                key={day.day}
                title={`${day.day} · ${formatTokens(total)}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', minWidth: 2 }}
              >
                <span style={{ height: total / peak * 64, background: 'var(--yt-accent)', minHeight: total > 0 ? 2 : 0 }} />
                {/* 2026-10-09 评审：9→10px——坐标刻度非正文，但不低于 10px 下限。 */}
                <span style={{ height: 12, textAlign: 'center', fontSize: 10, lineHeight: '12px', color: 'var(--yt-text-muted)', whiteSpace: 'nowrap' }}>
                  {index % stride === 0 ? day.day.slice(5) : ''}
                </span>
              </span>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Heat intensity: five steps from empty to the range's busiest day. */
const HEAT_STEPS: readonly number[] = [0, 0.25, 0.5, 0.75, 1]

function heatOpacity(total: number, peak: number): number {
  if (total === 0 || peak === 0) return 0
  return HEAT_STEPS[Math.min(4, Math.ceil(total / peak * 4))] ?? 0
}

/** The 近 8 周 card: eight weekly columns, Monday-first rows, click to filter. */
function HeatmapCard({ cells, activeDay, onPick, t }: {
  cells: readonly (readonly { day: string; total: number; future: boolean }[])[]
  activeDay: string | undefined
  onPick: (day: string | undefined) => void
  t: WorkbenchT
}): ReactElement {
  const peak = Math.max(1, ...cells.flat().map(cell => cell.total))
  return (
    <section style={cardStyle} data-insights-card="heatmap">
      <p style={cardTitleStyle}>{t('insights.overview.heatmap.title')}</p>
      <div
        role="grid"
        aria-label={t('insights.overview.heatmap.title')}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cells.length}, 12px)`,
          gridTemplateRows: 'repeat(7, 12px)',
          gridAutoFlow: 'column',
          gap: 2,
          width: 'fit-content',
        }}
      >
        {cells.flat().map((cell) => {
          const active = cell.day === activeDay
          return (
            <button data-hover="true"
              key={cell.day}
              type="button"
              disabled={cell.future}
              title={`${cell.day} · ${formatTokens(cell.total)}`}
              aria-label={`${cell.day} · ${formatTokens(cell.total)}`}
              onClick={() => { onPick(active ? undefined : cell.day) }}
              style={{
                width: 12,
                height: 12,
                padding: 0,
                border: active ? '1px solid var(--yt-accent-border)' : '1px solid transparent',
                borderRadius: 2,
                cursor: cell.future ? 'default' : 'pointer',
                background: cell.future
                  ? 'var(--yt-surface-raised)'
                  : `color-mix(in srgb, var(--yt-accent) ${Math.round(heatOpacity(cell.total, peak) * 100)}%, var(--yt-surface-raised))`,
              }}
            />
          )
        })}
      </div>
      {activeDay !== undefined && (
        <p style={{ ...mutedStyle, margin: 0, fontSize: 'var(--yt-type-label)' }}>
          {t('insights.overview.heatmap.filtered', { day: activeDay })}
        </p>
      )}
    </section>
  )
}

/** One session card: title, stamp, tokens, and the two open paths. */
function SessionCard({ row, fetchTotals, onOpen, onInsights, t }: {
  row: { id: string; title: string; cwd: string | undefined; updatedAt: number; running: boolean; totals: UsageBuckets | undefined }
  fetchTotals: (sessionId: string) => Promise<UsageBuckets>
  onOpen: (sessionId: string) => void
  onInsights: (sessionId: string) => void
  t: WorkbenchT
}): ReactElement {
  // Cold rows carry no projection values (ticket 01): one fallback read per
  // card, cached in local state; a refusal reads as 无记录, not an error.
  const [fallback, setFallback] = useState<UsageBuckets | undefined>(undefined)
  useEffect(() => {
    if (row.totals !== undefined) return
    let stale = false
    void fetchTotals(row.id).then(
      (totals) => { if (!stale) setFallback(totals) },
      () => { if (!stale) setFallback(undefined) },
    )
    return () => { stale = true }
  }, [row.totals, row.id, fetchTotals])
  const totals = row.totals ?? fallback
  return (
    <div
      role="button"
      tabIndex={0}
      data-insights-card="session"
      onClick={() => { onOpen(row.id) }}
      onKeyDown={(event) => {
        // Only the card itself reacts — Enter on the nested 查看洞察 button
        // bubbles here and would open the session twice.
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(row.id)
        }
      }}
      style={{
        ...cardStyle,
        cursor: 'pointer',
        gap: 4,
        padding: '8px 10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{row.title}</span>
        {row.running && (
          <span style={{ flexShrink: 0, fontSize: 'var(--yt-type-label)', color: 'var(--yt-success)' }}>{t('insights.overview.card.running')}</span>
        )}
        <span style={{ marginLeft: 'auto', flexShrink: 0, ...mutedStyle, fontSize: 'var(--yt-type-label)', fontVariantNumeric: 'tabular-nums' }}>
          {stampOf(row.updatedAt)}
        </span>
      </div>
      {row.cwd !== undefined && (
        <span style={{ ...mutedStyle, fontSize: 'var(--yt-type-label)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.cwd}
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {totals === undefined ? t('insights.overview.card.noUsage') : formatTokens(grandTotalOf(totals))}
        </span>
        <button data-hover="true"
          type="button"
          style={{ ...pillButtonStyle, marginLeft: 'auto', borderColor: 'var(--yt-border-subtle)', background: 'transparent' }}
          onClick={(event) => {
            event.stopPropagation()
            onInsights(row.id)
          }}
        >
          {t('insights.overview.card.insights')}
        </button>
      </div>
    </div>
  )
}

const RANGE_OPTIONS = ['7d', '30d', 'all'] as const

export function SessionOverview({
  useSessions, dailyUsage, fetchTotals, openSession, onSwitchToConversation, t,
}: SessionOverviewProps): ReactElement {
  const list = useSessions(state => state)
  const [result, setResult] = useState<UsageWireDailyResult | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle')
  // 收起只藏不卸：result 留在内存里，展开瞬间恢复，不重读账本。
  const [collapsed, setCollapsed] = useState(false)
  const [range, setRange] = useState<OverviewRange>('7d')
  const [query, setQuery] = useState('')
  const [activeDay, setActiveDay] = useState<string | undefined>(undefined)
  // 「今天」随每次读取重新锚定：跨午夜开着工作台时，刷新即把今天的行
  // 归位，而不是永远停在挂载那天的日期上。
  const [today, setToday] = useState(() => todayKey())
  // Divider height in px; undefined = "not measured yet" (the ~half-pane
  // default). The dashboard above is `flex: 1` with its own scroll, so it
  // absorbs whatever remainder the drag leaves.
  const [sectionHeight, setSectionHeight] = useState<number | undefined>(undefined)
  const [dividerHot, setDividerHot] = useState(false)
  const sectionRef = useRef<HTMLDivElement | null>(null)
  // The active drag's listener-detach closure, so unmount can detach mid-drag.
  const detachDragRef = useRef<(() => void) | null>(null)

  // The split container: InsightPane's marked box. Measuring THAT (not
  // parentElement, which may be a display:contents slot wrapper with no box
  // of its own) is what makes the px heights meaningful.
  const paneOf = useCallback((): HTMLElement | null =>
    (sectionRef.current?.closest('[data-insights-pane="split"]') ?? null), [])

  // One ledger fetch feeds the KPI trio, the bars and the heat grid; the
  // 刷新 gesture repeats it (a running session's today row keeps moving).
  // A ticket discards late answers, so a slow earlier fetch never overwrites
  // a newer one's result. Cancelling just bumps the ticket and resets the
  // phase to idle in place — neither folding nor unloading; the host-side single-flight scan keeps running and
  // warms the ledger, so the next tap answers almost instantly. The
  // in-flight flag stops a gesture storm (double-taps, errant repeats) from
  // queueing dozens of RPCs behind the host's single flight.
  const loadTicket = useRef(0)
  const loadInFlight = useRef(false)
  const load = useCallback(() => {
    if (loadInFlight.current) return
    loadInFlight.current = true
    const ticket = ++loadTicket.current
    setToday(todayKey())
    setPhase('loading')
    void dailyUsage({}).then(
      (answer) => {
        // A superseded answer must not release the in-flight flag: a newer
        // load owns it now, and clearing here would let further taps spawn
        // concurrent RPCs behind the host's single flight.
        if (ticket !== loadTicket.current) return
        loadInFlight.current = false
        setResult(answer)
        setPhase('ok')
      },
      () => {
        if (ticket !== loadTicket.current) return
        loadInFlight.current = false
        setPhase('failed')
      },
    )
  }, [dailyUsage])
  const cancel = useCallback(() => {
    loadTicket.current += 1
    loadInFlight.current = false
    setPhase('idle')
  }, [])

  // Window-level listeners, not element pointer capture: something higher in
  // the tree steals capture on pointerdown, which silences every
  // element-scoped move/up listener. Events always reach `window` regardless
  // of who holds the capture, so the drag survives.
  const dividerDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const section = sectionRef.current
    if (section === null) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = section.getBoundingClientRect().height
    const onMove = (move: PointerEvent): void => {
      const pane = paneOf()
      const max = pane === null
        ? DIVIDER_FALLBACK_PANE_HEIGHT
        : pane.clientHeight * DIVIDER_MAX_SHARE
      const target = Math.min(max, startHeight - (move.clientY - startY))
      if (target < DIVIDER_COLLAPSE_BELOW) {
        setCollapsed(true)
        return
      }
      setCollapsed(false)
      setSectionHeight(Math.max(DIVIDER_MIN_HEIGHT, target))
    }
    // Detach is hoisted so an unmount mid-drag can tear the listeners down:
    // without it they linger on `window` until the next unrelated pointer
    // release, each stray move poking the stale fiber's setters.
    const detach = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (detachDragRef.current === detach) detachDragRef.current = null
    }
    const onUp = (): void => { detach() }
    detachDragRef.current = detach
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [paneOf])

  // Unmounting mid-drag must not orphan the window-level drag listeners.
  useEffect(() => () => { detachDragRef.current?.() }, [])

  // The default expanded height: ~40% of the pane, in px, measured after
  // the expanded DOM exists (the idle face is expanded too). useLayoutEffect
  // so the one placeholder-height frame never paints.
  useLayoutEffect(() => {
    if (collapsed || sectionHeight !== undefined) return
    const pane = paneOf()
    if (pane === null) return
    setSectionHeight(pane.clientHeight * DIVIDER_DEFAULT_SHARE)
  }, [collapsed, sectionHeight, paneOf])

  // A window shrink clamps the expanded height, so the split can never
  // overflow the pane again.
  useEffect(() => {
    const onResize = (): void => {
      const pane = paneOf()
      if (pane === null) return
      setSectionHeight(h => (h === undefined ? h : Math.min(h, pane.clientHeight * DIVIDER_MAX_SHARE)))
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [paneOf])

  const days = result?.days ?? []
  const bars = useMemo(() => barsForRange(days, range, today), [days, range, today])
  const heat = useMemo(() => heatmapCellsOf(days, today), [days, today])
  const rangeTotals = useMemo(() => bars.reduce<UsageBuckets>((sum, day) => ({
    uncachedInputTokens: sum.uncachedInputTokens + day.uncachedInputTokens,
    outputTokens: sum.outputTokens + day.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + day.cacheReadTokens,
    cacheWriteTokens: sum.cacheWriteTokens + day.cacheWriteTokens,
  }), {
    uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  }), [bars])
  const rows = useMemo(() => sessionRowsOf(list), [list])
  const filtered = useMemo(
    () => filterSessionRows(rows, query, activeDay, days),
    [rows, query, activeDay, days],
  )

  const openEverywhere = (sessionId: string): void => {
    openSession(sessionId)
    onSwitchToConversation?.()
  }

  // The divider handle, identical in every face: hover brightens it, a drag
  // resizes (collapsing below the threshold, expanding back up — never
  // loading by itself; the load is always an explicit button), a
  // double-click restores the default height.
  const dividerHandle = (
    <div
      onPointerDown={dividerDragStart}
      onDoubleClick={() => {
        setCollapsed(false)
        setSectionHeight(undefined)
      }}
      onMouseEnter={() => { setDividerHot(true) }}
      onMouseLeave={() => { setDividerHot(false) }}
      title={t('insights.overview.divider')}
      style={{
        position: 'absolute',
        top: -4,
        left: 0,
        right: 0,
        height: 8,
        cursor: 'ns-resize',
        zIndex: 1,
        touchAction: 'none',
        background: dividerHot ? 'var(--yt-accent-border)' : 'transparent',
      }}
    />
  )

  // Slim bar: only ever reached via 收起 or a downward drag. The action
  // button expands again — and from idle it fires the first load as it
  // expands.
  if (collapsed) {
    return (
      <div ref={sectionRef} style={slimBarStyle} data-insights-section="overview">
        {dividerHandle}
        <p style={{ ...cardTitleStyle, fontSize: 'var(--yt-type-body)', margin: 0 }}>
          {t('insights.overview.title')}
        </p>
        <button data-hover="true"
          type="button"
          style={slimActionButtonStyle}
          onClick={() => {
            setCollapsed(false)
            if (phase === 'idle') load()
          }}
        >
          {phase === 'idle' ? t('insights.overview.load') : t('insights.overview.expand')}
        </button>
      </div>
    )
  }

  return (
    <div
      ref={sectionRef}
      style={{
        ...sectionStyle,
        // Always an explicit px height (measured); the '40%' string is only
        // the pre-measure placeholder for the one unpainted frame.
        height: sectionHeight ?? '40%',
        flexShrink: 0,
      }}
      data-insights-section="overview"
    >
      {dividerHandle}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <p style={{ ...cardTitleStyle, fontSize: 'var(--yt-type-body)' }}>{t('insights.overview.title')}</p>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          {result !== null && RANGE_OPTIONS.map(candidate => (
            <button data-hover="true"
              key={candidate}
              type="button"
              style={{
                ...pillButtonStyle,
                borderColor: range === candidate ? 'var(--yt-accent-border)' : 'transparent',
                background: range === candidate ? 'var(--yt-accent-bg)' : 'transparent',
              }}
              onClick={() => { setRange(candidate) }}
            >
              {t(`insights.overview.range.${candidate}`)}
            </button>
          ))}
          {result !== null && (
            <button data-hover="true"
              type="button"
              style={{ ...pillButtonStyle, borderColor: 'var(--yt-border-subtle)', background: 'transparent' }}
              onClick={load}
            >
              {t('insights.overview.refresh')}
            </button>
          )}
          <button data-hover="true"
            type="button"
            style={{ ...pillButtonStyle, borderColor: 'var(--yt-border-subtle)', background: 'transparent' }}
            onClick={() => { setCollapsed(true) }}
          >
            {t('insights.overview.collapse')}
          </button>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {phase === 'idle' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button data-hover="true"
              type="button"
              style={{ ...slimActionButtonStyle, marginLeft: 0 }}
              onClick={load}
            >
              {t('insights.overview.load')}
            </button>
          </div>
        ) : phase === 'failed' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ ...mutedStyle, margin: 0 }}>{t('insights.overview.loadFailed')}</p>
            <button data-hover="true"
              type="button"
              style={{ ...pillButtonStyle, borderColor: 'var(--yt-border-subtle)', background: 'transparent' }}
              onClick={load}
            >
              {t('insights.overview.retry')}
            </button>
          </div>
        ) : phase !== 'ok' && result === null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ ...mutedStyle, margin: 0 }}>{t('insights.overview.loading')}</p>
            <button data-hover="true"
              type="button"
              style={{ ...pillButtonStyle, borderColor: 'var(--yt-border-subtle)', background: 'transparent' }}
              onClick={cancel}
            >
              {t('insights.overview.cancel')}
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <KpiCard label={t('insights.overview.kpi.sessions')}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {distinctSessionsOf(bars)}
                </p>
              </KpiCard>
              <KpiCard label={t('insights.overview.kpi.tokens')}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTokens(grandTotalOf(rangeTotals))}
                </p>
                <BucketLine buckets={rangeTotals} t={t} />
              </KpiCard>
              <KpiCard label={t('insights.overview.kpi.cacheHit')}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {`${cacheHitRateOf(rangeTotals)}%`}
                </p>
              </KpiCard>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              <DailyBarsCard bars={bars} range={range} t={t} />
              <HeatmapCard cells={heat} activeDay={activeDay} onPick={setActiveDay} t={t} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <p style={cardTitleStyle}>{t('insights.overview.cards.title')}</p>
                <input
                  type="search"
                  value={query}
                  placeholder={t('insights.overview.search.placeholder')}
                  onChange={(event) => { setQuery(event.target.value) }}
                  style={{
                    marginLeft: 'auto',
                    minWidth: 160,
                    maxWidth: 280,
                    flex: 1,
                    fontFamily: FONT,
                    fontSize: 'var(--yt-type-label)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--yt-border-subtle)',
                    background: 'var(--yt-surface-primary)',
                    color: 'inherit',
                  }}
                />
              </div>
              {filtered.length === 0 ? (
                <p style={{ ...mutedStyle, margin: 0 }}>
                  {rows.length === 0 ? t('insights.overview.empty') : t('insights.overview.noMatch')}
                </p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                  {filtered.map(row => (
                    <SessionCard
                      key={row.id}
                      row={row}
                      fetchTotals={fetchTotals}
                      onOpen={openEverywhere}
                      onInsights={openSession}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
