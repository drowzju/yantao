/**
 * The cron matcher (ADR-0045 决定 6): a minimal five-field implementation
 * (分 时 日 月 周) supporting `*`, numbers, ranges `a-b`, lists `a,b,c` and
 * steps `*&#47;n` / `a-b&#47;n`. Self-implemented on purpose — an external cron
 * dependency would drag vendor-manifest and third-party-notice changes along
 * for eighty lines of set arithmetic.
 *
 * Semantics follow Vixie cron: when both 日 and 周 are restricted (neither is
 * `*`), a date matches when *either* hits; otherwise both must hit. 周 accepts
 * 0 and 7 for Sunday. Matching granularity is the minute — seconds are
 * ignored, a fire time is the whole minute.
 * @module @deepseek-ai/dsh-client-ui-yantao/cron
 */

/** One parsed field: `any` for `*`, otherwise the explicit hit set. */
type CronField = 'any' | ReadonlySet<number>

/** A parsed five-field cron expression. */
export interface CronSchedule {
  readonly minute: CronField
  readonly hour: CronField
  readonly dayOfMonth: CronField
  readonly month: CronField
  /** Sunday normalized to 0 (both 0 and 7 accepted on input). */
  readonly dayOfWeek: CronField
}

/** Field ranges in cron order; `distinct` is the value count after Sunday normalization (周 0-7 → 0-6). */
const RANGES = [
  { min: 0, max: 59, distinct: 60 }, // 分
  { min: 0, max: 23, distinct: 24 }, // 时
  { min: 1, max: 31, distinct: 31 }, // 日
  { min: 1, max: 12, distinct: 12 }, // 月
  { min: 0, max: 7, distinct: 7 }, // 周（7 → 0）
] as const

/** How far ahead {@link cronNextAfter} searches before giving up (five years — past Feb-29 cycles). */
const SEARCH_HORIZON_MS = 5 * 366 * 24 * 60 * 60 * 1000

/**
 * Parse one field into its hit set. Returns null on any shape violation; the
 * store's `cronShapeError` (host side) owns the detailed diagnostics, this
 * parser just refuses.
 */
/** One field's numeric span, with the distinct-value count the `*`-collapse compares against. */
interface FieldRange {
  readonly min: number
  readonly max: number
  readonly distinct: number
}

function parseField(field: string, range: FieldRange, normalizeSunday: boolean): CronField | null {
  const hits = new Set<number>()
  for (const item of field.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item)
    const body = match?.[1]
    if (match === null || body === undefined) return null
    const stepText = match[2]
    const step = stepText === undefined ? 1 : Number(stepText)
    if (step < 1 || step > range.max - range.min + 1) return null
    let lo: number
    let hi: number
    if (body === '*') {
      lo = range.min
      hi = range.max
    } else {
      const [loText, hiText] = body.split('-')
      lo = Number(loText)
      hi = hiText === undefined ? (stepText === undefined ? lo : range.max) : Number(hiText)
      if (Number.isNaN(lo) || Number.isNaN(hi) || lo < range.min || lo > range.max || hi < lo || hi > range.max) return null
    }
    for (let value = lo; value <= hi; value += step) {
      hits.add(normalizeSunday && value === 7 ? 0 : value)
    }
  }
  if (hits.size === 0) return null
  // A list that covers every distinct value behaves like `*` — matters for
  // the 日/周 either-or rule, which keys on "restricted". The comparison is
  // against the post-normalization count, so 周's `*` (0-7 → 0-6) collapses.
  return hits.size >= range.distinct ? 'any' : hits
}

/**
 * Parse a five-field cron expression. Returns null when the shape is invalid
 * — callers that need a human-readable reason rely on the host's save-time
 * validation, which quotes `cronShapeError` verbatim.
 * @param cron - the expression as stored (whitespace-separated fields).
 * @returns the parsed schedule, or null.
 */
export function parseCron(cron: string): CronSchedule | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const parsed: (CronField | null)[] = []
  for (let at = 0; at < 5; at += 1) {
    const field = fields[at]
    const range = RANGES[at]
    if (field === undefined || range === undefined) return null
    parsed.push(parseField(field, range, at === 4))
  }
  if (parsed.some(field => field === null)) return null
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parsed as [CronField, CronField, CronField, CronField, CronField]
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

/** One field's hit test. */
function hits(field: CronField, value: number): boolean {
  return field === 'any' || field.has(value)
}

/**
 * Whether one instant matches the schedule, at minute granularity (seconds
 * and milliseconds are ignored).
 * @param schedule - the parsed cron.
 * @param at - the instant to test.
 */
export function cronMatchesAt(schedule: CronSchedule, at: Date): boolean {
  if (!hits(schedule.minute, at.getMinutes())) return false
  if (!hits(schedule.hour, at.getHours())) return false
  if (!hits(schedule.month, at.getMonth() + 1)) return false
  const domRestricted = schedule.dayOfMonth !== 'any'
  const dowRestricted = schedule.dayOfWeek !== 'any'
  const domHit = hits(schedule.dayOfMonth, at.getDate())
  const dowHit = hits(schedule.dayOfWeek, at.getDay())
  if (domRestricted && dowRestricted) return domHit || dowHit
  return domHit && dowHit
}

/**
 * The first fire time strictly after `from` (minute-aligned), or null when
 * none exists within the search horizon — e.g. `0 0 31 2 *` never fires.
 * @param schedule - the parsed cron.
 * @param from - the lower bound (exclusive).
 * @returns the next fire time, or null.
 */
export function cronNextAfter(schedule: CronSchedule, from: Date): Date | null {
  const horizon = from.getTime() + SEARCH_HORIZON_MS
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  while (cursor.getTime() <= horizon) {
    if (cronMatchesAt(schedule, cursor)) return new Date(cursor.getTime())
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}

/**
 * Convenience pair for the scheduler: parse and compute the next fire in one
 * call. Returns null on an unparseable expression.
 * @param cron - the expression as stored.
 * @param from - the lower bound (exclusive).
 */
export function cronNextFire(cron: string, from: Date): Date | null {
  const schedule = parseCron(cron)
  return schedule === null ? null : cronNextAfter(schedule, from)
}
