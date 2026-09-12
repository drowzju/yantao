/**
 * The shipped capability directories (ADR-0021): `mail` and `ebook` are real
 * skill directories that ship inside this package and are *seeded* into the
 * KB's `.dsh/skills/` on first use — where the skill-filesystem provider
 * discovers them like any other capability, the human can read and edit them
 * next to the ones they create, and the 「新建能力」 scaffold has working
 * siblings to learn from. Seeding is lazy (called at the top of
 * `capabilityList`/`capabilityRun`), copy-on-missing, and version-driven: a
 * master whose `metadata.yantao.version` is newer than the seeded copy's
 * overwrites it, so bug fixes in the shipped scripts actually reach the KB.
 *
 * Discovery is cwd-driven per lookup (`ctx.skills.get(name, { cwd: kbRoot })`
 * walks up from the KB root to the nearest `.git`); a KB root nested inside
 * some unrelated git repository would resolve that repository as the project
 * root, and its `.dsh/skills` — not the KB's. A known v1 edge (ADR-0021), not
 * a bug to fix here.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/builtin
 */
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the master directories live. The module runs from `src/capability/`
 * under vitest and from `lib/types/capability/` once built, so both are tried
 * in order.
 * @returns the existing builtin root, or the source-tree path as a fallback.
 */
function builtinRoot(): string {
  const fallback = new URL('./builtin', import.meta.url)
  const candidates = [fallback, new URL('../../../src/capability/builtin', import.meta.url)]
  const found = candidates.find(candidate => existsSync(fileURLToPath(candidate)))
  return fileURLToPath(found ?? fallback)
}

/**
 * A master's declared version, read straight out of its SKILL.md frontmatter
 * (`metadata.yantao.version`). A directory without a readable version counts
 * as 0, so a versioned master always wins over an unversioned leftover.
 * @param directory - the capability directory to read.
 * @returns the declared version, or 0.
 */
function manifestVersion(directory: string): number {
  try {
    const match = /^\s*version:\s*(\d+)\s*$/m.exec(readFileSync(join(directory, 'SKILL.md'), 'utf8'))
    return match === null ? 0 : Number(match[1])
  } catch {
    return 0
  }
}

/**
 * Seed the builtin capability directories into `<kbRoot>/.dsh/skills/`.
 * @param kbRoot - the live knowledge-base root.
 * @returns the names that were (re-)written this call — empty when everything
 *   was already up to date. The caller uses this to wait out the filesystem
 *   watcher's invalidation lag before resolving skills.
 */
export function ensureBuiltinCapabilities(kbRoot: string): readonly string[] {
  const root = builtinRoot()
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    // No builtin root (should not happen): nothing to seed, not a failure.
    return []
  }
  const seeded: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const master = join(root, entry.name)
    const target = join(kbRoot, '.dsh', 'skills', entry.name)
    // Present and at least as new as the master: leave the human's copy alone.
    if (manifestVersion(target) >= manifestVersion(master) && existsSync(join(target, 'SKILL.md'))) continue
    try {
      cpSync(master, target, { recursive: true, force: true })
    } catch {
      // An unreadable KB or a locked file surfaces on the run that needs the
      // capability, not here — seeding is an optimization, not a gate.
      continue
    }
    seeded.push(entry.name)
  }
  return seeded
}
