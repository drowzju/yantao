/**
 * Unit pins for the cross-session overview's pure shaping (ADR-0050): the
 * calendar arithmetic (day shifting, the Monday-first heat grid), the range
 * windows' zero-filling, the KPI folds, and the session-card fold/filter.
 * Every assertion anchors on one fixed day key, so no test depends on the
 * machine's timezone.
 * @module @deepseek-ai/dsh-client-ui-yantao/overview.spec
 */
import { describe, expect, it } from 'vitest'
import type { SessionSummary, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DayUsageRecord } from '@deepseek-ai/dsh-api-yantao-usage-controller/types'
import {
  barsForRange, cacheHitRateOf, distinctSessionsOf, filterSessionRows, grandTotalOf,
  heatmapCellsOf, sessionRowsOf, shiftDay, stampOf, todayKey,
} from '../src/client/overview.ts'

/** One ledger row; missing buckets default to zero. */
function day(key: string, total: Partial<DayUsageRecord> = {}): DayUsageRecord {
  return {
    day: key,
    sessionIds: [],
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...total,
  }
}

/** One list-snapshot row with only the fields the fold reads. */
function summary(overrides: Partial<SessionSummary> & Pick<SessionSummary, 'id'>): SessionSummary {
  return {
    displayTitle: '',
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
    ...overrides,
  } as SessionSummary
}

const state = (byId: Record<string, SessionSummary>): SessionListState =>
  ({ ids: Object.keys(byId), byId, phase: 'ready', projectionsBySession: {} }) as SessionListState

describe('todayKey / shiftDay', () => {
  it('formats the local calendar day and shifts across month and year boundaries', () => {
    expect(todayKey(new Date(2026, 9, 7))).toBe('2026-10-07')
    expect(shiftDay('2026-10-07', 0)).toBe('2026-10-07')
    expect(shiftDay('2026-10-07', -6)).toBe('2026-10-01')
    expect(shiftDay('2026-10-07', -7)).toBe('2026-09-30')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2025-12-31', 1)).toBe('2026-01-01')
  })
})

describe('barsForRange', () => {
  it('fills the 7-day window with zero rows on quiet days, ending on today', () => {
    const bars = barsForRange([day('2026-10-06', { outputTokens: 5 })], '7d', '2026-10-07')
    expect(bars.map(row => row.day)).toEqual([
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
    ])
    expect(bars[5]).toMatchObject({ outputTokens: 5 })
    expect(grandTotalOf(bars[0]!)).toBe(0)
    expect(grandTotalOf(bars[6]!)).toBe(0)
  })

  it('passes the whole ledger through for `all` and fills 30 rows for `30d`', () => {
    const ledger = [day('2025-01-01')]
    expect(barsForRange(ledger, 'all', '2026-10-07')).toBe(ledger)
    expect(barsForRange([], '30d', '2026-10-07')).toHaveLength(30)
  })
})

describe('heatmapCellsOf', () => {
  it('lays out 8 columns × 7 Monday-first rows, ending at today, flagging future cells', () => {
    // 2026-10-07 is a Wednesday: its week's Monday is 2026-10-05.
    const grid = heatmapCellsOf([day('2026-10-07', { outputTokens: 9 })], '2026-10-07')
    expect(grid).toHaveLength(8)
    for (const column of grid) expect(column).toHaveLength(7)
    expect(grid.at(-1)!.at(0)!.day).toBe('2026-10-05')
    expect(grid.at(-1)!.at(2)!.day).toBe('2026-10-07')
    expect(grid.at(-1)!.at(2)!.total).toBe(9)
    expect(grid.at(-1)!.at(3)!.future).toBe(true)
    expect(grid.at(-1)!.at(2)!.future).toBe(false)
    expect(grid.at(0)!.at(0)!.day).toBe(shiftDay('2026-10-05', -49))
  })
})

describe('cacheHitRateOf / distinctSessionsOf', () => {
  it('counts cache writes as misses and rounds; zero denominator reads as 0', () => {
    expect(cacheHitRateOf({ uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 300, cacheWriteTokens: 100 })).toBe(60)
    expect(cacheHitRateOf({ uncachedInputTokens: 0, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0)
  })

  it('unions the range rows\' session ids', () => {
    expect(distinctSessionsOf([
      day('2026-10-06', { sessionIds: ['a', 'b'] }),
      day('2026-10-07', { sessionIds: ['b', 'c'] }),
    ])).toBe(3)
  })
})

describe('sessionRowsOf', () => {
  it('drops blanks, titles by displayTitle, reads lifetime totals, sorts newest first', () => {
    const rows = sessionRowsOf(state({
      blank: summary({ id: 'b', blank: true, displayTitle: '草稿', updatedAt: 30 }),
      old: summary({ id: 'o', displayTitle: '旧会话', updatedAt: 10, projectionValues: { tokenUsage: { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 } } }),
      new: summary({ id: 'n', displayTitle: '新会话', cwd: 'D:\\proj', updatedAt: 20, running: true }),
    }))
    expect(rows.map(row => row.id)).toEqual(['n', 'o'])
    expect(rows[0]).toMatchObject({ title: '新会话', cwd: 'D:\\proj', running: true, totals: undefined })
    expect(rows[1]!.totals).toMatchObject({ outputTokens: 2 })
  })
})

describe('filterSessionRows', () => {
  const rows = sessionRowsOf(state({
    a: summary({ id: 'a', displayTitle: 'Refactor 洞察', updatedAt: 2 }),
    b: summary({ id: 'b', displayTitle: '别的', cwd: 'D:\\yantao', updatedAt: 1 }),
  }))
  const ledger = [day('2026-10-07', { sessionIds: ['b'] })]

  it('matches title or cwd case-insensitively; empty query passes everything', () => {
    expect(filterSessionRows(rows, '', undefined, ledger).map(row => row.id)).toEqual(['a', 'b'])
    expect(filterSessionRows(rows, 'REFACTOR', undefined, ledger).map(row => row.id)).toEqual(['a'])
    expect(filterSessionRows(rows, 'yantao', undefined, ledger).map(row => row.id)).toEqual(['b'])
    expect(filterSessionRows(rows, '没有', undefined, ledger)).toEqual([])
  })

  it('keeps only the active day\'s contributing sessions', () => {
    expect(filterSessionRows(rows, '', '2026-10-07', ledger).map(row => row.id)).toEqual(['b'])
    expect(filterSessionRows(rows, '', '2026-10-01', ledger)).toEqual([])
  })
})

describe('stampOf', () => {
  it('shows the clock on the same day, month-day within the year, full date otherwise', () => {
    const now = new Date(2026, 9, 7, 18, 0)
    expect(stampOf(new Date(2026, 9, 7, 9, 5).getTime(), now)).toBe('09:05')
    expect(stampOf(new Date(2026, 4, 3).getTime(), now)).toBe('05-03')
    expect(stampOf(new Date(2025, 4, 3).getTime(), now)).toBe('2025-05-03')
  })
})
