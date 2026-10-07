/**
 * The 洞察 tab's cross-session overview data plane (ADR-0050). The day
 * ledger arrives whole from `yantaoUsage.dailyUsage` — personal scale keeps
 * it a few hundred rows — so every view slices it locally: the KPI trio
 * (distinct sessions, four-bucket totals, cache hit rate), the range bars,
 * and the eight-week heat grid. The session cards fold the session
 * controller's list snapshot; a card's lifetime tokens read
 * `projectionValues.tokenUsage` directly (ticket 01's wire view = the four
 * buckets), tolerating the cold-row absence the host documents.
 *
 * Pure shaping — no React, no RPC — so the calendar arithmetic and the
 * fold rules are pinned by unit tests.
 * @module @deepseek-ai/dsh-client-ui-yantao/overview
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DayUsageRecord, UsageBuckets } from '@deepseek-ai/dsh-api-yantao-usage-controller/types'

/** The KPI/charts range selector: a sliding window or the whole ledger. */
export type OverviewRange = '7d' | '30d' | 'all'

/** The sliding windows' lengths in days; `all` has none. */
const RANGE_DAYS: Record<OverviewRange, number | null> = { '7d': 7, '30d': 30, all: null }

/** One heat-grid cell: a local day, its four-bucket sum, and whether it lies ahead. */
export interface WeekCell {
  readonly day: string
  readonly total: number
  readonly future: boolean
}

/** One session card's row, folded from the list snapshot. */
export interface SessionCardRow {
  readonly id: string
  /** The human-facing label the host projects (durable title, else fallbacks). */
  readonly title: string
  readonly cwd: string | undefined
  readonly updatedAt: number
  readonly running: boolean
  /** Lifetime four-bucket totals; absent on cold rows (ticket 01), the card falls back to the RPC. */
  readonly totals: UsageBuckets | undefined
}

/** Zero-pad one calendar number to two digits. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * The local calendar day of one timestamp, `YYYY-MM-DD`.
 * @param now - the instant to read; defaults to now.
 * @returns the local day key.
 */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/**
 * Shift one day key by a whole number of days. The arithmetic runs in UTC
 * noon space so DST boundaries cannot repeat or skip a local day.
 * @param day - a `YYYY-MM-DD` key.
 * @param delta - days to add (negative to go back).
 * @returns the shifted key.
 */
export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(year, month - 1, date, 12))
  shifted.setUTCDate(shifted.getUTCDate() + delta)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/** Sum one record's four buckets — the figure every chart cell shows. */
export function grandTotalOf(buckets: UsageBuckets): number {
  return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/**
 * The cache hit rate: served-from-cache share of all prompt tokens. Cache
 * writes count as misses — they were sent to be cached, not avoided.
 * @param buckets - the totals to read.
 * @returns the percentage rounded to the nearest integer; 0 for an empty range.
 */
export function cacheHitRateOf(buckets: UsageBuckets): number {
  const prompted = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  return prompted === 0 ? 0 : Math.round(buckets.cacheReadTokens / prompted * 100)
}

/**
 * Slice the ledger into the range's bar rows: sliding windows fill missing
 * local days with zero rows so the chart shows quiet days as gaps, `all`
 * passes the ledger through.
 * @param days - the ledger rows, oldest first.
 * @param range - the selected window.
 * @param today - the local day the windows end on (inclusive).
 * @returns one row per day in the window, oldest first.
 */
export function barsForRange(
  days: readonly DayUsageRecord[],
  range: OverviewRange,
  today: string,
): readonly DayUsageRecord[] {
  const window = RANGE_DAYS[range]
  if (window === null) return days
  const byDay = new Map(days.map(day => [day.day, day]))
  const zero: UsageBuckets = {
    uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  }
  const rows: DayUsageRecord[] = []
  for (let offset = window - 1; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset)
    rows.push(byDay.get(day) ?? { day, sessionIds: [], ...zero })
  }
  return rows
}

/**
 * Lay the ledger out as the heat grid: `weeks` columns running oldest to
 * newest, seven rows per column, Monday first — the calendar the human
 * already reads. Days after today are future cells the UI renders inert.
 * @param days - the ledger rows, oldest first.
 * @param today - the local day the grid ends on.
 * @param weeks - how many weekly columns; the default is ADR-0050's eight.
 * @returns the grid, `[columnIndex][weekdayIndex]`, Monday-first rows.
 */
export function heatmapCellsOf(
  days: readonly DayUsageRecord[],
  today: string,
  weeks: number = 8,
): readonly (readonly WeekCell[])[] {
  const totals = new Map(days.map(day => [day.day, grandTotalOf(day)]))
  // The current week's Monday: local weekday with Monday as 0.
  const [year, month, date] = today.split('-').map(Number) as [number, number, number]
  const anchor = new Date(Date.UTC(year, month - 1, date, 12))
  const mondayOffset = (anchor.getUTCDay() + 6) % 7
  const grid: WeekCell[][] = []
  for (let week = weeks - 1; week >= 0; week -= 1) {
    const column: WeekCell[] = []
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = shiftDay(today, -(mondayOffset + week * 7) + weekday)
      column.push({ day, total: totals.get(day) ?? 0, future: day > today })
    }
    grid.push(column)
  }
  return grid
}

/**
 * Count the distinct sessions the range's ledger rows credit — the 活跃会话
 * KPI. The list snapshot cannot answer this: it has no per-day attribution.
 * @param days - the in-range ledger rows.
 * @returns the number of distinct contributing session ids.
 */
export function distinctSessionsOf(days: readonly DayUsageRecord[]): number {
  const ids = new Set<string>()
  for (const day of days) for (const id of day.sessionIds) ids.add(id)
  return ids.size
}

/**
 * Fold the session list snapshot into card rows: blank placeholder sessions
 * drop out, the rest run newest-first on `updatedAt`.
 * @param state - the session controller's list snapshot.
 * @returns the card rows, newest first.
 */
export function sessionRowsOf(state: SessionListState): readonly SessionCardRow[] {
  return Object.values(state.byId)
    .filter(row => !row.blank)
    .map(row => ({
      id: row.id,
      title: row.displayTitle,
      cwd: row.cwd,
      updatedAt: row.updatedAt,
      running: row.running,
      totals: row.projectionValues?.tokenUsage,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

/**
 * Filter the card rows: a non-empty query keeps rows whose title or cwd
 * carries it (case-insensitive), and an active heat-map day keeps only that
 * day's contributing sessions.
 * @param rows - the unfolded card rows.
 * @param query - the search text; empty passes everything.
 * @param activeDay - the selected heat cell's day, or undefined for no filter.
 * @param ledgerDays - the whole ledger (the active-day lookup reads it).
 * @returns the filtered rows, order preserved.
 */
export function filterSessionRows(
  rows: readonly SessionCardRow[],
  query: string,
  activeDay: string | undefined,
  ledgerDays: readonly DayUsageRecord[],
): readonly SessionCardRow[] {
  let filtered = rows
  const needle = query.trim().toLowerCase()
  if (needle !== '') {
    filtered = filtered.filter(row =>
      row.title.toLowerCase().includes(needle)
      || (row.cwd !== undefined && row.cwd.toLowerCase().includes(needle)))
  }
  if (activeDay !== undefined) {
    const day = ledgerDays.find(record => record.day === activeDay)
    const ids = new Set(day?.sessionIds ?? [])
    filtered = filtered.filter(row => ids.has(row.id))
  }
  return filtered
}

/**
 * One timestamp's compact stamp for a card: the clock on the same local
 * day, the month and day within the year, the full date otherwise.
 * @param timestamp - the epoch millis to render.
 * @param now - the reference instant; defaults to now.
 * @returns the short stamp.
 */
export function stampOf(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp)
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  if (sameDay) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  const sameYear = date.getFullYear() === now.getFullYear()
  const md = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  return sameYear ? md : `${date.getFullYear()}-${md}`
}
