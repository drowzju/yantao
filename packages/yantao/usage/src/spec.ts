/**
 * The `yantao_usage` domain declaration: record schemas and the
 * `defineDomain` spec the service opens. Two tables — the day ledger and the
 * per-session scan cursors. The zod schemas validate the shipped format at
 * the durability boundary.
 *
 * Deliberately NOT under kbRoot: this is platform telemetry about sessions,
 * not knowledge-base content, and the KB root belongs to the user's Obsidian
 * vault (ADR-0048) —寸土寸金，台账不落那里。
 * @module @deepseek-ai/dsh-yantao-usage/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DayUsageRecord, SessionUsageCursor } from './types.ts'

const bucketsSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
})

const dayUsageRecordSchema = bucketsSchema.extend({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionIds: z.array(z.string()),
})

const usageLastSlotSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  buckets: bucketsSchema,
})

const sessionUsageCursorSchema = z.object({
  nextSeq: z.number().int().nonnegative(),
  last: usageLastSlotSchema.nullable(),
  totals: bucketsSchema,
})

/**
 * The usage domain spec: one `days` table keyed by `YYYY-MM-DD` and one
 * `sessions` table keyed by session id. The service opens this through
 * `ctx.storageDomain.open`; the spec is the single source of the domain's
 * identity, version, and schemas.
 */
export const usageDomainSpec = defineDomain({
  name: 'yantao_usage',
  version: 1,
  // per-record: day rows and per-session cursors are large, sparse, and
  // individually disposable — the `single` default would re-serialize the
  // whole domain on every delta put. A legacy `single` whole-unit file seeds
  // the per-record tree on first open (storage-json's legacy bootstrap), so
  // existing local ledgers migrate implicitly.
  layout: 'per-record',
  tables: {
    days: domainTable<string, DayUsageRecord>(dayUsageRecordSchema),
    sessions: domainTable<string, SessionUsageCursor>(sessionUsageCursorSchema),
  },
})
