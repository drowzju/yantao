/**
 * The pure usage fold: turn a batch of session events into cursor movement
 * plus signed, day-attributed ledger deltas. Semantics mirror token-meter's
 * `tokenUsage` projection fold (packages/llm/token-meter/src/
 * usage-projection.ts:117-150) exactly — same replacement slot, same
 * retry-started closure, same equal-buckets short circuit — so the ledger's
 * lifetime totals agree with the per-session projection by construction; the
 * only addition is day attribution from each event's own timestamp.
 * @module @deepseek-ai/dsh-yantao-usage/fold
 */

import { lastAssistantStreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionUsageCursor, UsageBuckets, UsageDayDelta } from './types.ts'

/** The cursor for a session the ledger has never read. */
export const emptyCursor: SessionUsageCursor = {
  nextSeq: 0,
  last: null,
  totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
}

/**
 * Attribute one event timestamp to its LOCAL calendar day. Personal
 * workbench, local eyes: the 7 天/8 周视图 answer "which of my days", not
 * UTC's.
 * @param time - epoch milliseconds of the event.
 * @returns the `YYYY-MM-DD` local day stamp.
 */
export function dayOf(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The usage one durable Assistant settlement reports for its attempt, if any. */
function usageOf(event: SessionEvent): TokenUsage | undefined {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
}

function bucketsFrom(usage: TokenUsage): UsageBuckets {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
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

/** Negate one bucket, keeping zero positive — `-0` would leak into the ledger and the wire. */
function neg(value: number): number {
  return value === 0 ? 0 : -value
}

function negBuckets(buckets: UsageBuckets): UsageBuckets {
  return {
    uncachedInputTokens: neg(buckets.uncachedInputTokens),
    outputTokens: neg(buckets.outputTokens),
    cacheReadTokens: neg(buckets.cacheReadTokens),
    cacheWriteTokens: neg(buckets.cacheWriteTokens),
  }
}

function equalBuckets(left: UsageBuckets, right: UsageBuckets): boolean {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

const ZERO_BUCKETS: UsageBuckets = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const zeroDelta = (delta: UsageBuckets): boolean => equalBuckets(delta, ZERO_BUCKETS)

export interface FoldSessionResult {
  /** The advanced cursor — persist it even when `deltas` is empty. */
  readonly cursor: SessionUsageCursor
  /** Signed day movements, in event order; zero deltas are omitted. */
  readonly deltas: readonly UsageDayDelta[]
}

/**
 * Fold one batch of events (logical seqs `cursor.nextSeq …`) into the
 * session's cursor and the ledger's day deltas.
 * @param cursor - the session's persisted fold state.
 * @param events - the contiguous event slice starting at `cursor.nextSeq`.
 * @returns the advanced cursor plus the day movements to merge.
 */
export function foldSessionEvents(cursor: SessionUsageCursor, events: readonly SessionEvent[]): FoldSessionResult {
  let next = cursor
  const deltas: UsageDayDelta[] = []
  for (const event of events) {
    if (event.type === 'llm/retry-started') {
      // Upstream semantics: the retry closes the replacement slot so the
      // retried attempt ADDS to the total — both attempts were billed. No
      // ledger movement here; the slot empties so the next sample of the
      // same turn/step finds no subtraction basis.
      if (next.last?.turn === event.data.turn && next.last.step === event.data.step) {
        next = { ...next, last: null }
      }
      next = { ...next, nextSeq: event.seq + 1 }
      continue
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') {
      next = { ...next, nextSeq: event.seq + 1 }
      continue
    }
    const sample = usageOf(event)
    if (sample === undefined) {
      next = { ...next, nextSeq: event.seq + 1 }
      continue
    }
    const { turn, step } = event.data
    const buckets = bucketsFrom(sample)
    const previous = next.last !== null && next.last.turn === turn && next.last.step === step
      ? next.last
      : undefined
    if (previous !== undefined && equalBuckets(previous.buckets, buckets)) {
      // A re-settlement reporting the same accounting: nothing moved.
      next = { ...next, nextSeq: event.seq + 1 }
      continue
    }
    if (previous !== undefined && !zeroDelta(previous.buckets)) {
      deltas.push({ day: previous.day, delta: negBuckets(previous.buckets) })
    }
    if (!zeroDelta(buckets)) {
      deltas.push({ day: dayOf(event.time), delta: buckets })
    }
    next = {
      nextSeq: event.seq + 1,
      last: { turn, step, day: dayOf(event.time), buckets },
      totals: addBuckets(
        addBuckets(next.totals, buckets),
        previous === undefined
          ? { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
          : negBuckets(previous.buckets),
      ),
    }
  }
  return { cursor: next, deltas }
}
