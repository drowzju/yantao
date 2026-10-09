/**
 * The approved skill rewrite's writeback (ADR-0054 决定 3): the human has
 * ticked a `skill-rewrite` row in the 提议 inbox, and this is the one place
 * the verdict becomes bytes on disk. Three protections ride along:
 *
 * - the drift guard — the envelope's `original` (the whole file, or an
 *   excerpt occurring exactly once in it — the 2026-10-09 anchor mode) must
 *   still match the file on disk, or the diff is stale and the write refuses
 *   (the human is told to have the agent re-nominate);
 * - the backup — the pre-write content is copied under
 *   `.dsh/yantao/capability-backups/<name>/<stamp>/` (ADR-0023 决定 7's
 *   posture), best-effort: the inbox entry itself retains the original, so
 *   a failed copy costs convenience, not the undo material;
 * - the version clamp — SKILL.md frontmatter `metadata.yantao.version`
 *   belongs to builtin releases (ADR-0052 决定 6), not to the agent: a diff
 *   that moved it is written with the disk's value restored, so a
 *   nomination can never dodge the version-driven upgrade comparison.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/rewrite
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  CapabilityFileError, confineCapabilityFile, locateUniqueSpan, parseFrontmatter, readCapabilityTextFile,
} from '@deepseek-ai/dsh-yantao-kb'
import { readRoutes, routedSkill } from './routing.ts'

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

/** What the YAML parser sees in a SKILL.md frontmatter, as far as the clamp cares. */
interface FrontmatterProbe {
  /** The declared `metadata.yantao.version`, when it is a non-negative integer. */
  readonly version?: number
  /** Whether a `metadata` key exists at all, whatever its value type. */
  readonly hasMetadataKey: boolean
  /** Whether a `metadata.yantao` key exists at all, whatever its value type. */
  readonly hasYantaoKey: boolean
  /** How the parser attributes `metadata`'s value — splicing children into a non-mapping corrupts the file. */
  readonly metadataShape: FrontmatterValueShape
  /** How the parser attributes `metadata.yantao`'s value. */
  readonly yantaoShape: FrontmatterValueShape
}

/** The shape of a key's parsed value: only mappings (and empty/absent slots) tolerate a splice-in. */
type FrontmatterValueShape = 'absent' | 'mapping' | 'empty' | 'other'

function shapeOf(value: unknown): FrontmatterValueShape {
  if (value === undefined) return 'absent'
  if (value === null) return 'empty'
  if (typeof value === 'object' && !Array.isArray(value)) return 'mapping'
  return 'other'
}

/**
 * Read the frontmatter the way the YAML parser sees it. Throws on a missing
 * envelope or malformed YAML — the caller decides whether that is fatal.
 */
function probeFrontmatter(raw: string, displayPath: string): FrontmatterProbe {
  const frontmatter = parseFrontmatter(raw, displayPath)
  const metadata = frontmatter.data.metadata
  const metadataShape = shapeOf(metadata)
  if (metadataShape !== 'mapping') {
    return { hasMetadataKey: metadata !== undefined, hasYantaoKey: false, metadataShape, yantaoShape: 'absent' }
  }
  const yantao = (metadata as { yantao?: unknown }).yantao
  const yantaoShape = shapeOf(yantao)
  if (yantaoShape !== 'mapping') {
    return { hasMetadataKey: true, hasYantaoKey: yantao !== undefined, metadataShape, yantaoShape }
  }
  const version = (yantao as { version?: unknown }).version
  return {
    ...(typeof version === 'number' && Number.isInteger(version) && version >= 0 ? { version } : {}),
    hasMetadataKey: true,
    hasYantaoKey: true,
    metadataShape,
    yantaoShape,
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
 *
 * The clamp never guesses. The parser (js-yaml) and the text lexer (indentation
 * regexes) must agree about where the version lives before a single byte is
 * touched; a diff whose frontmatter cannot be parsed, or whose version the
 * parser can see but the lexer cannot unambiguously locate (flow style, odd
 * indentation, a foreign `version:` the lexer mistakes for ours), is refused
 * loudly instead of blind-spliced — a wrong splice here corrupts the file the
 * route resolves through and bricks the capability.
 * @param originalRaw - the file's current content on disk (the clamp's
 *   reference version is disk truth, which in full-file mode equals the
 *   envelope's `original`).
 * @param newRaw - the approved content about to be written.
 * @returns the content to write, version-clamped.
 */
export function stripVersionChange(originalRaw: string, newRaw: string): string {
  // The ORIGINAL's bytes were just matched against disk by the drift guard
  // (and routedSkill already parsed them), so a probe failure there is
  // theoretical; the NEW content is what lands on disk, so its probe is
  // strict — an unparseable frontmatter refuses the write outright. This
  // also closes the stripped-frontmatter bypass: a diff that deleted the
  // whole envelope can no longer smuggle a version change past the clamp.
  let newProbe: FrontmatterProbe
  try {
    newProbe = probeFrontmatter(newRaw, 'SKILL.md')
  } catch (error) {
    throw new Error(`skillRewriteApply：新 SKILL.md 的 frontmatter 无法解析（${(error as Error).message}）；版本钳制拒绝在猜测中写回`)
  }
  const originalProbe: FrontmatterProbe = (() => {
    try {
      return probeFrontmatter(originalRaw, 'SKILL.md')
    } catch {
      return { hasMetadataKey: false, hasYantaoKey: false, metadataShape: 'absent', yantaoShape: 'absent' }
    }
  })()
  const originalVersion = originalProbe.version
  const newVersion = newProbe.version
  if (originalVersion === newVersion) return newRaw
  const refuse = (why: string): Error =>
    new Error(
      `skillRewriteApply：版本钳制无法在新 SKILL.md 里无歧义地定位 metadata.yantao.version（${why}）；`
      + '拒绝在猜测中写回，请让 agent 用标准两空格嵌套的 frontmatter 重新提名',
    )
  const lines = newRaw.split('\n')
  if (lines[0]?.trim() !== '---') throw refuse('frontmatter 信封缺失')
  let close = -1
  for (let at = 1; at < lines.length; at += 1) {
    if (lines[at]?.trim() === '---') { close = at; break }
  }
  if (close === -1) throw refuse('frontmatter 信封未闭合')
  // Locate the metadata: → yantao: → version: nest by indentation, so a
  // foreign `version:` key (e.g. the skill spec's own `version:`) is never
  // mistaken for the one that belongs to us — and cross-check every step
  // against the parser before trusting the lexer's eyes.
  const metadataAt = lines.findIndex((line, at) => at < close && /^metadata:\s*$/.test(line))
  if (metadataAt === -1) {
    if (newProbe.hasMetadataKey) {
      throw refuse('YAML 里存在 metadata 键，但文本层没有它的块状声明')
    }
    // The diff deleted the whole nest: rebuild the triple the original
    // declared. A version delta exists, so the original must have declared
    // one — with no metadata in the new content its version is undefined,
    // which would have taken the equality early-return above.
    lines.splice(close, 0, 'metadata:', '  yantao:', `    version: ${originalVersion}`)
    return lines.join('\n')
  }
  const yantaoAt = lines.findIndex((line, at) => at > metadataAt && at < close && /^  yantao:\s*$/.test(line))
  if (yantaoAt === -1) {
    if (newProbe.hasYantaoKey) {
      throw refuse('YAML 里的 yantao 键不在 metadata 之下的标准两空格位置')
    }
    if (newProbe.metadataShape === 'other') {
      // A block-style sequence under `metadata:` passes the parser without
      // error and leaves hasYantaoKey false — splicing mapping lines into a
      // sequence value would produce invalid YAML. Refuse loudly instead.
      throw refuse('YAML 里的 metadata 不是映射，拒绝往里拼接 yantao 嵌套')
    }
    const inserted = ['  yantao:', `    version: ${originalVersion}`]
    lines.splice(metadataAt + 1, 0, ...inserted)
    return lines.join('\n')
  }
  // The four-space region under yantao ends where the next two-space sibling
  // (or the envelope close) begins — a later sibling's own `version:` child
  // must never be mistaken for ours.
  const regionEnd = (() => {
    const sibling = lines.findIndex((line, at) => at > yantaoAt && at < close && /^ {2}\S/.test(line))
    return sibling === -1 ? close : sibling
  })()
  const isVersionLine = (line: string): boolean => /^    version:\s*/.test(line)
  const versionAt = lines.findIndex((line, at) => at > yantaoAt && at < regionEnd && isVersionLine(line))
  if (versionAt === -1) {
    if (newVersion !== undefined) {
      throw refuse('YAML 里看得到版本值，但它不在 yantao 之下的标准四空格位置')
    }
    if (newProbe.yantaoShape === 'other') {
      throw refuse('YAML 里的 yantao 不是映射，拒绝往里拼接 version 行')
    }
    lines.splice(yantaoAt + 1, 0, `    version: ${originalVersion}`)
    return lines.join('\n')
  }
  if (newVersion === undefined) {
    // The four-space version line the lexer found is not the one the parser
    // attributes to metadata.yantao.version — rewriting it would trample a
    // foreign key.
    throw refuse('文本层的 version 行不属于 YAML 里的 metadata.yantao')
  }
  if (lines.filter((line, at) => at > yantaoAt && at < regionEnd && isVersionLine(line)).length > 1) {
    throw refuse('yantao 之下出现了多行 version')
  }
  if (originalVersion === undefined) {
    // Strip the version line; when the yantao (or even metadata) nest held
    // nothing but that line, the shell goes with it — the clamp restores the
    // original bytes, not an emptied husk the original never declared.
    const yantaoChildren = lines.filter((line, at) => at > yantaoAt && at < regionEnd && /^ {4}\S/.test(line))
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
  // Value agreement closes the last parser/lexer divergence: a duplicate
  // `yantao:` key or an alias can make the parser read a different number
  // than the line found here — rewriting then tramples a foreign key and
  // leaves the real yantao.version unclamped.
  const declared = (lines[versionAt] ?? '').replace(/^    version:[ \t]*/, '').replace(/\s+#.*$/, '').trim()
  if (Number(declared) !== newVersion) {
    throw refuse('文本层 version 行的值与 YAML 解析出的 metadata.yantao.version 不一致')
  }
  lines[versionAt] = `    version: ${originalVersion}`
  return lines.join('\n')
}

/** Dress the shared confinement's refusal in the writeback's prose. */
function confinementError(reason: CapabilityFileError['reason'], file: string): Error {
  if (reason === 'escapes') {
    return new Error(`skillRewriteApply：file 越出了能力目录：${file}`)
  }
  return new Error(`skillRewriteApply：file 不合法或落在禁止目录里：${file}`)
}

/**
 * Write one approved rewrite back (ADR-0054 决定 3/4). Re-resolves the route
 * at approval time — the nomination's validity does not survive an
 * unregistration — re-checks the file's confinement, refuses a stale diff,
 * backs the pre-write bytes up, clamps the version, and writes atomically.
 * The whole read-check-backup-write cycle runs under the target's file lock,
 * so two approvals racing on one file cannot interleave their read and write.
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
  let file: string
  try {
    file = confineCapabilityFile(routed.directory, args.file)
  } catch (error) {
    if (!(error instanceof CapabilityFileError)) throw error
    throw confinementError(error.reason, args.file)
  }
  if (args.new.includes('\0')) {
    throw new Error('skillRewriteApply：new 是二进制内容（含 NUL 字节），拒绝写回')
  }
  const target = resolve(routed.directory, file)
  return withFileLock(target, async (): Promise<SkillRewriteApplied> => {
    let current: string
    try {
      current = await readCapabilityTextFile(routed.directory, file)
    } catch (error) {
      if (error instanceof CapabilityFileError) {
        throw new Error(`skillRewriteApply：${file} 是符号链接，拒绝穿越读写——请由人类检查该文件`)
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`${file} 已不存在，diff 无法套用`)
      }
      throw new Error(`读不了 ${file}：${error instanceof Error ? error.message : String(error)}`)
    }
    if (current.includes('\0')) {
      throw new Error(`${file} 是二进制内容，拒绝写回`)
    }
    // The anchor-mode drift guard (ADR-0054, 2026-10-09 修订): `original` is
    // either the whole file (then the locate degenerates to index 0 and the
    // composite is exactly `new`) or an excerpt occurring exactly once — the
    // one span the write replaces. Absent means the file moved underneath the
    // nomination; ambiguous means the anchor cannot pick a target. Either way
    // the human re-nominates from a fresh read.
    const located = locateUniqueSpan(current, args.original)
    if (located === 'absent') {
      throw new Error(`${file} 在提名后又被改动，original 段已不在文件里，diff 已过期；请让 agent 重新读取后再提名`)
    }
    if (located === 'ambiguous') {
      throw new Error(`${file} 里 original 出现了多处，无法定位替换目标；请让 agent 扩大片段范围重新提名`)
    }
    const composite = current.slice(0, located.at) + args.new + current.slice(located.at + args.original.length)
    const written = basename(file).toLowerCase() === 'skill.md'
      ? stripVersionChange(current, composite)
      : composite
    // The backup is the fallback (ADR-0054): best-effort, because the inbox
    // entry retains the original bytes either way — a failed copy is reported
    // by omission, never allowed to block the approved write. The stamp
    // carries a random tail so two approvals within the same second land in
    // separate directories instead of overwriting each other's copy.
    let backupPath: string | undefined
    try {
      const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`
      const destination = join(kbRoot, '.dsh', 'yantao', 'capability-backups', args.name, stamp, file)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(target, destination)
      backupPath = `${BACKUPS_DISPLAY_ROOT}/${args.name}/${stamp}/${file}`
    } catch (error) {
      // Best-effort by design (the inbox entry retains the original bytes
      // either way), but silence hides a broken backups tree — say it aloud.
      console.warn(`skillRewriteApply：${file} 的写前备份失败（${error instanceof Error ? error.message : String(error)}）；写回继续，原件仍在收件箱条目里`)
    }
    // Preserve the file's own permission bits: a hard-coded 0o644 would
    // silently strip an executable bit or a tighter umask the human set.
    const mode = (await stat(target)).mode & 0o777
    await writeFileAtomic(target, written, { mode })
    return { file, ...(backupPath !== undefined ? { backupPath } : {}) }
  })
}
