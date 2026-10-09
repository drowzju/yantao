/**
 * The skill-rewrite nomination (ADR-0054): the agent's one channel into a
 * capability's own directory — not a write, a nomination. The tool gathers a
 * diff envelope (`original` + `new`, 无 diff 不成卡), validates the target
 * against the central routing file, and appends the proposal to the ADR-0047
 * inbox, where a human approves or discards it. Approval writeback is the
 * controller's `skillRewriteApply` — this module never touches the skill
 * directory.
 *
 * Scope rules (ADR-0054 决定 1): the capability must be registered in the
 * central routing file, the file must sit inside the routed directory, and
 * the run-artifact directories (`state/`, `downloads/`, `reports/`, `out/`,
 * `__pycache__/`) are blacklisted — those hold a run's debris, not the
 * capability's instructions. Binary content is refused: the card renders a
 * line diff, and a NUL byte has no place in one.
 * @module @deepseek-ai/dsh-yantao-kb/skill-rewrite
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { CapabilityFileError, confineCapabilityFile, readCapabilityTextFile } from './capability-file.ts'
import { enqueueProposal, SOURCE_NAME_MAX, TITLE_MAX } from './proposal-inbox.ts'
import { KbError } from './types.ts'

/** The inbox `source` prefix a nomination carries: `<kind>:<capability>`. */
export const SKILL_REWRITE_SOURCE = 'skill-rewrite'

/** Per-side character cap on the envelope — a nomination is a diff, not a dump. */
const SIDE_CHARS_CAP = 200_000

/**
 * Cap on `why` — a product decision ("一句话说服人"), not the inbox store's
 * NOTE_MAX: the why travels inside the opaque proposal payload, which the
 * store does not length-check, so this bound is ours to own.
 */
const WHY_MAX = 500

/** The nomination's shape, as the tool's parameters hand it in. */
export interface SkillRewriteNomination {
  /** The capability's name, as the central routing file keys it. */
  readonly name: string
  /** The file's path relative to the capability's directory, forward slashes. */
  readonly file: string
  /** The file's content as the proposing agent read it — the diff's left side. */
  readonly original: string
  /** The proposed content — the diff's right side. */
  readonly new: string
  /** Why the rewrite is worth a human's attention. */
  readonly why: string
}

/** What one accepted nomination reports: the inbox's pending depth. */
export interface SkillRewriteProposed {
  readonly pending: number
}

/**
 * Resolve one capability's routed directory, lightly: the routing file is
 * parsed just far enough to trust one entry's `path` (version 1, object
 * entry, relative path without `..`). Full validation is the controller's
 * writeback concern — a nomination only needs to find the directory.
 * @returns the capability directory's absolute path.
 */
async function routedDirectoryOf(kbRoot: string, name: string): Promise<string> {
  const skillsRoot = join(kbRoot, '.dsh', 'skills')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(skillsRoot, 'yantao.json'), 'utf8'))
  } catch {
    throw new KbError('skill-not-routed', `读不到中央路由文件 .dsh/skills/yantao.json，能力「${name}」无从谈起`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new KbError('skill-not-routed', '中央路由文件 .dsh/skills/yantao.json 形状不对')
  }
  const capabilities = (parsed as { capabilities?: unknown }).capabilities
  if (typeof capabilities !== 'object' || capabilities === null) {
    throw new KbError('skill-not-routed', `中央路由文件里没有 capabilities 表，能力「${name}」未注册`)
  }
  const entry = (capabilities as Record<string, unknown>)[name]
  if (typeof entry !== 'object' || entry === null || typeof (entry as { path?: unknown }).path !== 'string') {
    throw new KbError('skill-not-routed', `能力「${name}」不在中央路由里（改名了？先让人核对 .dsh/skills/yantao.json）`)
  }
  const path = (entry as { path: string }).path.replaceAll('\\', '/')
  if (path === '' || isAbsolute(path) || path.split('/').includes('..')) {
    throw new KbError('skill-not-routed', `能力「${name}」的路由 path 越出了 .dsh/skills/，拒绝提名`)
  }
  return resolve(skillsRoot, path)
}

/** Dress the shared confinement's refusal in the nomination's KbError voice. */
function badFile(reason: CapabilityFileError['reason'], file: string): KbError {
  if (reason === 'artifact') {
    return new KbError('bad-skill-file', `${file} 落在运行产物目录里——那不是说明书，不接受改写提名`)
  }
  if (reason === 'escapes') {
    return new KbError('bad-skill-file', `file 不得越出能力目录：${file}`)
  }
  return new KbError('bad-skill-file', `file 不合法或必须指向技能目录里的一个文件：${file}`)
}

/**
 * Validate one nomination and append it to the proposal inbox (ADR-0054).
 * The envelope's `original` must match the file's current bytes — a stale
 * diff would either clobber a human's fresh edit or fail confusingly at
 * approval time, so the mismatch refuses here, where the agent can re-read
 * and re-propose.
 * @param kbRoot - the live KB root.
 * @param args - the nomination.
 * @returns the inbox's pending depth after the append.
 */
export async function proposeSkillRewrite(kbRoot: string, args: SkillRewriteNomination): Promise<SkillRewriteProposed> {
  const name = args.name.trim()
  const why = args.why.trim()
  if (name === '') throw new KbError('bad-skill-file', 'name 不能为空')
  if (why === '') throw new KbError('bad-skill-file', 'why 不能为空——人要看理由才能裁决')
  // Pre-limit the framing fields to what the inbox store will accept — a
  // rejection here names the fix, where the store's normalizer would only say
  // "第 N 条提议格式不对". SOURCE_NAME_MAX/TITLE_MAX are imported from the
  // store so the two sides cannot drift; the title is checked as composed
  // (the raw args.file is never shorter than the normalized one, so this is
  // the conservative side).
  if (name.length > SOURCE_NAME_MAX) throw new KbError('bad-skill-file', `name 超过 ${SOURCE_NAME_MAX} 字（现 ${name.length} 字）——先核对能力名`)
  if (`改写能力「${name}」的 ${args.file}`.length > TITLE_MAX) {
    throw new KbError('bad-skill-file', `name+file 拼出的标题超过 ${TITLE_MAX} 字，换个短些的能力名或路径`)
  }
  if (why.length > WHY_MAX) throw new KbError('bad-skill-file', `why 超过 ${WHY_MAX} 字（现 ${why.length} 字）——一句话说服人，写短些`)
  for (const [side, text] of [['original', args.original], ['new', args.new]] as const) {
    if (typeof text !== 'string' || text === '') throw new KbError('bad-skill-file', `${side} 不能为空——无 diff 不成卡`)
    if (text.length > SIDE_CHARS_CAP) {
      throw new KbError('skill-file-too-large', `${side} 超过 ${SIDE_CHARS_CAP} 字上限，先拆小再提名`)
    }
    if (text.includes('\0')) {
      throw new KbError('skill-file-binary', `${side} 是二进制内容（含 NUL 字节），卡片渲染不了行级 diff，不接受提名`)
    }
  }
  const directory = await routedDirectoryOf(kbRoot, name)
  let file: string
  try {
    file = confineCapabilityFile(directory, args.file)
  } catch (error) {
    if (!(error instanceof CapabilityFileError)) throw error
    throw badFile(error.reason, args.file)
  }
  let current: string
  try {
    current = await readCapabilityTextFile(directory, file)
  } catch (error) {
    if (error instanceof CapabilityFileError) {
      throw new KbError('skill-file-symlink', `${file} 是符号链接，拒绝穿越读写——请由人类检查该文件`)
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KbError('skill-file-not-found', `能力「${name}」的技能目录里没有 ${file}——只能提名已存在的文件`)
    }
    throw new KbError('skill-file-not-found', `读不了 ${file}：${error instanceof Error ? error.message : String(error)}`)
  }
  if (current !== args.original) {
    throw new KbError('skill-file-drifted', `${file} 的现内容与 original 不符——文件在提名前已被改动，请重新读取后再提名`)
  }
  if (current === args.new) {
    throw new KbError('skill-rewrite-empty', 'original 与 new 相同，没有可裁决的 diff')
  }
  const stored = await enqueueProposal(kbRoot, {
    source: `${SKILL_REWRITE_SOURCE}:${name}`,
    sourceName: name,
    title: `改写能力「${name}」的 ${file}`,
    proposal: {
      title: `改写能力「${name}」的 ${file}`,
      actions: [{ kind: 'skill-rewrite', name, file, original: args.original, new: args.new, why }],
    },
  })
  return { pending: stored.filter(entry => entry.status === 'pending').length }
}
