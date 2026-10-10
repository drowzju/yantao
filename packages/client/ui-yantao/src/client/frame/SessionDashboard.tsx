/**
 * The 洞察 tab's current-session dashboard (ADR-0050): four cards over the
 * durable session log and the token-meter projections —
 *
 * - 上下文组成: a six-segment stacked bar (system prompt ex-yantao, the
 *   yantao injection, tool definitions, cached history, uncached history,
 *   the latest output) plus the remaining tail; the occupancy total follows
 *   the status bar's resolution order (ADR-0039), the yantao share is
 *   priced once per session through the promptInjection RPC (latest wins);
 * - 逐步趋势: one stacked bar per model step (or per turn), ✂ marking the
 *   bars a compaction shadows;
 * - 事件流: pipeline injections, compactions and model switches, filterable;
 * - 文件活动: tool calls in the four read/write/edit/search buckets with
 *   line deltas read off the arguments.
 *
 * Rendered inside the `insights.session` slot (`session-maybe` scope): the
 * slot machinery threads the current session's projection seat through, so
 * no session reads as a quiet 暂无会话 rather than an error.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { KbPromptInjectionResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { formatTokens, resolveOccupancy } from '../insights.ts'
import type { FeedItem, InsightsLoader, SessionInsights, TrendStep } from '../insights.ts'
import type { WorkbenchT } from '../locales.ts'

export interface SessionDashboardProps {
  /** Current session identity, absent while no session is selected. */
  readonly sessionId: string | undefined
  useProjection: UseProjection
  /** Price the yantao layer's own system-prompt share (ADR-0039). */
  readonly promptInjection: () => Promise<KbPromptInjectionResult>
  /** The full-log reader seam (the `sessionDetail` loader's sibling). */
  readonly insightsLoader: InsightsLoader
  /** The workbench dictionary's bound translator (slot locale seat). */
  readonly t: WorkbenchT
}

const FONT = 'var(--yt-font-ui)'

const rootStyle = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'auto',
  padding: 12,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 12,
  alignContent: 'start',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
} as const

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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

/** One legend row: swatch + label + the ~token figure and its capacity share. */
function LegendRow({ color, label, tokens, capacity, sub }: {
  color: string
  label: string
  tokens: number
  capacity: number
  sub?: boolean | undefined
}): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingLeft: sub ? 14 : 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0, alignSelf: 'center' }} />
      <span style={{ ...mutedStyle, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
        {`~${formatTokens(tokens)} · ${capacity > 0 ? Math.round(tokens / capacity * 100) : 0}%`}
      </span>
    </div>
  )
}

/** The composition card's data: six segments plus the remaining tail. */
interface Segment {
  readonly key: string
  readonly label: string
  readonly tokens: number
  readonly color: string
  readonly sub?: boolean
}

/** The 组成 card: the six-segment bar, its legend, and the remaining tail. */
function CompositionCard({ breakdown, injectionTotal, lastStep, capacity, used, percent, t }: {
  breakdown: { systemTokens: number; toolsTokens: number; messageTokens: number } | undefined
  injectionTotal: number | null
  lastStep: TrendStep | undefined
  capacity: number
  used: number
  percent: number
  t: WorkbenchT
}): ReactElement {
  const systemExYantao = breakdown === undefined || injectionTotal === null
    ? breakdown?.systemTokens ?? 0
    : Math.max(0, breakdown.systemTokens - injectionTotal)
  const segments: Segment[] = [
    { key: 'system', label: t('insights.composition.system'), tokens: systemExYantao, color: 'var(--yt-accent)' },
    ...(injectionTotal !== null
      ? [{ key: 'yantao', label: t('insights.composition.yantao'), tokens: injectionTotal, color: 'var(--yt-accent-strong)', sub: true }]
      : []),
    { key: 'tools', label: t('insights.composition.tools'), tokens: breakdown?.toolsTokens ?? 0, color: 'var(--yt-warning-text)' },
    { key: 'cached', label: t('insights.composition.cached'), tokens: lastStep?.cacheReadTokens ?? 0, color: 'var(--yt-success)' },
    {
      key: 'fresh',
      label: t('insights.composition.fresh'),
      tokens: (lastStep?.inputTokens ?? 0) + (lastStep?.cacheWriteTokens ?? 0),
      color: 'var(--yt-text-muted)',
    },
    { key: 'output', label: t('insights.composition.output'), tokens: lastStep?.outputTokens ?? 0, color: 'var(--yt-error)' },
  ]
  const remaining = Math.max(0, capacity - used)
  return (
    <section style={cardStyle} data-insights-card="composition">
      <p style={cardTitleStyle}>{t('insights.composition.title')}</p>
      <div
        role="img"
        aria-label={t('context.aria', { percent })}
        style={{ display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden', background: 'var(--yt-surface-raised)' }}
      >
        {segments.map(segment => segment.tokens > 0 && (
          <span
            key={segment.key}
            style={{ width: `${Math.min(100, segment.tokens / capacity * 100)}%`, background: segment.color }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {segments.map(segment => (
          <LegendRow
            key={segment.key}
            color={segment.color}
            label={segment.label}
            tokens={segment.tokens}
            capacity={capacity}
            sub={segment.sub}
          />
        ))}
        <LegendRow
          color="transparent"
          label={t('insights.composition.remaining')}
          tokens={remaining}
          capacity={capacity}
        />
      </div>
      <p style={{ ...mutedStyle, margin: 0, fontSize: 'var(--yt-type-label)' }}>{t('insights.composition.estimated')}</p>
    </section>
  )
}

/** One trend bar's aggregated figures: the input stack plus the output cap. */
interface TrendBar {
  readonly key: string
  readonly endSeq: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** Collapse the steps into one bar per turn (sums keyed by `turn/start`). */
function barsByTurn(steps: readonly TrendStep[]): readonly TrendBar[] {
  const bars: TrendBar[] = []
  for (const step of steps) {
    const last = bars[bars.length - 1]
    if (last !== undefined && last.key === `turn-${step.turn}`) {
      bars[bars.length - 1] = {
        ...last,
        endSeq: step.seq,
        inputTokens: last.inputTokens + step.inputTokens + step.cacheReadTokens + step.cacheWriteTokens,
        outputTokens: last.outputTokens + step.outputTokens,
      }
      continue
    }
    bars.push({
      key: `turn-${step.turn}`,
      endSeq: step.seq,
      inputTokens: step.inputTokens + step.cacheReadTokens + step.cacheWriteTokens,
      outputTokens: step.outputTokens,
    })
  }
  return bars
}

const BAR_MAX_HEIGHT = 64

/** The 趋势 card: one stacked bar per step or turn, ✂ at compaction points. */
function TrendCard({ steps, feed, t }: { steps: readonly TrendStep[]; feed: readonly FeedItem[]; t: WorkbenchT }): ReactElement {
  const [mode, setMode] = useState<'step' | 'turn'>('step')
  const bars = useMemo<readonly TrendBar[]>(
    () => mode === 'step'
      ? steps.map(step => ({
        key: `step-${step.seq}`,
        endSeq: step.seq,
        inputTokens: step.inputTokens + step.cacheReadTokens + step.cacheWriteTokens,
        outputTokens: step.outputTokens,
      }))
      : barsByTurn(steps),
    [mode, steps],
  )
  const peak = Math.max(1, ...bars.map(bar => bar.inputTokens + bar.outputTokens))
  // A bar earns its ✂ when a compaction landed inside its span — counting
  // compactions up to each bar's end and marking where the count rises.
  const compactionSeqs = useMemo(
    () => feed.filter(item => item.kind === 'compaction').map(item => item.seq),
    [feed],
  )
  const compactionsBefore = (seq: number): number => compactionSeqs.filter(s => s <= seq).length
  return (
    <section style={cardStyle} data-insights-card="trend">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p style={cardTitleStyle}>{t('insights.trend.title')}</p>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          {(['step', 'turn'] as const).map(candidate => (
            <button data-hover="true"
              key={candidate}
              type="button"
              style={{
                fontSize: 'var(--yt-type-label)',
                fontFamily: FONT,
                padding: '0 6px',
                minHeight: 20,
                borderRadius: 4,
                cursor: 'pointer',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: mode === candidate ? 'var(--yt-accent-border)' : 'transparent',
                background: mode === candidate ? 'var(--yt-accent-bg)' : 'transparent',
                color: 'inherit',
              }}
              onClick={() => { setMode(candidate) }}
            >
              {candidate === 'step' ? t('insights.trend.step') : t('insights.trend.turn')}
            </button>
          ))}
        </span>
      </div>
      {bars.length === 0 ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{t('insights.trend.empty')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: BAR_MAX_HEIGHT + 14 }}>
            {bars.map((bar, index) => {
              const prev = index > 0 ? bars[index - 1] : undefined
              const compacted = prev !== undefined && compactionsBefore(bar.endSeq) > compactionsBefore(prev.endSeq)
              return (
                <span
                  key={bar.key}
                  title={`#${index + 1} · ${formatTokens(bar.inputTokens)} + ${formatTokens(bar.outputTokens)}`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', minWidth: 2 }}
                >
                  <span style={{ height: bar.outputTokens / peak * BAR_MAX_HEIGHT, background: 'var(--yt-success)', minHeight: bar.outputTokens > 0 ? 2 : 0 }} />
                  <span style={{ height: bar.inputTokens / peak * BAR_MAX_HEIGHT, background: 'var(--yt-accent)' }} />
                  {/* 2026-10-09 评审：9→10px——压缩标记是符号非正文，但不再
                      低于 10px 下限；12px 盒子装得下。 */}
                  <span style={{ height: 12, textAlign: 'center', fontSize: 10, lineHeight: '12px', color: 'var(--yt-text-muted)' }}>
                    {compacted ? '✂' : ''}
                  </span>
                </span>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 'var(--yt-type-label)', color: 'var(--yt-text-muted)' }}>
            <span>{t('insights.trend.legend.input')}</span>
            <span>{t('insights.trend.legend.output')}</span>
          </div>
        </>
      )}
    </section>
  )
}

/** The 事件流 card's filter seats. */
const FEED_FILTERS = ['all', 'injection', 'compaction', 'model'] as const
type FeedFilter = typeof FEED_FILTERS[number]

/** How many feed lines the card keeps before the truncation footnote. */
const FEED_VISIBLE = 50

const FEED_BADGE_KEYS: Record<Exclude<FeedFilter, 'all'>, Parameters<WorkbenchT>[0]> = {
  injection: 'insights.feed.injection',
  compaction: 'insights.feed.compaction',
  model: 'insights.feed.model',
}

/** The feed line's first line — the card shows one line per event. */
const firstLineOf = (text: string): string => text.split('\n')[0] ?? ''

/** One feed item's one-line reading, shaped per kind. */
function feedTextOf(item: FeedItem): string {
  switch (item.kind) {
    case 'injection': return firstLineOf(item.text)
    case 'model': return `${item.provider}/${item.model}`
    default: {
      const head = `✂ ${firstLineOf(item.summary)}`
      return item.shadowedTokenCount !== null ? `${head}（−${formatTokens(item.shadowedTokenCount)}）` : head
    }
  }
}

/** One feed line: kind badge + the event's one-line reading. */
function FeedRow({ item, t }: { item: FeedItem; t: WorkbenchT }): ReactElement {
  const badge = FEED_BADGE_KEYS[item.kind]
  const text = feedTextOf(item)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
      <span
        style={{
          flexShrink: 0,
          fontSize: 'var(--yt-type-label)',
          padding: '0 4px',
          borderRadius: 3,
          border: '1px solid var(--yt-border-subtle)',
          color: 'var(--yt-text-muted)',
        }}
      >
        {t(badge)}
      </span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </div>
  )
}

/** The 事件流 card: the three surfaced families, filterable, newest last. */
function FeedCard({ feed, t }: { feed: readonly FeedItem[]; t: WorkbenchT }): ReactElement {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const filtered = filter === 'all' ? feed : feed.filter(item => item.kind === filter)
  const visible = filtered.slice(-FEED_VISIBLE)
  return (
    <section style={cardStyle} data-insights-card="feed">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <p style={cardTitleStyle}>{t('insights.feed.title')}</p>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {FEED_FILTERS.map(candidate => (
            <button data-hover="true"
              key={candidate}
              type="button"
              style={{
                fontSize: 'var(--yt-type-label)',
                fontFamily: FONT,
                padding: '0 6px',
                minHeight: 20,
                borderRadius: 4,
                cursor: 'pointer',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: filter === candidate ? 'var(--yt-accent-border)' : 'transparent',
                background: filter === candidate ? 'var(--yt-accent-bg)' : 'transparent',
                color: 'inherit',
              }}
              onClick={() => { setFilter(candidate) }}
            >
              {candidate === 'all' ? t('insights.feed.all') : t(FEED_BADGE_KEYS[candidate])}
            </button>
          ))}
        </span>
      </div>
      {visible.length === 0 ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{t('insights.feed.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visible.map(item => <FeedRow key={item.seq} item={item} t={t} />)}
          {filtered.length > visible.length && (
            <p style={{ ...mutedStyle, margin: 0, fontSize: 'var(--yt-type-label)' }}>
              {t('insights.feed.more', { count: visible.length, total: filtered.length })}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** The 文件活动 card: four buckets plus the line deltas. */
function FilesCard({ files, t }: { files: SessionInsights['files']; t: WorkbenchT }): ReactElement {
  const buckets = [
    { key: 'read', label: t('insights.files.read'), count: files.read },
    { key: 'write', label: t('insights.files.write'), count: files.write },
    { key: 'edit', label: t('insights.files.edit'), count: files.edit },
    { key: 'search', label: t('insights.files.search'), count: files.search },
  ] as const
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  return (
    <section style={cardStyle} data-insights-card="files">
      <p style={cardTitleStyle}>{t('insights.files.title')}</p>
      {total === 0 ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{t('insights.files.empty')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16 }}>
            {buckets.map(bucket => (
              <span key={bucket.key} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
                <span style={{ ...mutedStyle, fontSize: 'var(--yt-type-label)' }}>{bucket.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{bucket.count}</span>
              </span>
            ))}
          </div>
          {(files.linesAdded > 0 || files.linesRemoved > 0) && (
            <p style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ ...mutedStyle, fontSize: 'var(--yt-type-label)' }}>{t('insights.files.lines')}</span>
              {` +${formatTokens(files.linesAdded)} / −${formatTokens(files.linesRemoved)}`}
            </p>
          )}
        </>
      )}
    </section>
  )
}

export function SessionDashboard({
  sessionId, useProjection, promptInjection, insightsLoader, t,
}: SessionDashboardProps): ReactElement {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const [data, setData] = useState<SessionInsights | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle')
  const [injection, setInjection] = useState<KbPromptInjectionResult | null>(null)

  // The log read: one per session identity, aborted when the session flips
  // or the pane unmounts. A running session's dashboard shows what has been
  // flushed so far; switching tabs back and forth refetches.
  useEffect(() => {
    if (sessionId === undefined) {
      setData(null)
      setPhase('idle')
      return
    }
    const controller = new AbortController()
    let stale = false
    setPhase('loading')
    void insightsLoader(sessionId, controller.signal).then(
      (result) => {
        if (stale) return
        setData(result)
        setPhase('ok')
      },
      () => {
        if (stale) return
        setPhase('failed')
      },
    )
    return () => {
      stale = true
      controller.abort()
    }
  }, [sessionId, insightsLoader])

  // The yantao share is priced once per session, latest answer winning —
  // the injection follows the KB's behavior memory, so a stale figure lies.
  useEffect(() => {
    if (sessionId === undefined) return
    let stale = false
    void promptInjection().then(
      (result) => { if (!stale) setInjection(result) },
      () => { if (!stale) setInjection(null) },
    )
    return () => { stale = true }
  }, [sessionId, promptInjection])

  // Same resolution order the status bar uses (ADR-0039).
  const occupancy = resolveOccupancy(pressure)
  const injectionTotal = injection === null
    ? null
    : injection.staticTokens + injection.behaviorMemoryTokens
  const lastStep = data?.steps[data.steps.length - 1]

  if (sessionId === undefined) {
    return <div style={{ ...rootStyle, placeItems: 'center' }}><p style={mutedStyle}>{t('insights.noSession')}</p></div>
  }
  if (phase === 'loading' || phase === 'idle') {
    return <div style={{ ...rootStyle, placeItems: 'center' }}><p style={mutedStyle}>{t('insights.loading')}</p></div>
  }
  if (phase === 'failed' || data === null) {
    return <div style={{ ...rootStyle, placeItems: 'center' }}><p style={mutedStyle}>{t('insights.loadFailed')}</p></div>
  }
  return (
    <div style={rootStyle}>
      {occupancy !== null && (
        <CompositionCard
          breakdown={breakdown}
          injectionTotal={injectionTotal}
          lastStep={lastStep}
          capacity={occupancy.capacity}
          used={occupancy.used}
          percent={occupancy.percent}
          t={t}
        />
      )}
      <TrendCard steps={data.steps} feed={data.feed} t={t} />
      <FeedCard feed={data.feed} t={t} />
      <FilesCard files={data.files} t={t} />
    </div>
  )
}
