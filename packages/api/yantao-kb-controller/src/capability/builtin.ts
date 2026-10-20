/**
 * The shipped capability directories (ADR-0021): `mail` is a real
 * skill directory that ships inside this package and is *seeded* into the
 * KB's `.dsh/skills/` on first use — where the skill-filesystem provider
 * discovers it like any other capability, the human can read and edit it
 * next to the ones they create, and the 「新建能力」 scaffold has a working
 * sibling to learn from. Seeding is lazy (called at the top of
 * `capabilityList`/`capabilityRun`), copy-on-missing, and version-driven: a
 * master whose declared `version` is newer than the seeded copy's
 * overwrites it, so bug fixes in the shipped scripts actually reach the KB —
 * and a drifted copy (the human's hand edits) is backed up first
 * (ADR-0023 决定 7), so the overwrite is never a silent loss.
 *
 * A builtin that no longer ships (`ebook`, retired 2026-09-14 with the
 * reading-project flow) is *retired*: a seeded copy is moved under
 * `.dsh/yantao/capability-backups/` — losslessly, never hard-deleted — so it
 * stops appearing in the capability list and the agent's catalog without
 * destroying anything the human may have customized.
 *
 * Discovery is cwd-driven per lookup (`ctx.skills.get(name, { cwd: kbRoot })`
 * walks up from the KB root to the nearest `.git`); a KB root nested inside
 * some unrelated git repository would resolve that repository as the project
 * root, and its `.dsh/skills` — not the KB's. A known v1 edge (ADR-0021), not
 * a bug to fix here.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/builtin
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter } from '@deepseek-ai/dsh-yantao-kb'
import { addRoutes, readRoutes } from './routing.ts'
import type { CapabilityRoute } from './routing.ts'

/**
 * Builtin capabilities that no longer ship. A seeded copy found in the KB is
 * retired (moved under `.dsh/yantao/capability-backups/`) instead of updated, so
 * it disappears from the capability list and the agent's catalog.
 */
const RETIRED: readonly string[] = ['ebook']

/**
 * Where the master directories live. The module runs from `src/capability/`
 * under vitest and from `lib/types/capability/` once built, so both are tried
 * in order.
 * @returns the existing builtin root, or the source-tree path as a fallback.
 */
function builtinRoot(): string {
  const fallback = new URL('./builtin', import.meta.url)
  // Three layouts: beside the module (a copied lib tree), the per-file tsc
  // layout (`lib/types/capability/`), and the bundled `lib/index.js` — the
  // last one sits one directory higher, so its relative path has one fewer
  // `..`. Without it the seed silently finds nothing and the KB keeps its old
  // SKILL.md version.
  const candidates = [
    fallback,
    new URL('../../../src/capability/builtin', import.meta.url),
    new URL('../src/capability/builtin', import.meta.url),
  ]
  const found = candidates.find(candidate => existsSync(fileURLToPath(candidate)))
  return fileURLToPath(found ?? fallback)
}

/**
 * Builtin reachability, seeded into the central routing file on first use
 * (ADR-0052 决定 5): idempotent — an entry the human already has (edited or
 * not) is never overwritten; only a missing name is added.
 */
const BUILTIN_ROUTES: Readonly<Record<string, CapabilityRoute>> = {
  mail: { path: 'mail', invocation: ['human', 'agent'], appliesTo: { external: ['mailbox'] } },
}

/**
 * A master's declared version, read out of the SKILL.md frontmatter's
 * `metadata.yantao.version` (ADR-0052 决定 6): a lazy number that exists only
 * for the "package newer than copy" comparison — no permission semantics,
 * nothing else reads it. A directory without a readable version counts as 0,
 * so a versioned master always wins over an unversioned leftover.
 * @param directory - the capability directory to read.
 * @returns the declared version, or 0.
 */
function manifestVersion(directory: string): number {
  try {
    const frontmatter = parseFrontmatter(readFileSync(join(directory, 'SKILL.md'), 'utf8'), 'SKILL.md')
    const metadata = frontmatter.data.metadata
    if (typeof metadata !== 'object' || metadata === null) return 0
    const version = (metadata as { yantao?: { version?: unknown } }).yantao?.version
    if (typeof version === 'number' && Number.isInteger(version) && version >= 0) return version
    return 0
  } catch {
    return 0
  }
}

/**
 * One capability directory's files, as `relative path → content`. Symlinks
 * and oddities are skipped: a capability directory is markdown, a sidecar,
 * and scripts — anything else is not worth protecting.
 */
function treeFiles(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  const walk = (prefix: string): void => {
    for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(relative)
      else if (entry.isFile()) files.set(relative, readFileSync(join(root, relative)))
    }
  }
  walk('')
  return files
}

/**
 * Whether two capability directories differ in file set or in any file's
 * bytes — the drift test that decides whether an overwrite needs a backup.
 */
function treesDiffer(target: string, master: string): boolean {
  const left = treeFiles(target)
  const right = treeFiles(master)
  if (left.size !== right.size) return true
  for (const [path, content] of left) {
    const other = right.get(path)
    if (other === undefined || !content.equals(other)) return true
  }
  return false
}

/**
 * Back up a drifted KB copy before the versioned master overwrites it
 * (ADR-0023 决定 7): the human's hand edits survive the upgrade under
 * `<kbRoot>/.dsh/yantao/capability-backups/<name>/<timestamp>/`. Backup is loss
 * insurance, not a merge — and never a gate: any failure here is swallowed,
 * because the version comparison has already decided the overwrite happens.
 * @param kbRoot - the live knowledge-base root.
 * @param name - the capability's name, for the backup path.
 * @param target - the KB copy about to be overwritten (must exist).
 * @param master - the shipped copy it will be replaced by.
 */
export function backupIfDrifted(kbRoot: string, name: string, target: string, master: string): void {
  try {
    if (!existsSync(target) || !treesDiffer(target, master)) return
    // Colons and dots are illegal or awkward in Windows paths; the stamp is
    // sortable and safe: 2026-09-14T09-15-33-123Z.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    cpSync(target, join(kbRoot, '.dsh', 'yantao', 'capability-backups', name, stamp), { recursive: true })
  } catch {
    // An unreadable copy or a locked file surfaces on the run that needs the
    // capability — seeding (and therefore backing up) is not a gate.
  }
}

/**
 * Retire a seeded copy of a builtin that no longer ships: move it under
 * `.dsh/yantao/capability-backups/<name>/<stamp>-retired/` — a copy-plus-delete
 * rather than a rename, because the KB root may sit on another drive. The
 * human's customizations survive; the copy just stops being a capability.
 * @param kbRoot - the live knowledge-base root.
 * @param name - the retired capability's name, for the backup path.
 * @param target - the seeded copy to retire, when it exists.
 */
function retireCapability(kbRoot: string, name: string, target: string): void {
  try {
    if (!existsSync(target)) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(kbRoot, '.dsh', 'yantao', 'capability-backups', name, `${stamp}-retired`)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(target, dest, { recursive: true })
    rmSync(target, { recursive: true, force: true })
  } catch {
    // A locked file or an unreadable copy surfaces on the run that needs the
    // directory — retirement, like seeding, is not a gate.
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
  for (const name of RETIRED) {
    retireCapability(kbRoot, name, join(kbRoot, '.dsh', 'skills', name))
  }
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
    // A version bump overwrites wholesale; whatever the human changed in the
    // old copy is preserved as a backup first (ADR-0023 决定 7).
    backupIfDrifted(kbRoot, entry.name, target, master)
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

/**
 * Seed the builtins' reachability entries into the central routing file
 * (ADR-0052 决定 5): add-if-absent, never overwriting an entry the human has
 * (or merely has). Best-effort by design — a broken or unwritable routing
 * file surfaces at the next readRoutes, which is the authority; seeding is
 * a convenience, not a gate.
 * @param kbRoot - the live knowledge-base root.
 */
export async function seedBuiltinRoutes(kbRoot: string): Promise<void> {
  try {
    const skillsRoot = join(kbRoot, '.dsh', 'skills')
    const routes = await readRoutes(skillsRoot)
    const missing = Object.entries(BUILTIN_ROUTES).filter(([name]) => routes[name] === undefined)
    if (missing.length === 0) return
    await addRoutes(skillsRoot, Object.fromEntries(missing))
  } catch {
    // The next readRoutes reports a broken file where it matters.
  }
}
