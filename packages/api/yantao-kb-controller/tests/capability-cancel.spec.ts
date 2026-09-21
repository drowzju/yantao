/**
 * `runCapability`'s cancel line (ADR-0031): an aborted signal kills the child
 * and rejects with the `cancelled` kind. The spawn is faked, so Python is
 * never touched — the fake child is a bare emitter trio plus a recorded kill.
 */
import { EventEmitter } from 'node:events'
import type { SpawnLike } from '../src/open.ts'
import { describe, expect, it, vi } from 'vitest'
import { runCapability } from '../src/capability/run.ts'

/** A fake child process: writable stdin, readable stdout/stderr, a recorded kill. */
function fakeChild(): EventEmitter & {
  stdin: EventEmitter & { end: (data: string, encoding: string) => void }
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => boolean
} {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { end: (data: string, encoding: string) => void }
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => boolean
  }
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  return child
}

/** The fake child behind a `SpawnLike`-typed spawn — the run only reads the streams and kill. */
function fakeSpawn(child: ReturnType<typeof fakeChild>): SpawnLike {
  return (() => child) as unknown as SpawnLike
}

const BASE = {
  name: 'mail',
  directory: '/tmp/mail',
  entryPath: '/tmp/mail/scripts/entry.py',
  kbRoot: '/tmp',
} as const

describe('runCapability cancellation (ADR-0031)', () => {
  it('kills the child and rejects with the cancelled kind when the signal aborts mid-run', async () => {
    const child = fakeChild()
    const controller = new AbortController()
    const promise = runCapability({ ...BASE, spawn: fakeSpawn(child), signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' })
    expect(child.kill).toHaveBeenCalled()
  })

  it('rejects immediately for an already-aborted signal', async () => {
    const child = fakeChild()
    const controller = new AbortController()
    controller.abort()
    await expect(runCapability({ ...BASE, spawn: fakeSpawn(child), signal: controller.signal }))
      .rejects.toMatchObject({ kind: 'cancelled' })
    expect(child.kill).toHaveBeenCalled()
  })

  it('leaves an uncancelled run alone', async () => {
    const child = fakeChild()
    const controller = new AbortController()
    const promise = runCapability({ ...BASE, spawn: fakeSpawn(child), signal: controller.signal })
    child.stdout.emit('data', Buffer.from('{"ok":true,"result":"done"}'))
    child.emit('close')
    await expect(promise).resolves.toEqual({ result: 'done' })
    expect(controller.signal.aborted).toBe(false)
    expect(child.kill).not.toHaveBeenCalled()
  })
})
