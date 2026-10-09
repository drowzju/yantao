/**
 * The approved skill rewrite's writeback (ADR-0054 决定 3): the human has
 * ticked a `skill-rewrite` row in the 提议 inbox, and this is the one place
 * the verdict becomes bytes on disk. Three protections ride along:
 *
 * - the drift guard — the file on disk must still match the envelope's
 *   `original`, or the diff is stale and the write refuses (the human is
 *   told to have the agent re-nominate);
 * - the backup — the pre-write content is copied under
 *   `.dsh/yantao/capability-backups/<name>/<stamp>/` (ADR-0023 决定 7's
 *   posture), best-effort: the inbox entry itself retains the original, so
 *   a failed copy costs convenience, not the undo material;
 * - the version clamp — SKILL.md frontmatter `metadata.yantao.version`
 *   belongs to builtin releases (ADR-0052 决定 6), not to the agent: a diff
 *   that moved it is written with the original's value restored, so a
 *   nomination can never dodge the version-driven upgrade comparison.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/rewrite
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseFrontmatter } from '@deepseek-ai/dsh-yantao-kb'
import { readRoutes, routedSkill } from './routing.ts'

/** Run-artifact directories a writeback may never touch — the same blacklist the nomination enforces. */
const ARTIFACT_DIRS: ReadonlySet<string> = new Set(['state', 'downloads', 'reports', 'out', '__pycache__'])

/** Where the pre-write backups sit, relative to the KB root. */
export const BACKUPS_DISPLAY_ROOT = '.dsh/yantao/capability-backups'

/** The args one approved rewrite carries — mirrored from `KbSkillRewriteApplyArgs`. */
export interface SkillRewriteWriteback {
  readonly name: string
  readonly file: string
  readonly original: string
  readonly new: string
}

/** What one writeback reports. */
export interface SkillRewriteApplied {
  /** The written file's path relative to the capability directory, forward slashes. */
  readonly file: string
  /** Where the pre-write content was backed up, when the copy succeeded. */
  readonly backupPath?: string
}

/** A SKILL.md frontmatter's declared `metadata.yantao.version`, or undefined. */
function declaredVersion(raw: string): number | undefined {
  try {
    const frontmatter = parseFrontmatter(raw, 'SKILL.md')
    const metadata = frontmatter.data.metadata
    if (typeof metadata !== 'object' || metadata === null) return undefined
    const version = (metadata as { yantao?: { version?: unknown } }).yantao?.version
    if (typeof version === 'number' && Number.isInteger(version) && version >= 0) return version
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Clamp the new SKILL.md's declared version back to the original's (ADR-0054
 * 决定 4): the version field travels only with builtin releases, so a
 * nomination that bumped, added, or deleted it is written with the
 * original's value restored. The patch is surgical — the version line inside
 * the `metadata: → yantao:` nest of the NEW frontmatter is rewritten or
 * removed (or re-inserted when the diff deleted it); everything else in the
 * diff lands untouched.
 * @param originalRaw - the file's content as the agent read it.
 * @param newRaw - the approved content about to be written.
 * @returns the content to write, version-clamped.
 */
export function stripVersionChange(originalRaw: string, newRaw: string): string {
  const originalVersion = declaredVersion(originalRaw)
  const newVersion = declaredVersion(newRaw)
  if (originalVersion === newVersion) return newRaw
  const lines = newRaw.split('\n')
  if (lines[0]?.trim() !== '---') return newRaw
  let close = -1
  for (let at = 1; at < lines.length; at += 1) {
    if (lines[at]?.trim() === '---') { close = at; break }
  }
  if (close === -1) return newRaw
  // Locate the metadata: → yantao: → version: nest by indentation, so a
  // foreign `version:` key (e.g. the skill spec's own `version:`) is never
  // mistaken for the one that belongs to us.
  const metadataAt = lines.findIndex((line, at) => at < close && /^metadata:\s*$/.test(line))
  if (metadataAt === -1) {
    // The diff deleted the whole nest: rebuild the triple the original declared.
    lines.splice(close, 0, 'metadata:', '  yantao:', `    version: ${originalVersion}`)
    return lines.join('\n')
  }
  const yantaoAt = lines.findIndex((line, at) => at > metadataAt && at < close && /^  yantao:\s*$/.test(line))
  if (yantaoAt === -1) {
    const inserted = ['  yantao:', `    version: ${originalVersion}`]
    lines.splice(metadataAt + 1, 0, ...inserted)
    return lines.join('\n')
  }
  const versionAt = lines.findIndex((line, at) => at > yantaoAt && at < close && /^    version:\s*/.test(line))
  if (versionAt === -1) {
    lines.splice(yantaoAt + 1, 0, `    version: ${originalVersion}`)
    return lines.join('\n')
  }
  if (originalVersion === undefined) {
    // Strip the version line; when the yantao (or even metadata) nest held
    // nothing but that line, the shell goes with it — the clamp restores the
    // original bytes, not an emptied husk the original never declared.
    const yantaoChildren = lines.filter((line, at) => at > yantaoAt && at < close && /^ {4}\S/.test(line))
    const doomed = [versionAt]
    if (yantaoChildren.length === 1) doomed.push(yantaoAt)
    if (doomed.length === 2) {
      const metadataHasOtherChildren = lines.some(
        (line, at) => at > metadataAt && at < close && at !== yantaoAt && /^ {2}\S/.test(line),
      )
      if (!metadataHasOtherChildren) doomed.push(metadataAt)
    }
    for (const at of doomed.sort((a, b) => b - a)) lines.splice(at, 1)
    return lines.join('\n')
  }
  lines[versionAt] = `    version: ${originalVersion}`
  return lines.join('\n')
}

/** Normalize and confine one writeback's `file` against the capability directory. */
function confinedRelativeOf(directory: string, file: string): string {
  const slashed = file.replaceAll('\\', '/')
  // Absoluteness is judged on the path as given — stripping leading slashes
  // first would quietly turn `/etc/passwd` into a tame-looking `etc/passwd`.
  if (isAbsolute(slashed)) {
    throw new Error(`skillRewriteApply：file 不合法或落在禁止目录里：${file}`)
  }
  const normalized = slashed.replace(/^\/+/, '')
  if (normalized === '' || normalized.endsWith('/')
    || normalized.split('/').includes('..')
    || normalized.split('/').some(segment => ARTIFACT_DIRS.has(segment))) {
    throw new Error(`skillRewriteApply：file 不合法或落在禁止目录里：${file}`)
  }
  const target = resolve(directory, normalized)
  const rel = relative(directory, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`skillRewriteApply：file 越出了能力目录：${file}`)
  }
  return rel.replaceAll('\\', '/')
}

/**
 * Write one approved rewrite back (ADR-0054 决定 3/4). Re-resolves the route
 * at approval time — the nomination's validity does not survive an
 * unregistration — re-checks the file's confinement, refuses a stale diff,
 * backs the pre-write bytes up, clamps the version, and writes atomically.
 * @param kbRoot - the live KB root.
 * @param args - the approved rewrite.
 * @returns what was written and where the backup sits.
 */
export async function applySkillRewrite(kbRoot: string, args: SkillRewriteWriteback): Promise<SkillRewriteApplied> {
  const skillsRoot = join(kbRoot, '.dsh', 'skills')
  const route = (await readRoutes(skillsRoot))[args.name]
  if (route === undefined) {
    throw new Error(`能力「${args.name}」已不在中央路由里，写回无处落脚`)
  }
  const routed = await routedSkill(skillsRoot, route)
  if (routed === undefined) {
    throw new Error(`能力「${args.name}」的技能目录已不存在：${route.path}`)
  }
  const file = confinedRelativeOf(routed.directory, args.file)
  const target = resolve(routed.directory, file)
  let current: string
  try {
    current = await readFile(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${file} 已不存在，diff 无法套用`)
    }
    throw new Error(`读不了 ${file}：${(error as Error).message}`)
  }
  if (current.includes('\0')) {
    throw new Error(`${file} 是二进制内容，拒绝写回`)
  }
  if (current !== args.original) {
    throw new Error(`${file} 在提名后又被改动，diff 已过期；请让 agent 重新读取后再提名`)
  }
  const written = basename(file).toLowerCase() === 'skill.md'
    ? stripVersionChange(args.original, args.new)
    : args.new
  // The backup is the fallback (ADR-0054): best-effort, because the inbox
  // entry retains the original bytes either way — a failed copy is reported
  // by omission, never allowed to block the approved write.
  let backupPath: string | undefined
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destination = join(kbRoot, '.dsh', 'yantao', 'capability-backups', args.name, stamp, file)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(target, destination)
    backupPath = `${BACKUPS_DISPLAY_ROOT}/${args.name}/${stamp}/${file}`
  } catch {
    // Best-effort by design; see above.
  }
  await writeFileAtomic(target, written, { mode: 0o644 })
  return { file, ...(backupPath !== undefined ? { backupPath } : {}) }
}
