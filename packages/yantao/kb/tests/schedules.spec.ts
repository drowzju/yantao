import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cronShapeError, markSchedule, newScheduleId, normalizeSchedules, readSchedules,
  SCHEDULES_DISPLAY_PATH, SCHEDULES_SOFT_CAP, writeSchedules,
  type Schedule,
} from '../src/schedules.ts'
import { KbError } from '../src/types.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-schedules-'))
  await mkdir(join(kbRoot, '.dsh', 'yantao'), { recursive: true })
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** One valid row; overrides land on top. */
function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch_abc123def',
    name: '晨检',
    prompt: '检查待办并汇总',
    cron: '0 9 * * *',
    enabled: true,
    ...overrides,
  }
}

describe('cronShapeError', () => {
  it('接受五段合法表达式', () => {
    expect(cronShapeError('* * * * *')).toBeNull()
    expect(cronShapeError('0 9 * * 1-5')).toBeNull()
    expect(cronShapeError('*/10 * * * *')).toBeNull()
    expect(cronShapeError('0 8,12,18 1-15/2 * 0')).toBeNull()
  })

  it('拒绝段数不对', () => {
    expect(cronShapeError('* * * *')).toContain('5 段')
    expect(cronShapeError('')).toContain('5 段')
  })

  it('拒绝越界与坏形状，报出段位', () => {
    expect(cronShapeError('60 * * * *')).toContain('分')
    expect(cronShapeError('* 24 * * *')).toContain('时')
    expect(cronShapeError('* * 0 * *')).toContain('日')
    expect(cronShapeError('* * * 13 *')).toContain('月')
    expect(cronShapeError('* * * * 8')).toContain('周')
    expect(cronShapeError('x * * * *')).toContain('不合法')
    expect(cronShapeError('*/0 * * * *')).toContain('步进')
  })
})

describe('normalizeSchedules', () => {
  it('修剪空白并保留可选时间戳', () => {
    const [row] = normalizeSchedules([schedule({ name: '  晨检  ', lastFiredAt: '2026-10-03T09:00:00.000Z' })])
    expect(row?.name).toBe('晨检')
    expect(row?.lastFiredAt).toBe('2026-10-03T09:00:00.000Z')
  })

  it('enabled 只认 true', () => {
    expect(normalizeSchedules([schedule({ enabled: undefined as unknown as boolean })])[0]?.enabled).toBe(false)
  })

  it('拒绝缺 id、空名称、空提示词、坏 cron、重复 id、坏时间戳', () => {
    expect(() => normalizeSchedules([schedule({ id: '' })])).toThrow(KbError)
    expect(() => normalizeSchedules([schedule({ name: ' ' })])).toThrow(/名称/)
    expect(() => normalizeSchedules([schedule({ prompt: '' })])).toThrow(/提示词/)
    expect(() => normalizeSchedules([schedule({ cron: '不是 cron' })])).toThrow(/触发规则/)
    expect(() => normalizeSchedules([schedule(), schedule()])).toThrow(/重复/)
    expect(() => normalizeSchedules([schedule({ id: 'sch_other' }), schedule({ lastMissedAt: '不是日期' })])).toThrow(/时间戳/)
  })

  it('软帽之上拒绝', () => {
    const many = Array.from({ length: SCHEDULES_SOFT_CAP + 1 }, (_, at) => schedule({ id: `sch_${at}` }))
    expect(() => normalizeSchedules(many)).toThrow(/最多/)
  })
})

describe('readSchedules / writeSchedules', () => {
  it('缺文件读作空列表', async () => {
    await expect(readSchedules(kbRoot)).resolves.toEqual([])
  })

  it('写后读回同一列表', async () => {
    const rows = [schedule(), schedule({ id: 'sch_b22222222', name: '周报', cron: '0 18 * * 5', enabled: false })]
    await writeSchedules(kbRoot, rows)
    await expect(readSchedules(kbRoot)).resolves.toEqual(rows)
  })

  it('坏 JSON 是响亮的错误', async () => {
    await writeFile(join(kbRoot, SCHEDULES_DISPLAY_PATH), '{ 不是 json', 'utf8')
    await expect(readSchedules(kbRoot)).rejects.toThrow(KbError)
  })

  it('写前校验：坏列表不碰文件', async () => {
    await writeSchedules(kbRoot, [schedule()])
    await expect(writeSchedules(kbRoot, [schedule({ cron: '61 * * * *' })])).rejects.toThrow(KbError)
    await expect(readSchedules(kbRoot)).resolves.toEqual([schedule()])
  })

  it('新 KB 没有 .dsh/yantao 目录时也能写（先建目录）', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'yantao-kb-schedules-fresh-'))
    try {
      await writeSchedules(fresh, [schedule()])
      await expect(readSchedules(fresh)).resolves.toEqual([schedule()])
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})

describe('markSchedule', () => {
  it('只动时间戳：设置、清除、留不动', async () => {
    await writeSchedules(kbRoot, [schedule()])
    const fired = await markSchedule(kbRoot, 'sch_abc123def', { lastFiredAt: '2026-10-03T09:00:00.000Z' })
    expect(fired[0]).toMatchObject({ lastFiredAt: '2026-10-03T09:00:00.000Z', name: '晨检', cron: '0 9 * * *' })
    const missed = await markSchedule(kbRoot, 'sch_abc123def', { lastMissedAt: '2026-10-03T10:00:00.000Z' })
    expect(missed[0]).toMatchObject({ lastFiredAt: '2026-10-03T09:00:00.000Z', lastMissedAt: '2026-10-03T10:00:00.000Z' })
    const cleared = await markSchedule(kbRoot, 'sch_abc123def', { lastMissedAt: null })
    expect(cleared[0]).toMatchObject({ lastFiredAt: '2026-10-03T09:00:00.000Z' })
    expect(cleared[0]?.lastMissedAt).toBeUndefined()
    // 持久化验证
    await expect(readSchedules(kbRoot)).resolves.toEqual(cleared)
  })

  it('未知 id 拒绝', async () => {
    await writeSchedules(kbRoot, [schedule()])
    await expect(markSchedule(kbRoot, 'sch_ghost', { lastFiredAt: '2026-10-03T09:00:00.000Z' })).rejects.toThrow(KbError)
  })
})

describe('newScheduleId', () => {
  it('嵌入创建时间且互不重复', () => {
    const now = new Date('2026-10-03T08:00:00.000Z')
    const first = newScheduleId(now)
    const second = newScheduleId(now)
    expect(first.startsWith(`sch_${now.getTime().toString(36)}`)).toBe(true)
    expect(first).not.toBe(second)
  })
})
