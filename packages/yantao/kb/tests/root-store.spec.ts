import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  capabilityStatePath,
  importLegacyRootState,
  readCapabilityRecord,
  readCapabilityState,
  writeCapabilityState,
  writeMailWatermark,
} from '../src/root-store.ts'

// The retired legacy file lives under dsh's home, which is the developer's
// real `~`; point `homedir()` at a throwaway directory so the suite never
// touches it.
let home: string

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => home,
}))

let kbRoot: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-home-'))
  kbRoot = join(home, '知识库')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('capabilityStatePath', () => {
  it('is the one state file inside the KB (ADR-0024)', () => {
    expect(capabilityStatePath(kbRoot)).toBe(join(kbRoot, '.yantao', 'state.json'))
  })
})

describe('readCapabilityState / writeCapabilityState', () => {
  it('is undefined before anything is persisted', () => {
    expect(readCapabilityState(kbRoot, 'mail')).toBeUndefined()
    expect(readCapabilityRecord(kbRoot, 'mail')).toBeUndefined()
  })

  it('is undefined for a malformed state file', async () => {
    await mkdir(join(kbRoot, '.yantao'), { recursive: true })
    for (const broken of ['{ not json', 'null', '42', '[]']) {
      await writeFile(capabilityStatePath(kbRoot), broken, 'utf8')
      expect(readCapabilityState(kbRoot, 'mail')).toBeUndefined()
    }
  })

  it('round-trips the state and stamps the run', async () => {
    await writeCapabilityState(kbRoot, 'mail', { lastReadAt: '2026-09-10T08:30:00.000Z' })
    expect(readCapabilityState(kbRoot, 'mail')).toEqual({ lastReadAt: '2026-09-10T08:30:00.000Z' })
    const persisted = JSON.parse(await readFile(capabilityStatePath(kbRoot), 'utf8')) as {
      capabilities: { mail: { state: unknown; lastRunAt: string } }
    }
    expect(persisted.capabilities.mail.state).toEqual({ lastReadAt: '2026-09-10T08:30:00.000Z' })
    expect(typeof persisted.capabilities.mail.lastRunAt).toBe('string')
  })

  it('keeps every other capability as it was', async () => {
    await writeCapabilityState(kbRoot, 'mail', { a: 1 })
    await writeCapabilityState(kbRoot, 'extractor', { b: 2 })
    expect(readCapabilityState(kbRoot, 'mail')).toEqual({ a: 1 })
    expect(readCapabilityState(kbRoot, 'extractor')).toEqual({ b: 2 })
  })

  it('answers the whole record for the capability list', async () => {
    await writeCapabilityState(kbRoot, 'mail', { lastReadAt: '2026-09-10T08:30:00.000Z' })
    const record = readCapabilityRecord(kbRoot, 'mail')
    expect(record?.state).toEqual({ lastReadAt: '2026-09-10T08:30:00.000Z' })
    expect(typeof record?.lastRunAt).toBe('string')
  })
})

describe('writeMailWatermark', () => {
  it('round-trips and answers the merged range', async () => {
    expect(await writeMailWatermark(kbRoot, '2026-01-31T00:00:00.000Z', '2025-12-31T00:00:00.000Z'))
      .toEqual({ lastReadAt: '2026-01-31T00:00:00.000Z', firstReadAt: '2025-12-31T00:00:00.000Z' })

    // A later batch that starts earlier extends the range backward…
    await writeMailWatermark(kbRoot, '2026-09-11T09:00:00.000Z', '2026-08-01T00:00:00.000Z')
    // …and one that does not name a start leaves the minimum alone.
    await writeMailWatermark(kbRoot, '2026-09-12T10:00:00.000Z')

    expect(readCapabilityState(kbRoot, 'mail')).toEqual({
      lastReadAt: '2026-09-12T10:00:00.000Z',
      firstReadAt: '2025-12-31T00:00:00.000Z',
    })
  })

  it('keeps every other capability as it was', async () => {
    await writeCapabilityState(kbRoot, 'extractor', { b: 2 })
    await writeMailWatermark(kbRoot, '2026-09-10T08:30:00.000Z')
    expect(readCapabilityState(kbRoot, 'extractor')).toEqual({ b: 2 })
  })
})

describe('importLegacyRootState', () => {
  const legacyPath = () => join(home, '.dsh', 'yantao-kb.json')

  it('does nothing when the legacy file is absent', () => {
    expect(importLegacyRootState()).toBeUndefined()
    expect(existsSync(capabilityStatePath(kbRoot))).toBe(false)
  })

  it('moves the capability states into the KB and renames the legacy file .bak', async () => {
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(legacyPath(), JSON.stringify({
      root: kbRoot,
      capabilities: { mail: { state: { lastReadAt: '2026-09-10T08:30:00.000Z' }, lastRunAt: '2026-09-10T08:30:01.000Z' } },
    }), 'utf8')

    expect(importLegacyRootState()).toBe(kbRoot)
    expect(readCapabilityRecord(kbRoot, 'mail')).toEqual({
      state: { lastReadAt: '2026-09-10T08:30:00.000Z' },
      lastRunAt: '2026-09-10T08:30:01.000Z',
    })
    expect(existsSync(legacyPath())).toBe(false)
    expect(existsSync(`${legacyPath()}.bak`)).toBe(true)
  })

  it('drops the legacy connectors.mail watermark (ADR-0024 决定 2)', async () => {
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(legacyPath(), JSON.stringify({
      root: kbRoot,
      connectors: { mail: { lastReadAt: '2026-09-10T08:30:00.000Z' } },
    }), 'utf8')

    expect(importLegacyRootState()).toBe(kbRoot)
    expect(readCapabilityRecord(kbRoot, 'mail')).toBeUndefined()
  })

  it('leaves an existing state file untouched and still retires the legacy file', async () => {
    await mkdir(join(kbRoot, '.yantao'), { recursive: true })
    await writeFile(capabilityStatePath(kbRoot), JSON.stringify({ capabilities: {} }), 'utf8')
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(legacyPath(), JSON.stringify({
      root: kbRoot,
      capabilities: { mail: { state: { stale: true } } },
    }), 'utf8')

    expect(importLegacyRootState()).toBe(kbRoot)
    expect(readCapabilityState(kbRoot, 'mail')).toBeUndefined()
    expect(existsSync(`${legacyPath()}.bak`)).toBe(true)
  })

  it('leaves a malformed or rootless legacy file alone', async () => {
    await mkdir(join(home, '.dsh'), { recursive: true })
    for (const broken of ['{ not json', 'null', '42', '{"root":42}', '{"root":""}', '{"capabilities":{}}']) {
      await writeFile(legacyPath(), broken, 'utf8')
      expect(importLegacyRootState()).toBeUndefined()
      expect(existsSync(legacyPath())).toBe(true)
    }
  })
})
