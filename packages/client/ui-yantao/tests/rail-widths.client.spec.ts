// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  comfortWidth, emptyRailWidths, persistRailWidths, readRailWidths,
  type RailWidthStorage,
} from '../src/client/frame/rail-widths.ts'

/** An in-memory stand-in for localStorage. */
function memory(seed?: string): RailWidthStorage & { readonly writes: string[] } {
  const writes: string[] = []
  let value: string | null = seed ?? null
  return {
    writes,
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      writes.push(next)
      value = next
    },
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('comfortWidth', () => {
  it('工作空间 tab declares a wider comfort width; unlisted tabs take the default', () => {
    expect(comfortWidth('intake', 'workspace')).toBeGreaterThan(280)
    expect(comfortWidth('intake', 'resources')).toBe(280)
    expect(comfortWidth('entities', 'areas')).toBe(280)
  })
})

describe('readRailWidths', () => {
  it('reads back what was persisted', () => {
    const storage = memory()
    persistRailWidths({ intake: { workspace: 360 }, entities: { areas: 300 } }, storage)
    expect(readRailWidths(storage)).toEqual({ intake: { workspace: 360 }, entities: { areas: 300 } })
    expect(storage.writes).toHaveLength(1)
  })

  it('missing entry, bad JSON, wrong shapes and non-numeric values all yield the empty set', () => {
    expect(readRailWidths(memory())).toEqual(emptyRailWidths())
    expect(readRailWidths(memory('{ 不是 json'))).toEqual(emptyRailWidths())
    expect(readRailWidths(memory('["不是对象"]'))).toEqual(emptyRailWidths())
    expect(readRailWidths(memory(JSON.stringify({ intake: { workspace: '宽' }, entities: { areas: -5, people: 0 } }))))
      .toEqual(emptyRailWidths())
  })
})

describe('persistRailWidths', () => {
  it('degrades to a no-op when storage refuses', () => {
    const refusing: RailWidthStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
    }
    expect(() => persistRailWidths(emptyRailWidths(), refusing)).not.toThrow()
  })
})
