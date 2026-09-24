import { describe, expect, it } from 'vitest'
import { formatElapsed, runningCount, sortTaskRows, type TaskRow } from '../src/client/task-view.ts'

/** One row with the boring fields filled in. */
function row(overrides: Partial<TaskRow> & { readonly id: string }): TaskRow {
  return {
    kind: 'refine', title: '提炼「x」', stage: '', detail: null,
    status: 'running', startedAt: 0, endedAt: null,
    sessionId: null,
    ...overrides,
  }
}

describe('sortTaskRows', () => {
  it('puts running first (oldest start on top), then waiting, then the endings newest first', () => {
    const rows = [
      row({ id: 'done-new', status: 'done', endedAt: 200 }),
      row({ id: 'run-old', startedAt: 10 }),
      row({ id: 'done-old', status: 'cancelled', endedAt: 100 }),
      row({ id: 'wait', status: 'waiting', startedAt: 5 }),
      row({ id: 'run-new', startedAt: 20 }),
      row({ id: 'failed', status: 'failed', endedAt: 150 }),
    ]
    expect(sortTaskRows(rows).map(entry => entry.id)).toEqual([
      'run-old', 'run-new', 'wait', 'done-new', 'failed', 'done-old',
    ])
  })

  it('keeps the arrival order among equal keys instead of gambling on sort stability', () => {
    const rows = [
      row({ id: 'a', startedAt: 10 }),
      row({ id: 'b', startedAt: 10 }),
    ]
    expect(sortTaskRows(rows).map(entry => entry.id)).toEqual(['a', 'b'])
  })
})

describe('runningCount', () => {
  it('counts only the running rows', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c', status: 'waiting' }),
      row({ id: 'd', status: 'done', endedAt: 1 }),
    ]
    expect(runningCount(rows)).toBe(2)
  })

  it('answers zero for an empty list', () => {
    expect(runningCount([])).toBe(0)
  })
})

describe('formatElapsed', () => {
  it('formats mm:ss below the hour and h:mm:ss past it', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65_000)).toBe('01:05')
    expect(formatElapsed(3_675_000)).toBe('1:01:15')
  })

  it('clamps a negative duration to zero', () => {
    expect(formatElapsed(-5)).toBe('00:00')
  })
})
