import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

/** The version the seeded copy declares, for writing older/newer seeded copies. */
async function seededVersion(name: string): Promise<number> {
  const sidecar = await readFile(join(kbRoot, '.dsh', 'skills', name, 'yantao.json'), 'utf8')
  return (JSON.parse(sidecar) as { version?: number }).version ?? 0
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
    // A seeded copy from an older ship: version 0 has no declaration at all.
    const target = join(kbRoot, '.dsh', 'skills', 'mail')
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '---\nname: mail\ndescription: 旧版\n---\n', 'utf8')
    expect(ensureBuiltinCapabilities(kbRoot)).toContain('mail')
    expect(await seededVersion('mail')).toBe(3)
    expect(await readFile(join(target, 'scripts', 'entry.py'), 'utf8')).toMatch(/json\.load/)
  })

  it('overwrites a legacy frontmatter-declared copy whose version is older than the sidecar\'s', async () => {
    ensureBuiltinCapabilities(kbRoot)
    // A seeded copy from before the sidecar: the version lives in SKILL.md.
    const target = join(kbRoot, '.dsh', 'skills', 'mail')
    const skillMd = await readFile(join(target, 'SKILL.md'), 'utf8')
    await rm(join(target, 'yantao.json'), { force: true })
    await writeFile(join(target, 'SKILL.md'), `${skillMd}version: 1\n`, 'utf8')
    expect(ensureBuiltinCapabilities(kbRoot)).toContain('mail')
    expect(await seededVersion('mail')).toBe(3)
  })

  it('leaves a newer human-edited copy alone even when the master changes', async () => {
    ensureBuiltinCapabilities(kbRoot)
    const target = join(kbRoot, '.dsh', 'skills', 'mail')
    // The human bumped their own copy past the shipped version.
    const sidecar = await readFile(join(target, 'yantao.json'), 'utf8')
    await writeFile(join(target, 'yantao.json'), sidecar.replace('"version": 3', '"version": 9'), 'utf8')
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

  it('backs up a drifted copy before a version bump overwrites it', async () => {
    ensureBuiltinCapabilities(kbRoot)
    const target = join(kbRoot, '.dsh', 'skills', 'mail')
    // The human edited their copy but did not bump the version: the next
    // versioned master (3) wins over their older copy (2), and the hand edit
    // survives in the backup.
    await writeFile(join(target, 'SKILL.md'), '---\nname: mail\ndescription: 人改过的版本\n---\n', 'utf8')
    const sidecar = await readFile(join(target, 'yantao.json'), 'utf8')
    await writeFile(join(target, 'yantao.json'), sidecar.replace('"version": 3', '"version": 2'), 'utf8')
    expect(ensureBuiltinCapabilities(kbRoot)).toContain('mail')
    const backups = await readdir(join(kbRoot, '.yantao', 'capability-backups', 'mail'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(kbRoot, '.yantao', 'capability-backups', 'mail', backups[0]!, 'SKILL.md'), 'utf8'))
      .toMatch(/人改过的版本/)
    // The live copy is the master's again.
    expect(await seededVersion('mail')).toBe(3)
  })

  it('backupIfDrifted copies a drifted tree and skips an identical one', async () => {
    const { backupIfDrifted } = await import('../src/capability/builtin.ts')
    const { cp } = await import('node:fs/promises')
    const master = join(kbRoot, 'master')
    const target = join(kbRoot, 'target')
    await mkdir(join(master, 'scripts'), { recursive: true })
    await writeFile(join(master, 'SKILL.md'), 'same', 'utf8')
    await writeFile(join(master, 'scripts', 'entry.py'), 'print(1)', 'utf8')
    await cp(master, target, { recursive: true })
    backupIfDrifted(kbRoot, 'cap', target, master)
    await expect(readdir(join(kbRoot, '.yantao', 'capability-backups', 'cap'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(join(target, 'SKILL.md'), '人改过', 'utf8')
    backupIfDrifted(kbRoot, 'cap', target, master)
    const backups = await readdir(join(kbRoot, '.yantao', 'capability-backups', 'cap'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(kbRoot, '.yantao', 'capability-backups', 'cap', backups[0]!, 'SKILL.md'), 'utf8'))
      .toBe('人改过')
  })
})
