/**
 * The yantao usage ledger plugin (ADR-0050): default-exports the
 * `YantaoUsageService` for the cordis plugin loader to mount — the loader
 * instantiates the default-exported Service and provides it under its
 * constructor key, so this package needs no `apply` of its own.
 * @module @deepseek-ai/dsh-yantao-usage
 */

export { UsageSessionUnknownError, YantaoUsageService } from './service.ts'
export type { UsageDailyArgs, UsageDailyResult } from './service.ts'
export { usageDomainSpec } from './spec.ts'
export { dayOf, emptyCursor, foldSessionEvents } from './fold.ts'
export type { FoldSessionResult } from './fold.ts'
export type {
  DayUsageRecord, SessionUsageCursor, UsageBuckets, UsageDayDelta, UsageLastSlot,
} from './types.ts'
export { default } from './service.ts'
