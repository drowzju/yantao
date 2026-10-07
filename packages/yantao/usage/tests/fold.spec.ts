/**
 * The usage fold's contract, against hand-built event fixtures: replacement
 * slot semantics, retry closure, day attribution, midnight rollover, and the
 * equal-buckets short circuit.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { dayOf, emptyCursor, foldSessionEvents } from '../src/fold.ts'
import type { SessionUsageCursor } from '../src/types.ts'

const DAY1 = '2026-10-06'
const DAY2 = '2026-10-07'
/** 10-06 23:59 与 10-07 00:01（本地时区无关紧要：同一构造内自洽）。 */
const TIME_D1 = Date.parse('2026-10-06T23:59:00')
const TIME_D2 = Date.parse('2026-10-07T00:01:00')

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0): TokenUsage => ({
  inputTokens: input,
  outputTokens: output,
  ...(cacheRead !== 0 ? { cacheReadTokens: cacheRead } : {}),
  ...(cacheWrite !== 0 ? { cacheWriteTokens: cacheWrite } : {}),
})

const settlement = (seq: number, time: number, turn: number, step: number, u: TokenUsage): SessionEvent => ({
  type: 'assistant/message',
  seq,
  time,
  data: { turn, step, message: {}, stream: [], usage: u },
} as unknown as SessionEvent)

const retryStarted = (seq: number, time: number, turn: number, step: number): SessionEvent => ({
  type: 'llm/retry-started',
  seq,
  time,
  data: { turn, step },
} as unknown as SessionEvent)

const irrelevant = (seq: number, time: number): SessionEvent => ({
  type: 'tool/result',
  seq,
  time,
  data: {},
} as unknown as SessionEvent)

const totalsOf = (cursor: SessionUsageCursor): Record<string, number> => ({ ...cursor.totals })

describe('dayOf', () => {
  it('formats a local calendar day', () => {
    expect(dayOf(TIME_D1)).toBe(DAY1)
    expect(dayOf(TIME_D2)).toBe(DAY2)
  })
})

describe('foldSessionEvents', () => {
  it('advances nextSeq across irrelevant events and attributes samples to their day', () => {
    const { cursor, deltas } = foldSessionEvents(emptyCursor, [
      irrelevant(0, TIME_D1),
      settlement(1, TIME_D1, 1, 1, usage(100, 10)),
      irrelevant(2, TIME_D1),
    ])
    expect(cursor.nextSeq).toBe(3)
    expect(totalsOf(cursor)).toEqual({ uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(deltas).toEqual([
      { day: DAY1, delta: { uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ])
  })

  it('replaces a re-settlement of the same turn/step instead of adding', () => {
    let cursor = emptyCursor
    ;({ cursor } = foldSessionEvents(cursor, [settlement(0, TIME_D1, 1, 1, usage(100, 10))]))
    const { cursor: next, deltas } = foldSessionEvents(cursor, [settlement(1, TIME_D1, 1, 1, usage(150, 12))])
    expect(totalsOf(next)).toEqual({ uncachedInputTokens: 150, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(deltas).toEqual([
      { day: DAY1, delta: { uncachedInputTokens: -100, outputTokens: -10, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { day: DAY1, delta: { uncachedInputTokens: 150, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ])
  })

  it('short-circuits an identical re-settlement', () => {
    let cursor = emptyCursor
    ;({ cursor } = foldSessionEvents(cursor, [settlement(0, TIME_D1, 1, 1, usage(100, 10))]))
    const { cursor: next, deltas } = foldSessionEvents(cursor, [settlement(1, TIME_D1, 1, 1, usage(100, 10))])
    expect(totalsOf(next)).toEqual(totalsOf(cursor))
    expect(deltas).toEqual([])
    expect(next.nextSeq).toBe(2)
  })

  it('closes the replacement slot on retry-started so the retried attempt adds', () => {
    let cursor = emptyCursor
    ;({ cursor } = foldSessionEvents(cursor, [settlement(0, TIME_D1, 1, 1, usage(100, 10))]))
    ;({ cursor } = foldSessionEvents(cursor, [retryStarted(1, TIME_D1, 1, 1)]))
    const { cursor: next } = foldSessionEvents(cursor, [settlement(2, TIME_D1, 1, 1, usage(120, 8))])
    // 两次尝试都已计费：100+120。
    expect(totalsOf(next)).toEqual({ uncachedInputTokens: 220, outputTokens: 18, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('attributes a replacement across midnight to each sample\'s own day', () => {
    let cursor = emptyCursor
    ;({ cursor } = foldSessionEvents(cursor, [settlement(0, TIME_D1, 1, 1, usage(100, 10))]))
    const { cursor: next, deltas } = foldSessionEvents(cursor, [settlement(1, TIME_D2, 1, 1, usage(200, 20))])
    expect(totalsOf(next).uncachedInputTokens).toBe(200)
    expect(deltas).toEqual([
      { day: DAY1, delta: { uncachedInputTokens: -100, outputTokens: -10, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { day: DAY2, delta: { uncachedInputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ])
  })

  it('reads usage from the stream tail when the settlement carries no top-level usage', () => {
    const event = {
      type: 'assistant/attempt',
      seq: 0,
      time: TIME_D1,
      data: { turn: 1, step: 1, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: usage(5, 1) } }] },
    } as unknown as SessionEvent
    const { cursor } = foldSessionEvents(emptyCursor, [event])
    expect(cursor.totals.uncachedInputTokens).toBe(5)
    expect(cursor.totals.outputTokens).toBe(1)
  })
})
