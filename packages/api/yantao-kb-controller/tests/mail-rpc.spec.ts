import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { writeKbRootOverride, type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import type { KbMailMessage } from '../src/types.ts'
import YantaoKbController from '../src/index.ts'

// Both mocks are read by `vi.mock` factories, which run before any top-level
// `let` is initialized — hence the hoisted holder.
const { state } = vi.hoisted(() => ({ state: { home: '', fetchMail: vi.fn() } }))
const fetchMail = state.fetchMail

// The watermark lives in dsh's home, which is the developer's real `~`; point
// `homedir()` at a throwaway directory so the suite never touches it.
let home: string

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => state.home,
}))

// `fetchMail` is the one part that would need Outlook; the rest of the
// connector — the watermark, the page cap, the failure wording — is ours.
vi.mock('../src/mail/fetch.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/mail/fetch.ts')>(),
  fetchMail: state.fetchMail,
}))

let ctx: Context
let fiber: { dispose(): Promise<void> }

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-mail-'))
  state.home = home
  fetchMail.mockReset()
  ctx = new Context()
  // `mailFetch` never touches the KB; the service is only there because the
  // controller activates on it.
  ctx.provide('yantaoKb', {
    get root(): string {
      return home
    },
    get configured(): boolean {
      return false
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  fiber = await ctx.plugin(YantaoKbController)
  // The mail cursor is persisted next to the KB root, so the connector needs
  // one to have been chosen.
  await writeKbRootOverride(join(home, '知识库'))
})

afterEach(async () => {
  await fiber.dispose()
  await rm(home, { recursive: true, force: true })
})

function mail(overrides: Partial<KbMailMessage> = {}): KbMailMessage {
  return {
    id: 'sha1',
    entryId: 'entry',
    receivedAt: '2026-09-01T02:03:04+00:00',
    senderName: '张三',
    senderAddress: 'zhangsan@example.com',
    subject: '季度汇报',
    body: '正文',
    truncated: false,
    ...overrides,
  }
}

describe('yantaoKb.mailFetch', () => {
  it('falls back to 30 days ago when the connector has never run', async () => {
    fetchMail.mockResolvedValue([])
    const result = await ctx.yantaoKbController.mailFetch({})
    expect(fetchMail).toHaveBeenCalledWith({ since: result.since, limit: 50 })
    // Roughly a month back: a first run must not walk a whole inbox.
    const days = (Date.now() - Date.parse(result.since)) / 86_400_000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThan(31)
    expect(result.stale).toBe(true)
    expect(result.lastReadAt).toBeUndefined()
    expect(result.hasMore).toBe(false)
  })

  it('continues from the watermark once there is one', async () => {
    await ctx.yantaoKbController.mailMarkRead({ lastReadAt: '2026-09-01T00:00:00.000Z' })
    fetchMail.mockResolvedValue([mail()])
    const result = await ctx.yantaoKbController.mailFetch({})
    expect(fetchMail).toHaveBeenCalledWith({ since: '2026-09-01T00:00:00.000Z', limit: 50 })
    expect(result.since).toBe('2026-09-01T00:00:00.000Z')
    expect(result.lastReadAt).toBe('2026-09-01T00:00:00.000Z')
    expect(result.stale).toBe(false)
    expect(result.messages).toHaveLength(1)
  })

  it('warns about a gap the watermark left behind', async () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString()
    await ctx.yantaoKbController.mailMarkRead({ lastReadAt: old })
    fetchMail.mockResolvedValue([])
    expect((await ctx.yantaoKbController.mailFetch({})).stale).toBe(true)
  })

  it('honours an explicit bound and cap, and reports a full page', async () => {
    fetchMail.mockResolvedValue(Array.from({ length: 2 }, () => mail()))
    const result = await ctx.yantaoKbController.mailFetch({ since: '2026-08-01T00:00:00', limit: 2 })
    expect(fetchMail).toHaveBeenCalledWith({ since: '2026-08-01T00:00:00', limit: 2 })
    expect(result.hasMore).toBe(true)
    fetchMail.mockResolvedValue([mail()])
    expect((await ctx.yantaoKbController.mailFetch({ limit: 2 })).hasMore).toBe(false)
  })

  it('refuses to run before a KB root has been chosen', async () => {
    const { rm } = await import('node:fs/promises')
    await rm(join(home, '.dsh'), { recursive: true, force: true })
    const failure = await ctx.yantaoKbController.mailFetch({}).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/mail', details: { kind: 'no-root' } })
    expect(fetchMail).not.toHaveBeenCalled()
  })

  it('rejects with the script\'s own message and remedy', async () => {
    const { MailFetchError } = await import('../src/mail/fetch.ts')
    fetchMail.mockRejectedValue(new MailFetchError('python-missing', '缺少 Python', '请安装 Python 3'))
    const failure = await ctx.yantaoKbController.mailFetch({}).catch((error: unknown) => error)
    const error = remoteErrorOf(failure)
    expect(error).toMatchObject({
      code: 'yantao-kb/mail',
      message: '缺少 Python',
      details: { kind: 'python-missing', hint: '请安装 Python 3' },
    })
  })
})

describe('yantaoKb.mailMarkRead', () => {
  it('stores the stamp it is given', async () => {
    expect(await ctx.yantaoKbController.mailMarkRead({ lastReadAt: '2026-09-09T10:00:00.000Z' }))
      .toEqual({ lastReadAt: '2026-09-09T10:00:00.000Z' })
    fetchMail.mockResolvedValue([])
    expect((await ctx.yantaoKbController.mailFetch({})).since).toBe('2026-09-09T10:00:00.000Z')
  })

  it('defaults the stamp to now', async () => {
    const { lastReadAt } = await ctx.yantaoKbController.mailMarkRead({})
    expect(Math.abs(Date.now() - Date.parse(lastReadAt))).toBeLessThan(60_000)
  })
})
