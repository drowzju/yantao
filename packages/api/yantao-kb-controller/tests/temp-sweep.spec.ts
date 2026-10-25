/**
 * Unit tests for the age-based scratch sweep (temp-sweep.ts).
 *
 * The sweep is the missing half of a promise the capability environment note
 * has made since 2026-10-09 ("用完即弃，无人清理"): nothing cleaned it, and
 * resources/temp/ reached 23MB by 2026-10-25. These tests pin the two
 * properties that make it safe to run at boot — it only removes old entries,
 * and it never escalates a failure into the caller.
 */
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sweepTempDir, TEMP_SWEEP_MAX_AGE_MS } from '../src/temp-sweep.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yantao-temp-sweep-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sweepTempDir', () => {
  it('removes stale entries and keeps young ones', async () => {
    const stale = join(dir, 'weekly-20261001')
    const fresh = join(dir, 'weekly-20261020')
    await mkdir(stale, { recursive: true })
    await mkdir(fresh, { recursive: true })
    await writeFile(join(stale, '02-delta.md'), 'old', 'utf8')
    await writeFile(join(fresh, '02-delta.md'), 'new', 'utf8')

    const now = Date.now()
    const old = new Date(now - TEMP_SWEEP_MAX_AGE_MS - 60_000)
    await utimes(stale, old, old)

    const result = await sweepTempDir(dir, TEMP_SWEEP_MAX_AGE_MS, now)

    expect(result.removed).toEqual(['weekly-20261001'])
    expect(result.kept).toEqual(['weekly-20261020'])
  })

  it('treats a missing temp root as an empty sweep, not an error', async () => {
    const result = await sweepTempDir(join(dir, 'nope'))
    expect(result).toEqual({ removed: [], kept: [] })
  })

  it('removes stale plain files too, not just directories', async () => {
    const stale = join(dir, 'probe.json')
    await writeFile(stale, '{}', 'utf8')
    const now = Date.now()
    const old = new Date(now - TEMP_SWEEP_MAX_AGE_MS - 60_000)
    await utimes(stale, old, old)

    const result = await sweepTempDir(dir, TEMP_SWEEP_MAX_AGE_MS, now)

    expect(result.removed).toEqual(['probe.json'])
  })
})
