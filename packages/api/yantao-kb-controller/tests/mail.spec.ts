import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { SpawnLike } from '../src/open.ts'
import { fetchMail, MailFetchError, mailArgs } from '../src/mail/fetch.ts'

// A stand-in child: stdout/stderr are emitters the test fills, and `close`
// ends the run the way a real process would.
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly kill = vi.fn()
}

type Behavior = (child: FakeChild) => void

/** A spawn that hands the test the child so it can drive the run. */
function fakeSpawn(behavior: Behavior): { spawn: SpawnLike; child: FakeChild } {
  const child = new FakeChild()
  const spawn = (() => {
    // Defer: the caller must be able to subscribe before we start emitting.
    queueMicrotask(() => {
      behavior(child)
    })
    return child
  }) as unknown as SpawnLike
  return { spawn, child }
}

/** A spawn whose process succeeds with `payload` on stdout. */
function stdoutSpawn(payload: string): SpawnLike {
  return fakeSpawn((child) => {
    child.stdout.emit('data', payload)
    child.emit('close', 0)
  }).spawn
}

/** A spawn whose process fails with `code` and `payload` on stderr. */
function stderrSpawn(code: number, payload: string): SpawnLike {
  return fakeSpawn((child) => {
    child.stderr.emit('data', payload)
    child.emit('close', code)
  }).spawn
}

const MAIL = {
  id: 'a'.repeat(40),
  entryId: '00000000ABCD',
  receivedAt: '2026-09-01T02:03:04+00:00',
  senderName: '张三',
  senderAddress: 'zhang.san@example.com',
  subject: '周报',
  body: '本周进展…',
  truncated: false,
}

async function failureOf(run: Promise<unknown>): Promise<MailFetchError> {
  return await run.catch((error: unknown) => error) as MailFetchError
}

describe('mail.fetchMail happy path', () => {
  it('parses the JSON array the script prints', async () => {
    const mails = await fetchMail({ since: '2026-08-01T00:00:00', spawn: stdoutSpawn(JSON.stringify([MAIL])) })
    expect(mails).toHaveLength(1)
    expect(mails[0]).toEqual(MAIL)
  })

  it('keeps every field, including a truncated body', async () => {
    const truncated = { ...MAIL, body: 'x'.repeat(3000), truncated: true }
    const mails = await fetchMail({ since: '2026-08-01T00:00:00', spawn: stdoutSpawn(JSON.stringify([truncated])) })
    expect(mails[0]?.truncated).toBe(true)
    expect(mails[0]?.body).toHaveLength(3000)
    expect(mails[0]?.senderName).toBe('张三')
    expect(mails[0]?.receivedAt).toBe('2026-09-01T02:03:04+00:00')
  })

  it('returns an empty array when nothing matched', async () => {
    const mails = await fetchMail({ since: '2026-08-01T00:00:00', spawn: stdoutSpawn('[]') })
    expect(mails).toEqual([])
  })
})

describe('mail.fetchMail failures', () => {
  it('maps exit 3 to outlook-unavailable', async () => {
    const error = await failureOf(fetchMail({
      since: '2026-08-01T00:00:00',
      spawn: stderrSpawn(3, JSON.stringify({ error: '无法连接 Outlook', kind: 'outlook-unavailable' })),
    }))
    expect(error).toBeInstanceOf(MailFetchError)
    expect(error.kind).toBe('outlook-unavailable')
    expect(error.message).toMatch(/Outlook/)
    expect(error.hint).not.toBe('')
  })

  it('maps exit 4 to python-missing and carries the install hint', async () => {
    const error = await failureOf(fetchMail({
      since: '2026-08-01T00:00:00',
      spawn: stderrSpawn(4, JSON.stringify({ error: '缺少 pywin32', kind: 'python-missing' })),
    }))
    expect(error.kind).toBe('python-missing')
    expect(error.hint).toMatch(/pywin32/)
    // The architecture trap is the one humans hit, so the hint must name it.
    expect(error.hint).toMatch(/位数/)
  })

  it('maps exit 5 to folder-missing', async () => {
    const error = await failureOf(fetchMail({
      since: '2026-08-01T00:00:00',
      spawn: stderrSpawn(5, JSON.stringify({ error: '找不到文件夹', kind: 'folder-missing' })),
    }))
    expect(error.kind).toBe('folder-missing')
  })

  it('maps a missing interpreter (ENOENT) to python-missing', async () => {
    const spawn = fakeSpawn((child) => {
      const error = new Error('spawn python ENOENT') as Error & { code: string }
      error.code = 'ENOENT'
      child.emit('error', error)
    }).spawn
    const error = await failureOf(fetchMail({ since: '2026-08-01T00:00:00', spawn }))
    expect(error.kind).toBe('python-missing')
  })

  it('maps garbage on stdout to bad-output', async () => {
    for (const payload of ['not json at all', '{"not":"an array"}', '']) {
      const error = await failureOf(fetchMail({ since: '2026-08-01T00:00:00', spawn: stdoutSpawn(payload) }))
      expect(error.kind, payload).toBe('bad-output')
    }
  })

  it('maps a non-zero exit with unreadable stderr to other', async () => {
    const error = await failureOf(fetchMail({
      since: '2026-08-01T00:00:00',
      spawn: stderrSpawn(6, 'Traceback (most recent call last): …'),
    }))
    expect(error.kind).toBe('other')
  })

  it('kills the script and reports timeout when it never finishes', async () => {
    const { spawn, child } = fakeSpawn(() => {
      // Never closes: the timer is the only thing that can end this run.
    })
    const error = await failureOf(fetchMail({ since: '2026-08-01T00:00:00', spawn, timeoutMs: 10 }))
    expect(error.kind).toBe('timeout')
    expect(child.kill).toHaveBeenCalled()
  })
})

describe('mail.mailArgs', () => {
  it('passes the script, the bound, the cap and --json', () => {
    const args = mailArgs({ since: '2026-08-11T00:00:00' })
    expect(args.at(-1)).toBe('--json')
    expect(args).toContain('--since')
    expect(args[args.indexOf('--since') + 1]).toBe('2026-08-11T00:00:00')
    expect(args[args.indexOf('--limit') + 1]).toBe('50')
  })

  it('forwards an explicit limit and folder', () => {
    const args = mailArgs({ since: '2026-08-11T00:00:00', limit: 3, folder: '已发送邮件' })
    expect(args[args.indexOf('--limit') + 1]).toBe('3')
    expect(args[args.indexOf('--folder') + 1]).toBe('已发送邮件')
  })
})
