import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { writeKbRootOverride, type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

// The watermark lives in dsh's home, which is the developer's real `~`; point
// `homedir()` at a throwaway directory so the suite never touches it.
const { state } = vi.hoisted(() => ({ state: { home: '' } }))

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => state.home,
}))

let home: string
let ctx: Context
let fiber: { dispose(): Promise<void> }

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-mail-'))
  state.home = home
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return home
    },
    get configured(): boolean {
      return false
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  // The controller also injects the skill registry (ADR-0021); the watermark
  // write never resolves a capability, so an empty stand-in is enough.
  ctx.provide('skills', { get: async () => undefined, list: async () => [] } as never)
  fiber = await ctx.plugin(YantaoKbController)
  // The mail cursor is persisted next to the KB root, so marking read needs
  // one to have been chosen.
  await writeKbRootOverride(join(home, '知识库'))
})

afterEach(async () => {
  await fiber.dispose()
  await rm(home, { recursive: true, force: true })
})

describe('yantaoKb.mailMarkRead', () => {
  it('stores the stamp it is given', async () => {
    expect(await ctx.yantaoKbController.mailMarkRead({ lastReadAt: '2026-09-09T10:00:00.000Z' }))
      .toEqual({ lastReadAt: '2026-09-09T10:00:00.000Z' })
  })

  it('answers the merged range when a firstReadAt is named', async () => {
    expect(await ctx.yantaoKbController.mailMarkRead({
      lastReadAt: '2026-01-31T00:00:00.000Z',
      firstReadAt: '2025-12-31T00:00:00.000Z',
    })).toEqual({ lastReadAt: '2026-01-31T00:00:00.000Z', firstReadAt: '2025-12-31T00:00:00.000Z' })
    // A later batch keeps the earliest start and moves the end.
    expect(await ctx.yantaoKbController.mailMarkRead({
      lastReadAt: '2026-09-11T09:00:00.000Z',
      firstReadAt: '2026-08-01T00:00:00.000Z',
    })).toEqual({ lastReadAt: '2026-09-11T09:00:00.000Z', firstReadAt: '2025-12-31T00:00:00.000Z' })
  })

  it('defaults the stamp to now', async () => {
    const { lastReadAt } = await ctx.yantaoKbController.mailMarkRead({})
    expect(Math.abs(Date.now() - Date.parse(lastReadAt))).toBeLessThan(60_000)
  })

  it('refuses to run before a KB root has been chosen', async () => {
    const { rm } = await import('node:fs/promises')
    await rm(join(home, '.dsh'), { recursive: true, force: true })
    const failure = await ctx.yantaoKbController.mailMarkRead({}).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/mail', details: { kind: 'no-root' } })
  })
})
