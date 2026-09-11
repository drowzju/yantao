import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { SpawnLike } from '../src/open.ts'
import { EXTRACT_HINTS, extractArgs, extractText, ExtractError } from '../src/extract/index.ts'

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

async function failureOf(run: Promise<unknown>): Promise<ExtractError> {
  return await run.catch((error: unknown) => error) as ExtractError
}

describe('extract.extractText happy path', () => {
  it('parses the JSON object the script prints', async () => {
    const payload = JSON.stringify({ text: '第一章\n正文', meta: { format: 'pdf', chars: 6 } })
    const result = await extractText({ format: 'pdf', input: 'D:/kb/resources/三体.pdf', spawn: stdoutSpawn(payload) })
    expect(result.text).toBe('第一章\n正文')
    expect(result.meta).toEqual({ format: 'pdf', chars: 6 })
  })

  it('accepts an empty text (an empty txt extracts to nothing)', async () => {
    const payload = JSON.stringify({ text: '', meta: { format: 'txt', chars: 0 } })
    const result = await extractText({ format: 'txt', input: 'D:/kb/resources/空.txt', spawn: stdoutSpawn(payload) })
    expect(result.text).toBe('')
    expect(result.meta.chars).toBe(0)
  })
})

describe('extract.extractText failures', () => {
  it('maps a stderr kind to its classified error, message and hint', async () => {
    const error = await failureOf(extractText({
      format: 'pdf',
      input: 'D:/kb/resources/扫描版.pdf',
      spawn: stderrSpawn(5, JSON.stringify({ error: '没有文字层', kind: 'no-text' })),
    }))
    expect(error).toBeInstanceOf(ExtractError)
    expect(error.kind).toBe('no-text')
    expect(error.message).toMatch(/文字层/)
    expect(error.hint).toBe(EXTRACT_HINTS['no-text'])
  })

  it('maps exit 4 to lib-missing and names the pip install in the hint', async () => {
    const error = await failureOf(extractText({
      format: 'docx',
      input: 'D:/kb/resources/报告.docx',
      spawn: stderrSpawn(4, JSON.stringify({ error: '缺少 python-docx', kind: 'lib-missing' })),
    }))
    expect(error.kind).toBe('lib-missing')
    expect(error.hint).toMatch(/pip install/)
  })

  it('maps a missing interpreter (ENOENT) to python-missing', async () => {
    const { spawn } = fakeSpawn((child) => {
      const error = new Error('spawn python ENOENT') as Error & { code: string }
      error.code = 'ENOENT'
      child.emit('error', error)
    })
    const error = await failureOf(extractText({ format: 'pdf', input: 'x.pdf', spawn }))
    expect(error.kind).toBe('python-missing')
  })

  it('maps garbage on stdout to bad-output', async () => {
    for (const payload of ['not json at all', '{"no":"text here"}', '{"text":123}', '{"text":"x","meta":null}']) {
      const error = await failureOf(extractText({ format: 'pdf', input: 'x.pdf', spawn: stdoutSpawn(payload) }))
      expect(error.kind, payload).toBe('bad-output')
    }
  })

  it('maps a non-zero exit with unreadable stderr to other', async () => {
    const error = await failureOf(extractText({
      format: 'epub',
      input: 'x.epub',
      spawn: stderrSpawn(8, 'Traceback (most recent call last): …'),
    }))
    expect(error.kind).toBe('other')
  })

  it('kills the script and reports timeout when it never finishes', async () => {
    const { spawn, child } = fakeSpawn(() => {
      // Never closes: the timer is the only thing that can end this run.
    })
    const error = await failureOf(extractText({ format: 'pdf', input: 'x.pdf', spawn, timeoutMs: 10 }))
    expect(error.kind).toBe('timeout')
    expect(child.kill).toHaveBeenCalled()
  })
})

describe('extract.extractArgs', () => {
  it('passes the script, the format and the input', () => {
    const args = extractArgs('pdf', 'D:/kb/resources/三体.pdf')
    expect(args.at(-5)?.endsWith('extract.py')).toBe(true)
    expect(args.at(-4)).toBe('--format')
    expect(args.at(-3)).toBe('pdf')
    expect(args.at(-2)).toBe('--input')
    expect(args.at(-1)).toBe('D:/kb/resources/三体.pdf')
  })
})
