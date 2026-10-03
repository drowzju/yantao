import { describe, expect, it } from 'vitest'
import { cronMatchesAt, cronNextAfter, cronNextFire, parseCron } from '../src/client/cron.ts'

/** A local-time Date builder that reads like the cron fields. */
function at(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

describe('parseCron', () => {
  it('接受五段全 *', () => {
    expect(parseCron('* * * * *')).not.toBeNull()
  })

  it('拒绝段数不对', () => {
    expect(parseCron('* * * *')).toBeNull()
    expect(parseCron('* * * * * *')).toBeNull()
  })

  it('拒绝越界数字与坏形状', () => {
    expect(parseCron('60 * * * *')).toBeNull()
    expect(parseCron('* 24 * * *')).toBeNull()
    expect(parseCron('* * 0 * *')).toBeNull()
    expect(parseCron('* * * 13 *')).toBeNull()
    expect(parseCron('* * * * 8')).toBeNull()
    expect(parseCron('abc * * * *')).toBeNull()
    expect(parseCron('*/0 * * * *')).toBeNull()
    expect(parseCron('5-2 * * * *')).toBeNull()
  })

  it('接受列表、范围与步进', () => {
    expect(parseCron('0 9 * * 1-5')).not.toBeNull()
    expect(parseCron('*/10 * * * *')).not.toBeNull()
    expect(parseCron('0 8,12,18 * * *')).not.toBeNull()
    expect(parseCron('0 9 1-15/2 * *')).not.toBeNull()
  })
})

describe('cronMatchesAt', () => {
  it('整点命中', () => {
    const schedule = parseCron('30 9 * * *')!
    expect(cronMatchesAt(schedule, at(2026, 10, 5, 9, 30))).toBe(true)
    expect(cronMatchesAt(schedule, at(2026, 10, 5, 9, 31))).toBe(false)
    expect(cronMatchesAt(schedule, at(2026, 10, 5, 8, 30))).toBe(false)
  })

  it('步进命中', () => {
    const schedule = parseCron('*/15 * * * *')!
    expect(cronMatchesAt(schedule, at(2026, 10, 5, 9, 0))).toBe(true)
    expect(cronMatchesAt(schedule, at(2026, 10, 5, 9, 45))).toBe(true)
    expect(cronMatchesAt(schedule, at(2026, 10, 5, 9, 7))).toBe(false)
  })

  it('周日 0 与 7 等价', () => {
    const sunday = at(2026, 10, 4, 9, 0) // 2026-10-04 是周日
    expect(cronMatchesAt(parseCron('0 9 * * 0')!, sunday)).toBe(true)
    expect(cronMatchesAt(parseCron('0 9 * * 7')!, sunday)).toBe(true)
  })

  it('日与周同时受限时取或（Vixie 语义）', () => {
    // 每月 1 号或每周一
    const schedule = parseCron('0 9 1 * 1')!
    expect(cronMatchesAt(schedule, at(2026, 10, 1, 9, 0))).toBe(true) // 1 号（周四）
    expect(cronMatchesAt(schedule, at(2026, 10, 5, 9, 0))).toBe(true) // 周一
    expect(cronMatchesAt(schedule, at(2026, 10, 6, 9, 0))).toBe(false) // 周二非 1 号
  })

  it('仅日受限时周必须为 *', () => {
    const schedule = parseCron('0 9 15 * *')!
    expect(cronMatchesAt(schedule, at(2026, 10, 15, 9, 0))).toBe(true)
    expect(cronMatchesAt(schedule, at(2026, 10, 14, 9, 0))).toBe(false)
  })

  it('忽略秒级', () => {
    const schedule = parseCron('30 9 * * *')!
    const withSeconds = new Date(2026, 9, 5, 9, 30, 45, 123)
    expect(cronMatchesAt(schedule, withSeconds)).toBe(true)
  })
})

describe('cronNextAfter', () => {
  it('同小时内找下一分钟', () => {
    const schedule = parseCron('30 9 * * *')!
    expect(cronNextAfter(schedule, at(2026, 10, 5, 9, 0))).toEqual(at(2026, 10, 5, 9, 30))
  })

  it('跨天找下次', () => {
    const schedule = parseCron('0 9 * * *')!
    expect(cronNextAfter(schedule, at(2026, 10, 5, 9, 0))).toEqual(at(2026, 10, 6, 9, 0))
  })

  it('跨周末找周一', () => {
    // 2026-10-03 周六 → 下次周一是 10-05
    const schedule = parseCron('0 9 * * 1')!
    expect(cronNextAfter(schedule, at(2026, 10, 3, 10, 0))).toEqual(at(2026, 10, 5, 9, 0))
  })

  it('跨年找 2 月 29 日', () => {
    // 2028 是闰年
    const schedule = parseCron('0 0 29 2 *')!
    expect(cronNextAfter(schedule, at(2026, 10, 3, 0, 0))).toEqual(at(2028, 2, 29, 0, 0))
  })

  it('永不触发返回 null', () => {
    const schedule = parseCron('0 0 31 2 *')!
    expect(cronNextAfter(schedule, at(2026, 10, 3, 0, 0))).toBeNull()
  })

  it('下界是排他的', () => {
    const schedule = parseCron('0 9 * * *')!
    const exact = at(2026, 10, 5, 9, 0)
    expect(cronNextAfter(schedule, exact)).toEqual(at(2026, 10, 6, 9, 0))
  })
})

describe('cronNextFire', () => {
  it('坏表达式返回 null', () => {
    expect(cronNextFire('不是 cron', new Date())).toBeNull()
  })

  it('好表达式给出下次触发', () => {
    expect(cronNextFire('0 9 * * *', at(2026, 10, 5, 8, 0))).toEqual(at(2026, 10, 5, 9, 0))
  })
})
