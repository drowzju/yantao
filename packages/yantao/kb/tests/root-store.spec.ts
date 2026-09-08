import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kbRootStatePath, readKbRootOverride, writeKbRootOverride } from '../src/root-store.ts'

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
})
