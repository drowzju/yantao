import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { markSchedule, writeSchedules, type Schedule, type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let kbConfigured: boolean
let ctx: Context
let fiber: { dispose(): Promise<void> }

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-schedule-rpc-'))
  kbConfigured = true
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return kbRoot
    },
    get configured(): boolean {
      return kbConfigured
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  ctx.provide('skills', { get: async () => undefined } as never)
  ctx.provide('tools', { register: () => {} } as never)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

/** One valid row; overrides land on top. */
function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch_abc123_def',
    name: '晨检',
    prompt: '检查待办并汇总',
    cron: '0 9 * * *',
    enabled: true,
    ...overrides,
  }
}

describe('yantaoKb.scheduleList', () => {
  it('answers an empty list before anything is saved', async () => {
    expect(await ctx.yantaoKbController.scheduleList()).toEqual({ schedules: [] })
  })

  it('refuses before a KB root is chosen', async () => {
    kbConfigured = false
    const failure = await ctx.yantaoKbController.scheduleList().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })
})

describe('yantaoKb.scheduleSave', () => {
  it('validates the cron shape, quoting the schedule name', async () => {
    const failure = await ctx.yantaoKbController
      .scheduleSave({ schedules: [schedule({ cron: '61 * * * *' })] })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toContain('晨检')
  })

  it('preserves the stored stamps across an editor save (ADR-0045 修订)', async () => {
    await writeSchedules(kbRoot, [schedule()])
    await markSchedule(kbRoot, 'sch_abc123_def', {
      lastFiredAt: '2026-10-03T09:00:00.000Z',
      lastMissedAt: '2026-10-02T09:00:00.000Z',
    })
    // An editor renames the row from a stale snapshot that carries no stamps.
    const result = await ctx.yantaoKbController.scheduleSave({ schedules: [schedule({ name: '晨检 v2' })] })
    expect(result.schedules[0]).toMatchObject({
      name: '晨检 v2',
      lastFiredAt: '2026-10-03T09:00:00.000Z',
      lastMissedAt: '2026-10-02T09:00:00.000Z',
    })
  })
})

describe('yantaoKb.scheduleMark', () => {
  it('sets and clears stamps on one row without touching the others', async () => {
    await writeSchedules(kbRoot, [schedule(), schedule({ id: 'sch_other_01', name: '周报' })])
    const marked = await ctx.yantaoKbController.scheduleMark({
      id: 'sch_abc123_def',
      lastFiredAt: '2026-10-03T09:00:00.000Z',
      lastMissedAt: '2026-10-02T09:00:00.000Z',
    })
    expect(marked.schedules[0]).toMatchObject({ lastFiredAt: '2026-10-03T09:00:00.000Z', lastMissedAt: '2026-10-02T09:00:00.000Z' })
    expect(marked.schedules[1]?.lastFiredAt).toBeUndefined()
    const cleared = await ctx.yantaoKbController.scheduleMark({ id: 'sch_abc123_def', lastMissedAt: null })
    expect(cleared.schedules[0]?.lastMissedAt).toBeUndefined()
    expect(cleared.schedules[0]?.lastFiredAt).toBe('2026-10-03T09:00:00.000Z')
  })

  it('refuses an unknown id', async () => {
    await writeSchedules(kbRoot, [schedule()])
    const failure = await ctx.yantaoKbController
      .scheduleMark({ id: 'sch_ghost', lastFiredAt: '2026-10-03T09:00:00.000Z' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })
})
