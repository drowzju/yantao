/**
 * Unit tests for the distilled run-log writer (run-log.ts).
 *
 * The write queue must be truly serial: `open()`'s truncating `writeFile`
 * queues ahead of every append, so a first event landing before the header
 * would otherwise be wiped (2026-10-13 review — the queue was chained off a
 * settled promise and never serialized). These tests pin the ordering
 * promise through `settled()`.
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pruneOrphanRunLogs, RunLogWriter } from '../src/workspace/run-log.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yantao-run-log-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('RunLogWriter', () => {
  it('lands the header before the first append — open does not clobber appends', async () => {
    const path = join(dir, 'nested', 'run.log')
    const log = new RunLogWriter(path)
    log.open('═══ 头一行 ═══')
    // Fired synchronously right after open(): with a broken queue the
    // truncating writeFile could land after this append and erase it.
    log.event({ type: 'assistant', message: { content: [{ type: 'text', text: '第一条' }] } })
    log.line('tail verdict')
    await log.settled()
    const text = await readFile(path, 'utf8')
    const headerAt = text.indexOf('═══ 头一行 ═══')
    const firstAt = text.indexOf('第一条')
    expect(headerAt).toBeGreaterThanOrEqual(0)
    expect(firstAt).toBeGreaterThan(headerAt)
    expect(text.indexOf('tail verdict')).toBeGreaterThan(firstAt)
  })

  it('keeps rapid appends in submission order', async () => {
    const path = join(dir, 'run.log')
    const log = new RunLogWriter(path)
    log.open('头')
    for (let i = 0; i < 50; i += 1) log.line(`line-${i}`)
    await log.settled()
    const text = await readFile(path, 'utf8')
    const positions = Array.from({ length: 50 }, (_, i) => text.indexOf(`line-${i}`))
    expect(positions.every((p, i) => i === 0 || p > positions[i - 1])).toBe(true)
  })

  it('marks the writer broken on a failed write and never throws into the caller', async () => {
    // A file occupies the log's parent slot, so the queued mkdir fails.
    const blocker = join(dir, 'blocking')
    await writeFile(blocker, 'x', 'utf8')
    const log = new RunLogWriter(join(blocker, 'run.log'))
    log.open('头')
    log.line('迟到的一行')
    await log.settled()
    expect(await readFile(blocker, 'utf8')).toBe('x')
  })
})

describe('pruneOrphanRunLogs', () => {
  it('deletes only the logs whose run id left the history ring', async () => {
    const kbRoot = dir
    const logDir = join(kbRoot, 'sessions', 'workspace')
    await mkdir(logDir, { recursive: true })
    await mkdir(join(kbRoot, '.dsh', 'yantao'), { recursive: true })
    await writeFile(join(kbRoot, '.dsh', 'yantao', 'workspace-runs.json'), JSON.stringify({
      version: 1,
      runs: [{
        id: 'run_keep', workspaceId: 'ws_1', instructionId: 'ins_1', instructionName: '周报', trigger: 'manual',
        status: 'success', startedAt: '2026-10-14T00:00:00.000Z', finishedAt: '2026-10-14T00:01:00.000Z',
      }],
    }), 'utf8')
    await writeFile(join(logDir, 'run_keep.log'), '留下', 'utf8')
    await writeFile(join(logDir, 'run_stray.log'), '孤儿', 'utf8')
    await writeFile(join(logDir, 'notes.txt'), '非日志', 'utf8')

    await pruneOrphanRunLogs(kbRoot)

    const remaining = await readdir(logDir)
    expect(remaining.sort()).toEqual(['notes.txt', 'run_keep.log'])
  })

  it('resolves without throwing when the log directory is absent', async () => {
    await expect(pruneOrphanRunLogs(join(dir, '没有 sessions 的根'))).resolves.toBeUndefined()
  })
})
