import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  kbRootStatePath,
  readKbRootOverride,
  readMailWatermark,
  writeKbRootOverride,
  writeMailWatermark,
} from '../src/root-store.ts'

// The store addresses dsh's home, which is the developer's real `~`; point
// `homedir()` at a throwaway directory so the suite never touches it.
let home: string

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => home,
}))

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('kbRootStatePath', () => {
  it('is the one state file under dsh home', () => {
    expect(kbRootStatePath()).toBe(join(home, '.dsh', 'yantao-kb.json'))
  })
})

describe('readKbRootOverride', () => {
  it('is undefined before anything is persisted', () => {
    expect(readKbRootOverride()).toBeUndefined()
  })

  it('reads back the root writeKbRootOverride persisted', async () => {
    const root = join(home, '知识库')
    await writeKbRootOverride(root)
    expect(readKbRootOverride()).toBe(root)
    expect(JSON.parse(await readFile(kbRootStatePath(), 'utf8'))).toEqual({ root })
  })

  it('is undefined for every malformed or wrong-typed state file', async () => {
    await mkdir(join(home, '.dsh'), { recursive: true })
    for (const broken of ['{ not json', 'null', '42', '[]', '{"root":42}', '{"root":""}']) {
      await writeFile(kbRootStatePath(), broken, 'utf8')
      expect(readKbRootOverride()).toBeUndefined()
    }
  })

  it('reads the root out of an old file that holds nothing but it', async () => {
    // Every install before ADR-0019 has exactly this shape.
    const root = join(home, '知识库')
    await mkdir(join(home, '.dsh'), { recursive: true })
    await writeFile(kbRootStatePath(), JSON.stringify({ root }), 'utf8')

    expect(readKbRootOverride()).toBe(root)
    expect(readMailWatermark()).toBeUndefined()
  })
})

describe('writeKbRootOverride', () => {
  it('keeps a mail watermark that is already persisted', async () => {
    await writeKbRootOverride(join(home, 'first'))
    await writeMailWatermark('2026-09-10T08:30:00.000Z')

    await writeKbRootOverride(join(home, 'second'))

    expect(readKbRootOverride()).toBe(join(home, 'second'))
    expect(readMailWatermark()).toBe('2026-09-10T08:30:00.000Z')
  })
})

describe('readMailWatermark', () => {
  it('is undefined before anything is persisted', () => {
    expect(readMailWatermark()).toBeUndefined()
  })

  it('is undefined for every malformed or wrong-typed state file', async () => {
    await mkdir(join(home, '.dsh'), { recursive: true })
    for (const broken of [
      '{ not json',
      'null',
      '[]',
      '{"root":"/kb"}',
      '{"root":"/kb","connectors":42}',
      '{"root":"/kb","connectors":{"mail":42}}',
      '{"root":"/kb","connectors":{"mail":{"lastReadAt":42}}}',
      '{"root":"/kb","connectors":{"mail":{"lastReadAt":""}}}',
      '{"connectors":{"mail":{"lastReadAt":"2026-09-10T08:30:00.000Z"}}}',
    ]) {
      await writeFile(kbRootStatePath(), broken, 'utf8')
      expect(readMailWatermark()).toBeUndefined()
    }
  })

  it('round-trips through writeMailWatermark', async () => {
    await writeKbRootOverride(join(home, '知识库'))
    await writeMailWatermark('2026-09-10T08:30:00.000Z')

    expect(readMailWatermark()).toBe('2026-09-10T08:30:00.000Z')
    expect(JSON.parse(await readFile(kbRootStatePath(), 'utf8'))).toEqual({
      root: join(home, '知识库'),
      connectors: { mail: { lastReadAt: '2026-09-10T08:30:00.000Z' } },
    })
  })

  it('moves forward on the next run', async () => {
    await writeKbRootOverride(join(home, '知识库'))
    await writeMailWatermark('2026-09-10T08:30:00.000Z')
    await writeMailWatermark('2026-09-11T09:00:00.000Z')

    expect(readMailWatermark()).toBe('2026-09-11T09:00:00.000Z')
  })
})

describe('writeMailWatermark', () => {
  it('refuses to persist a watermark with no KB root to bind it to', async () => {
    await expect(writeMailWatermark('2026-09-10T08:30:00.000Z')).rejects.toThrow(/KB root/)
    expect(existsSync(kbRootStatePath())).toBe(false)
  })
})
