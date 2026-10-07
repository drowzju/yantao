/**
 * The usage ledger's durable and wire vocabulary. Shapes here are the single
 * source for the KV domain schemas (spec.ts), the pure fold (fold.ts), and
 * the `yantaoUsage` Remote wire types (the controller package re-exports
 * them); a change touches all three through this file alone.
 * @module @deepseek-ai/dsh-yantao-usage/types
 */

/** The four provider-reported token classes, as `tokenUsage`'s wire view names them. */
export interface UsageBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/**
 * One local-day ledger row: the four buckets summed over every usage sample
 * attributed to that local calendar day, plus the sessions that contributed
 * (kept as an ordered id list — bounded at personal scale — so the 总览 can
 * count active sessions per day and the fold can dedupe re-reads).
 */
export interface DayUsageRecord extends UsageBuckets {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly day: string
  readonly sessionIds: readonly string[]
}

/**
 * The `last` replacement slot of one session's fold: the turn/step of the
 * newest accounted settlement, the local day it was attributed to, and the
 * buckets it contributed — the exact subtraction basis a re-settlement of
 * the same turn/step (or a retry after `llm/retry-started`) needs, even
 * across an incremental read boundary or a midnight rollover.
 */
export interface UsageLastSlot {
  readonly turn: number
  readonly step: number
  readonly day: string
  readonly buckets: UsageBuckets
}

/**
 * Per-session fold state, persisted as the scan cursor: the next logical seq
 * to read (everything below is already folded into the ledger), the
 * replacement slot, and the session's lifetime totals.
 */
export interface SessionUsageCursor {
  /** Next logical event seq to read; `0` for an unread session. */
  readonly nextSeq: number
  readonly last: UsageLastSlot | null
  readonly totals: UsageBuckets
}

/** One signed day-attributed movement produced by the fold. */
export interface UsageDayDelta {
  readonly day: string
  readonly delta: UsageBuckets
}
