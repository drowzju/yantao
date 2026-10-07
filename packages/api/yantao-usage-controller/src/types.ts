/**
 * The `yantaoUsage` namespace's wire vocabulary. The ledger primitives
 * (`DayUsageRecord`/`UsageBuckets`) are the usage package's own types
 * re-exported — one source, no restatement. The two daily-read shapes are
 * restated locally under `UsageWire` names instead: the ledger service
 * declares the same shapes as `UsageDailyArgs`/`UsageDailyResult`, and the
 * catalog generator drops any name declared twice (same reasoning as the kb
 * controller's `KbWire*` types). They are structurally identical to the
 * service's types, so the controller's delegation needs no mapping.
 * @module @deepseek-ai/dsh-api-yantao-usage-controller/types
 */

import type { DayUsageRecord, UsageBuckets } from '@deepseek-ai/dsh-yantao-usage'

export type { DayUsageRecord, UsageBuckets }

/** Range selectors for the daily read; both bounds inclusive, local `YYYY-MM-DD` days. */
export interface UsageWireDailyArgs {
  readonly sinceDay?: string
  readonly untilDay?: string
}

/** The day ledger over the requested range, oldest first, plus its sum. */
export interface UsageWireDailyResult {
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
