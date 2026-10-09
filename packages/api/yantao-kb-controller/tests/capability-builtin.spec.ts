import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureBuiltinCapabilities, seedBuiltinRoutes } from '../src/capability/builtin.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-builtin-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** The version a SKILL.md frontmatter declares (ADR-0052 决定 6), 0 when absent. */
function declaredVersion(skillMd: string): number {
  const match = /version:\s*(\d+)/.exec(skillMd)
  return match === null ? 0 : Number(match[1])
}

/** The version the seeded copy declares, for writing older/newer seeded copies. */
async function seededVersion(name: string): Promise<number> {
  const skillMd = await readFile(join(kbRoot, '.dsh', 'skills', name, 'SKILL.md'), 'utf8')
  return declaredVersion(skillMd)
}

/** The version the shipped master declares, so this spec survives version bumps. */
async function masterVersion(name: string): Promise<number> {
  const skillMd = await readFile(join(import.meta.dirname, '..', 'src', 'capability', 'builtin', name, 'SKILL.md'), 'utf8')
  return declaredVersion(skillMd)
}

describe('ensureBuiltinCapabilities', () => {
  it('seeds the shipped capabilities into a fresh KB', () => {
    expect(ensureBuiltinCapabilities(kbRoot)).toEqual(expect.arrayContaining(['mail']))
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
    // A seeded copy from an older ship: no version in the frontmatter counts as 0.
    const target = join(kbRoot, '.dsh', 'skills', 'mail')
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '---\nname: mail\ndescription: 旧版\n---\n', 'utf8')
    expect(ensureBuiltinCapabilities(kbRoot)).toContain('mail')
    expect(await seededVersion('mail')).toBe(await masterVersion('mail'))
    expect(await readFile(join(target, 'scripts', 'entry.py'), 'utf8')).toMatch(/json\.load/)
  })

  it('leaves a newer human-edited copy alone even when the master changes', async () => {
    ensureBuiltinCapabilities(kbRoot)
    const target = join(kbRoot, '.dsh', 'skills', 'mail')
    // The human bumped their own copy's frontmatter version past the shipped one.
    const shipped = await masterVersion('mail')
    const skillMd = await readFile(join(target, 'SKILL.md'), 'utf8')
    await writeFile(join(target, 'SKILL.md'), skillMd.replace(`version: ${shipped}`, `version: ${shipped + 5}`), 'utf8')
    expect(ensureBuiltinCapabilities(kbRoot)).toEqual([])
    expect(await seededVersion('mail')).toBe(shipped + 5)
  })

  it('copies the whole directory, scripts included', async () => {
    ensureBuiltinCapabilities(kbRoot)
    expect(await readFile(join(kbRoot, '.dsh', 'skills', 'mail', 'scripts', 'entry.py'), 'utf8'))
      .toMatch(/json\.load/)
  })

  it('retires a seeded copy of a capability that no longer ships, losslessly', async () => {
    // A leftover from an older ship: ebook was seeded once, then retired.
    const target = join(kbRoot, '.dsh', 'skills', 'ebook')
    await mkdir(join(target, 'scripts'), { recursive: true })
    await writeFile(join(target, 'SKILL.md'), '---\nname: ebook\ndescription: 人改过的版本\n---\n', 'utf8')
    // Retirement is not seeding: the fresh KB still gets its shipped mail copy.
    expect(ensureBuiltinCapabilities(kbRoot)).toEqual(['mail'])
    await expect(readdir(target)).rejects.toMatchObject({ code: 'ENOENT' })
    const backups = await readdir(join(kbRoot, '.dsh', 'yantao', 'capability-backups', 'ebook'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(kbRoot, '.dsh', 'yantao', 'capability-backups', 'ebook', backups[0]!, 'SKILL.md'), 'utf8'))
      .toMatch(/人改过的版本/)
  })

  it('retirement is a no-op when no seeded copy exists', () => {
    expect(ensureBuiltinCapabilities(kbRoot)).toEqual(expect.arrayContaining(['mail']))
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
    // versioned master wins over their older copy, and the hand edit
    // survives in the backup.
    const shipped = await masterVersion('mail')
    await writeFile(
      join(target, 'SKILL.md'),
      `---\nname: mail\ndescription: 人改过的版本\nmetadata:\n  yantao:\n    version: ${shipped - 1}\n---\n\n人改的正文。\n`,
      'utf8',
    )
    expect(ensureBuiltinCapabilities(kbRoot)).toContain('mail')
    const backups = await readdir(join(kbRoot, '.dsh', 'yantao', 'capability-backups', 'mail'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(kbRoot, '.dsh', 'yantao', 'capability-backups', 'mail', backups[0]!, 'SKILL.md'), 'utf8'))
      .toMatch(/人改过的版本/)
    // The live copy is the master's again.
    expect(await seededVersion('mail')).toBe(await masterVersion('mail'))
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
    await expect(readdir(join(kbRoot, '.dsh', 'yantao', 'capability-backups', 'cap'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(join(target, 'SKILL.md'), '人改过', 'utf8')
    backupIfDrifted(kbRoot, 'cap', target, master)
    const backups = await readdir(join(kbRoot, '.dsh', 'yantao', 'capability-backups', 'cap'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(kbRoot, '.dsh', 'yantao', 'capability-backups', 'cap', backups[0]!, 'SKILL.md'), 'utf8'))
      .toBe('人改过')
  })
})

describe('seedBuiltinRoutes', () => {
  /** The routing file's parsed capabilities record. */
  async function routes(): Promise<Record<string, unknown>> {
    const raw = await readFile(join(kbRoot, '.dsh', 'skills', 'yantao.json'), 'utf8')
    return (JSON.parse(raw) as { capabilities: Record<string, unknown> }).capabilities
  }

  it('adds the builtins\' reachability entries to a fresh routing file', async () => {
    await seedBuiltinRoutes(kbRoot)
    expect(await routes()).toMatchObject({
      mail: { path: 'mail', invocation: ['human', 'agent'], appliesTo: { external: ['mailbox'] } },
    })
  })

  it('is idempotent: a second call changes nothing', async () => {
    await seedBuiltinRoutes(kbRoot)
    const first = await readFile(join(kbRoot, '.dsh', 'skills', 'yantao.json'), 'utf8')
    await seedBuiltinRoutes(kbRoot)
    expect(await readFile(join(kbRoot, '.dsh', 'skills', 'yantao.json'), 'utf8')).toBe(first)
  })

  it('never overwrites an entry the human already has', async () => {
    await mkdir(join(kbRoot, '.dsh', 'skills'), { recursive: true })
    const humanEntry = { path: 'my-own-mail', invocation: ['human'] }
    await writeFile(
      join(kbRoot, '.dsh', 'skills', 'yantao.json'),
      JSON.stringify({ version: 1, capabilities: { mail: humanEntry } }),
      'utf8',
    )
    await seedBuiltinRoutes(kbRoot)
    expect(await routes()).toEqual({ mail: humanEntry })
  })

  it('keeps unrelated entries while adding the missing builtin', async () => {
    await mkdir(join(kbRoot, '.dsh', 'skills'), { recursive: true })
    await writeFile(
      join(kbRoot, '.dsh', 'skills', 'yantao.json'),
      JSON.stringify({ version: 1, capabilities: { 'paper-digest': { path: 'repo/skills/paper-digest', invocation: ['agent'] } } }),
      'utf8',
    )
    await seedBuiltinRoutes(kbRoot)
    const seeded = await routes()
    expect(seeded['paper-digest']).toMatchObject({ path: 'repo/skills/paper-digest' })
    expect(seeded.mail).toBeDefined()
  })

  it('swallows a broken routing file instead of throwing', async () => {
    await mkdir(join(kbRoot, '.dsh', 'skills'), { recursive: true })
    await writeFile(join(kbRoot, '.dsh', 'skills', 'yantao.json'), '{ not json', 'utf8')
    await expect(seedBuiltinRoutes(kbRoot)).resolves.toBeUndefined()
  })
})
