/**
 * The `yantaoUsage` namespace's wire vocabulary. The record shapes are the
 * usage package's own types re-exported — one source, no restatement — so a
 * ledger shape change flows to the client through this module alone.
 * @module @deepseek-ai/dsh-api-yantao-usage-controller/types
 */

import type { DayUsageRecord, UsageBuckets } from '@deepseek-ai/dsh-yantao-usage'

export type { DayUsageRecord, UsageBuckets }

/** Range selectors for {@link UsageDailyResult}; both bounds inclusive, local `YYYY-MM-DD` days. */
export interface UsageDailyArgs {
  readonly sinceDay?: string
  readonly untilDay?: string
}

/** The day ledger over the requested range, oldest first, plus its sum. */
export interface UsageDailyResult {
  readonly days: readonly DayUsageRecord[]
  readonly totals: UsageBuckets
}

/** Arguments addressing one stored session. */
export interface UsageSessionArgs {
  readonly sessionId: string
}

/** One session's lifetime token totals. */
export interface UsageSessionResult {
  readonly sessionId: string
  readonly totals: UsageBuckets
}
