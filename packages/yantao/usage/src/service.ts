/**
 * The `yantaoUsage` service: the usage ledger's owner. Opens the
 * `yantao_usage` KV domain at init, scans session event logs incrementally
 * (per-session cursor: everything below `nextSeq` is already folded), and
 * answers the day-ledger and per-session reads the `yantaoUsage` Remote
 * namespace serves to the 洞察 tab (ADR-0050).
 *
 * Scans are lazy and single-flight: a `dailyUsage` call brings the ledger up
 * to date once, and concurrent callers ride the same tail. A live session's
 * log is readable through a `read` handle while its writer runs, so "up to
 * date" means "every event that had materialized when the scan read it".
 * @module @deepseek-ai/dsh-yantao-usage/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
// The /types subpath, never the bare entry: the entry's d.ts carries the
// host-side `sessions: SessionStore` cordis augmentation, and this package's
// emitted d.ts is pulled into every client program through the remotes
// aggregator — the augmentation would shadow the client's `sessions: ISessions`.
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
} from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { emptyCursor, foldSessionEvents } from './fold.ts'
import { usageDomainSpec, DAY_KEY_PATTERN } from './spec.ts'
import type { DayUsageRecord, SessionUsageCursor, UsageBuckets, UsageDayDelta } from './types.ts'

/** Raised for a `sessionUsage` read naming a session the store does not hold. */
export class UsageSessionUnknownError extends Error {
  constructor(public readonly sessionId: string) {
    super(`no stored session "${sessionId}"`)
  }
}

/** Range selectors for the day ledger read; both bounds inclusive, local days. */
export interface UsageDailyArgs {
  readonly sinceDay?: string
  readonly untilDay?: string
}

/** The day-ledger answer: the records in range plus their bucket-wise sum. */
export interface UsageDailyResult {
  readonly days: readonly DayUsageRecord[]
  readonly totals: UsageBuckets
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The session usage ledger, provided by the mounted yantao-usage plugin. */
    yantaoUsage: YantaoUsageService
  }
}

const ZERO: UsageBuckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/**
 * The usage ledger service (ADR-0050): folds persisted session event logs
 * into a per-local-day token ledger in the `yantao_usage` KV domain, and
 * answers the day-range and per-session reads the 洞察 tab's 总览 renders.
 * Scans are lazy and single-flight — every read first brings the ledger up
 * to date.
 */
export class YantaoUsageService extends Service {
  static inject = ['storageDomain', 'sessionPersistence']

  private days?: KvTable<string, DayUsageRecord>
  private sessions?: KvTable<string, SessionUsageCursor>
  private scanTail: Promise<void> = Promise.resolve()
  /** Sessions whose unreadability has already been warned about (warn once, retry silently). */
  private unreadableWarned = new Set<SessionId>()

  constructor(ctx: Context) {
    super(ctx, 'yantaoUsage')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(usageDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'yantao-usage: domainClose')
    this.days = domain.table('days')
    this.sessions = domain.table('sessions')
  }

  /**
   * Bring the whole ledger up to date: enumerate every stored session and
   * fold whatever each cursor has not consumed yet. Single-flight — a call
   * while a scan runs resolves when THAT scan (plus the caller's own pass)
   * completes.
   * @returns resolution once the ledger reflects every materialized event.
   */
  refresh(): Promise<void> {
    const next = this.scanTail.catch(() => undefined).then(() => this.scanAll())
    this.scanTail = next
    return next
  }

  /**
   * The day ledger over an inclusive local-day range, brought up to date
   * first. Days with no recorded usage are absent from the answer.
   * @param args - optional `sinceDay`/`untilDay` bounds (`YYYY-MM-DD`, inclusive).
   * @returns the day records in range, oldest first, with their bucket-wise sum.
   */
  async dailyUsage(args: UsageDailyArgs = {}): Promise<UsageDailyResult> {
    validateDayBound('sinceDay', args.sinceDay)
    validateDayBound('untilDay', args.untilDay)
    await this.refresh()
    const days = [...this.requireDays().entries()]
      .filter(([day]) => (args.sinceDay === undefined || day >= args.sinceDay)
        && (args.untilDay === undefined || day <= args.untilDay))
      .map(([, record]) => record)
      .sort((left, right) => left.day.localeCompare(right.day))
    const totals = days.reduce(addRecordInto, { ...ZERO })
    return { days, totals }
  }

  /**
   * One session's lifetime totals, bringing that session's cursor up to date
   * first.
   * @param sessionId - the stored session to read.
   * @returns the session's lifetime token totals, all four buckets.
   * @throws {UsageSessionUnknownError} when the store holds no such session.
   */
  async sessionUsage(sessionId: SessionId): Promise<UsageBuckets> {
    const snapshot = await this.ctx.sessionPersistence.stat(sessionId)
    if (snapshot === undefined) throw new UsageSessionUnknownError(sessionId)
    // Join the same single-flight tail as refresh(): a per-session read must
    // never fold concurrently with (nor stale-after) a background scan, or
    // the same event slice merges twice into the day rows.
    const run = this.scanTail.catch(() => undefined)
      .then(() => this.scanSession(sessionId, snapshot.eventCount))
    this.scanTail = run.catch(() => undefined)
    await run
    return this.requireSessions().get(sessionId)?.totals ?? { ...ZERO }
  }

  private requireDays(): KvTable<string, DayUsageRecord> {
    if (this.days === undefined) throw new Error('yantaoUsage: domain not open')
    return this.days
  }

  private requireSessions(): KvTable<string, SessionUsageCursor> {
    if (this.sessions === undefined) throw new Error('yantaoUsage: domain not open')
    return this.sessions
  }

  private async scanAll(): Promise<void> {
    const snapshots = await this.ctx.sessionPersistence.list()
    for (const snapshot of snapshots) {
      try {
        await this.scanSession(snapshot.header.id, snapshot.eventCount)
      } catch (error: unknown) {
        // One unreadable session (e.g. a legacy log the format migration
        // refuses) must not take the whole ledger down: skip it, keep what
        // the rest folded. Its cursor is untouched, so a later scan retries
        // it — the gap closes itself if the artifact is ever repaired.
        // Only log-unreadability is tolerated here: infrastructure faults
        // (KV domain closed, a put failure that may already have moved day
        // rows) must propagate, or refresh()/dailyUsage would resolve with
        // silently stale — worse, double-counted — ledger rows.
        if (!(error instanceof SessionFormatUnsupportedError
          || error instanceof SessionPersistenceCorruptionError)) throw error
        if (!this.unreadableWarned.has(snapshot.header.id)) {
          this.unreadableWarned.add(snapshot.header.id)
          this.ctx.logger.warn(
            'yantaoUsage: session %s unreadable, skipped this scan: %s',
            snapshot.header.id, error instanceof Error ? error.message : String(error),
          )
        }
      }
    }
  }

  /**
   * Advance one session's cursor to the log's end, folding every new event
   * into the ledger. A `knownEventCount` at or below the cursor's position
   * short-circuits the open entirely.
   */
  private async scanSession(sessionId: SessionId, knownEventCount: number | undefined): Promise<void> {
    const sessions = this.requireSessions()
    let cursor = sessions.get(sessionId) ?? emptyCursor
    if (knownEventCount !== undefined && knownEventCount <= cursor.nextSeq) return
    let handle
    try {
      handle = await this.ctx.sessionPersistence.open(sessionId, 'read')
    } catch (error: unknown) {
      // Listed then vanished (concurrent pruning): the ledger simply keeps
      // what it folded; nothing about the day rows needs undoing.
      if (error instanceof SessionPersistenceNotFoundError) return
      throw error
    }
    try {
      const { events } = await handle.read(cursor.nextSeq)
      if (events.length === 0) return
      const folded = foldSessionEvents(cursor, events)
      cursor = folded.cursor
      // Coalesce the batch's movements to one put per touched day (a batch
      // usually spans one or two): fewer durable writes and a smaller window
      // between ledger movement and cursor save.
      const byDay = new Map<string, UsageBuckets>()
      for (const { day, delta } of folded.deltas) {
        const acc = byDay.get(day)
        byDay.set(day, acc === undefined ? delta : addBuckets(acc, delta))
      }
      for (const [day, delta] of byDay) await this.applyDelta(sessionId, { day, delta })
      await sessions.put(sessionId, cursor)
    } finally {
      await handle.close()
    }
  }

  /** Merge one signed movement into its day row, crediting the contributing session. */
  private async applyDelta(sessionId: SessionId, movement: UsageDayDelta): Promise<void> {
    const days = this.requireDays()
    const existing = days.get(movement.day)
    const base: DayUsageRecord = existing ?? {
      day: movement.day,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sessionIds: [],
    }
    const sessionIds = base.sessionIds.includes(sessionId)
      ? base.sessionIds
      : [...base.sessionIds, sessionId]
    await days.put(movement.day, {
      day: movement.day,
      sessionIds,
      uncachedInputTokens: Math.max(0, base.uncachedInputTokens + movement.delta.uncachedInputTokens),
      outputTokens: Math.max(0, base.outputTokens + movement.delta.outputTokens),
      cacheReadTokens: Math.max(0, base.cacheReadTokens + movement.delta.cacheReadTokens),
      cacheWriteTokens: Math.max(0, base.cacheWriteTokens + movement.delta.cacheWriteTokens),
    })
  }
}

function addRecordInto(total: UsageBuckets, record: DayUsageRecord): UsageBuckets {
  return {
    uncachedInputTokens: total.uncachedInputTokens + record.uncachedInputTokens,
    outputTokens: total.outputTokens + record.outputTokens,
    cacheReadTokens: total.cacheReadTokens + record.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + record.cacheWriteTokens,
  }
}

function addBuckets(left: UsageBuckets, right: UsageBuckets): UsageBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  }
}

/** Day bounds compare lexically, so a malformed bound silently filters to an empty answer — reject it instead. */
function validateDayBound(key: 'sinceDay' | 'untilDay', value: string | undefined): void {
  if (value !== undefined && !DAY_KEY_PATTERN.test(value)) {
    throw new Error(`yantaoUsage.dailyUsage: ${key} must be YYYY-MM-DD, got "${value}"`)
  }
}

export default YantaoUsageService
