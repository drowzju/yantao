import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureBuiltinCapabilities } from '../src/capability/builtin.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-builtin-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** The version line the master SKILL.md carries, for writing older/newer seeded copies. */
async function seededVersion(name: string): Promise<number> {
  const skillMd = await readFile(join(kbRoot, '.dsh', 'skills', name, 'SKILL.md'), 'utf8')
  return Number(/version:\s*(\d+)/.exec(skillMd)?.[1] ?? 0)
}

describe('ensureBuiltinCapabilities', () => {
  it('seeds the shipped capabilities into a fresh KB', () => {
    expect(ensureBuiltinCapabilities(kbRoot)).toEqual(expect.arrayContaining(['mail', 'ebook']))
  })

  it('answers empty and leaves the human\'s copy alone once it is up to date', () => {
    ensureBuiltinCapabilities(kbRoot)
    // Touch the seeded copy so a re-seed would be observable.
    const target = join(kbRoot, '.dsh', 'skills', 'mail', 'SKILL.md')
    return readFile(target, 'utf8').then(async (content) => {
      ensureBuiltinCapabilities(kbRoot)
      expect(await readFile(target, 'utf8')).toBe(content)
      expect(ensureBuiltinCapabilities(kbRoot)).toEqual([])
    })
  })

  it('overwrites an older seeded copy when the master is newer', async () => {
    ensureBuiltinCapabilities(kbRoot)
    // A seeded copy from an older ship: version 0 has no version line at all.
    const target = join(kbRoot, '.dsh', 'skills', 'mail')
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '---\nname: mail\ndescription: 旧版\n---\n', 'utf8')
    expect(ensureBuiltinCapabilities(kbRoot)).toContain('mail')
    expect(await seededVersion('mail')).toBe(1)
    expect(await readFile(join(target, 'scripts', 'entry.py'), 'utf8')).toMatch(/json\.load/)
  })

  it('leaves a newer human-edited copy alone even when the master changes', async () => {
    ensureBuiltinCapabilities(kbRoot)
    const target = join(kbRoot, '.dsh', 'skills', 'mail')
    // The human bumped their own copy past the shipped version.
    const skillMd = await readFile(join(target, 'SKILL.md'), 'utf8')
    await writeFile(join(target, 'SKILL.md'), skillMd.replace('version: 1', 'version: 9'), 'utf8')
    expect(ensureBuiltinCapabilities(kbRoot)).toEqual([])
    expect(await seededVersion('mail')).toBe(9)
  })

  it('copies the whole directory, scripts included', async () => {
    ensureBuiltinCapabilities(kbRoot)
    expect(await readFile(join(kbRoot, '.dsh', 'skills', 'ebook', 'scripts', 'extract.py'), 'utf8'))
      .toMatch(/def extract_document/)
  })

  it('tolerates a KB root it cannot write to, answering what it managed', async () => {
    // A file where the skills directory should be makes every copy fail; the
    // failure belongs to the run that needs the capability, not to seeding.
    await writeFile(join(kbRoot, '.dsh'), 'not a directory', 'utf8')
    expect(ensureBuiltinCapabilities(kbRoot)).toEqual([])
  })
})
