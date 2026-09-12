/**
 * Run one capability's host-side entry (ADR-0021): one subprocess call, one
 * JSON object back — the mail connector's (ADR-0019) and the extractor's
 * (ADR-0020) pattern, generalized.
 *
 * A capability is a dsh skill directory whose frontmatter carries a
 * `metadata.yantao` declaration (`entry`/`runtime`/`appliesTo`); discovery is
 * `ctx.skills`' business, this module owns the contract between the host and
 * the entry script. The script reads one JSON object on stdin (`name`,
 * `kbRoot`, the caller's `input`, and the capability's previous `state`) and
 * answers with one JSON object on stdout: either
 * `{ ok: true, result?, state?, artifacts? }` — artifacts are name/base64
 * pairs the *controller* writes under `.yantao/capabilities/<name>/`, so a
 * downloaded script never picks its own write paths — or
 * `{ ok: false, kind?, message, hint? }`, which surfaces verbatim.
 *
 * Every failure mode — a missing manifest, an escaping entry path, missing
 * Python, a timeout, garbage on stdout — becomes one {@link CapabilityError}
 * carrying a Chinese message and a Chinese hint (ADR-0006). The `spawn`
 * implementation is injectable, so tests exercise every branch without
 * Python ever being touched.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { SpawnLike } from '../open.ts'
import type { KbCapabilityArtifact as CapabilityArtifact } from '../types.ts'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'

/** What a resource may be applied to, as declared by the capability. */
export interface CapabilityAppliesTo {
  /** Resource suffixes (with dot, lowercase), e.g. `['.epub', '.pdf']`. */
  readonly resource?: readonly string[]
  /** Entity types the capability accepts, e.g. `['project']`. */
  readonly entity?: readonly string[]
  /** External sources the capability reads, e.g. `['mailbox']`. */
  readonly external?: readonly string[]
}

/** The `metadata.yantao` declaration that turns a skill directory into a capability. */
export interface CapabilityManifest {
  /** Entry script path, relative to the skill directory; must stay inside it. */
  readonly entry: string
  /** The only runtime in v1 (ADR-0021 取舍台账第 7 条). */
  readonly runtime: 'python'
  /** What the capability accepts; absent means "offered from the capability tab only". */
  readonly appliesTo?: CapabilityAppliesTo
}

/** Why a capability run failed; the UI picks its wording and its remedy from this. */
export type CapabilityErrorKind =
  | 'not-found'
  | 'bad-manifest'
  | 'python-missing'
  | 'timeout'
  | 'bad-output'
  | 'capability-failed'
  | 'other'

/**
 * A failed capability run. `kind` is machine-readable, `message` is what went
 * wrong, and `hint` is what the human can do about it.
 */
export class CapabilityError extends Error {
  /** Which failure this is. */
  readonly kind: CapabilityErrorKind

  /** What the human can do about it. */
  readonly hint: string

  /**
   * @param kind - which failure this is.
   * @param message - the Chinese message to show.
   * @param hint - the Chinese remedy to show alongside it.
   */
  constructor(kind: CapabilityErrorKind, message: string, hint: string) {
    super(message)
    this.name = 'CapabilityError'
    this.kind = kind
    this.hint = hint
  }
}

/** Chinese message per failure kind. */
const CAPABILITY_ERROR_MESSAGES: Readonly<Record<CapabilityErrorKind, string>> = {
  'not-found': '找不到这个能力。',
  'bad-manifest': '能力声明无效。',
  'python-missing': '无法启动 Python：找不到解释器。',
  timeout: '能力执行超时。',
  'bad-output': '能力脚本返回的不是预期的 JSON。',
  'capability-failed': '能力执行失败。',
  other: '能力执行失败。',
}

/** Chinese remedy per failure kind. */
export const CAPABILITY_HINTS: Readonly<Record<CapabilityErrorKind, string>> = {
  'not-found': '请确认能力目录还在已注册的技能目录下，且 SKILL.md 的 frontmatter 完好。',
  'bad-manifest': '请检查 SKILL.md 的 metadata.yantao 段：entry 指向目录内的 .py 脚本，runtime 为 python。',
  'python-missing': '请安装 Python 3（安装时勾选 Add to PATH）。',
  timeout: '任务可能过大，请重试一次。',
  'bad-output': '请检查能力的入口脚本：stdout 必须是一个 JSON 对象。',
  'capability-failed': '请按提示处理；问题出在能力本身，不是工作台。',
  other: '请查看服务端日志了解详情。',
}

/** Build the error for a failure kind. */
function fail(kind: CapabilityErrorKind, message?: string, hint?: string): CapabilityError {
  return new CapabilityError(kind, message ?? CAPABILITY_ERROR_MESSAGES[kind], hint ?? CAPABILITY_HINTS[kind])
}

/** Read and validate one skill definition's `metadata.yantao` declaration. */
export function manifestOf(definition: SkillDefinition): CapabilityManifest {
  const metadata = definition.metadata
  const declared = typeof metadata === 'object'
    ? (metadata as { yantao?: unknown }).yantao
    : undefined
  if (typeof declared !== 'object' || declared === null) {
    throw fail('bad-manifest', `能力「${definition.name}」的 SKILL.md 没有 metadata.yantao 声明。`)
  }
  const { entry, runtime, appliesTo } = declared as {
    entry?: unknown
    runtime?: unknown
    appliesTo?: unknown
  }
  if (typeof entry !== 'string' || entry === '') {
    throw fail('bad-manifest', `能力「${definition.name}」的声明缺少 entry。`, CAPABILITY_HINTS['bad-manifest'])
  }
  if (runtime !== 'python') {
    throw fail('bad-manifest', `能力「${definition.name}」的 runtime 只支持 python，声明的是 ${String(runtime)}。`)
  }
  return { entry, runtime, ...appliesTo !== undefined ? { appliesTo: appliesToOf(definition.name, appliesTo) } : {} }
}

/** Validate one `appliesTo` value; unknown shapes are refused, not coerced. */
function appliesToOf(name: string, value: unknown): CapabilityAppliesTo {
  if (typeof value !== 'object' || value === null) {
    throw fail('bad-manifest', `能力「${name}」的 appliesTo 必须是对象。`)
  }
  const { resource, entity, external } = value as Record<string, unknown>
  return {
    ...resource !== undefined ? { resource: suffixList(name, 'resource', resource) } : {},
    ...entity !== undefined ? { entity: stringList(name, 'entity', entity) } : {},
    ...external !== undefined ? { external: stringList(name, 'external', external) } : {},
  }
}

/** Validate a plain string list. */
function stringList(name: string, key: string, value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw fail('bad-manifest', `能力「${name}」的 appliesTo.${key} 必须是字符串数组。`)
  }
  return value as readonly string[]
}

/** Validate a suffix list: strings with a leading dot, lowercased. */
function suffixList(name: string, key: string, value: unknown): readonly string[] {
  const list = stringList(name, key, value)
  for (const suffix of list) {
    if (!suffix.startsWith('.')) {
      throw fail('bad-manifest', `能力「${name}」的 appliesTo.${key} 应写出带点的扩展名（如 ".epub"）：${suffix}`)
    }
  }
  return list.map(suffix => suffix.toLowerCase())
}

/**
 * Resolve one skill definition into a runnable capability: its manifest, the
 * skill directory it lives in, and the entry script's absolute path — which
 * must stay inside that directory, whatever the frontmatter says.
 * @param definition - the winning skill definition from `ctx.skills.get`.
 * @returns the manifest, the skill directory, and the entry's absolute path.
 */
export function resolveEntry(definition: SkillDefinition): {
  manifest: CapabilityManifest
  directory: string
  entryPath: string
} {
  if (definition.resourceBase?.kind !== 'directory') {
    throw fail('bad-manifest', `能力「${definition.name}」没有可执行的本地目录（远程或打包资源没有宿主入口）。`)
  }
  const manifest = manifestOf(definition)
  const directory = definition.resourceBase.path
  const entryPath = resolve(directory, manifest.entry)
  if (!entryPath.startsWith(resolve(directory) + sep)) {
    throw fail('bad-manifest', `能力「${definition.name}」的 entry 指向了能力目录之外：${manifest.entry}`)
  }
  if (!existsSync(entryPath)) {
    throw fail('bad-manifest', `能力「${definition.name}」的入口脚本不存在：${manifest.entry}`)
  }
  return { manifest, directory, entryPath }
}

/** One artifact the script asks the controller to write; the wire shape is `KbCapabilityArtifact`. */

/** What the entry script answers with on stdout when it succeeded. */
export interface CapabilityRunOutput {
  /** The capability's answer to its caller; opaque to the controller. */
  readonly result?: unknown
  /** The capability's next persisted state; omitted leaves the old one. */
  readonly state?: unknown
  /** Files to write under `.yantao/capabilities/<name>/`. */
  readonly artifacts?: readonly CapabilityArtifact[]
}

/** Options of {@link runCapability}. */
export interface RunCapabilityOptions {
  /** The capability's kebab-case name (echoed to the script). */
  readonly name: string
  /** Absolute path of the capability's skill directory. */
  readonly directory: string
  /** The entry script's absolute path. */
  readonly entryPath: string
  /** The live KB root, handed to the script for context. */
  readonly kbRoot: string
  /** The caller's input, handed to the script verbatim. */
  readonly input?: unknown
  /** The capability's previous persisted state, or null when it never ran. */
  readonly state?: unknown
  /** Python interpreter; defaults to `python` on Windows, `python3` elsewhere. */
  readonly python?: string
  /** The spawn to use; tests pass a fake so Python is never touched. */
  readonly spawn?: SpawnLike
  /** How long the script may run before it is killed; defaults to 300s. */
  readonly timeoutMs?: number
}

/** How long a capability may run before it is killed. */
export const CAPABILITY_TIMEOUT_MS = 300_000

/** How much stdout is kept before a runaway script is answered with `bad-output`. */
const MAX_STDOUT_BYTES = 64 * 1024 * 1024

/**
 * Run one capability's entry script — one subprocess call, no retries.
 * @param options - see {@link RunCapabilityOptions}.
 * @returns the script's output (result, next state, artifacts).
 */
export async function runCapability(options: RunCapabilityOptions): Promise<CapabilityRunOutput> {
  const {
    python = process.platform === 'win32' ? 'python' : 'python3',
    spawn: spawnImpl = spawn,
    timeoutMs = CAPABILITY_TIMEOUT_MS,
  } = options

  const child = spawnImpl(python, [options.entryPath], {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })

  const request = JSON.stringify({
    name: options.name,
    kbRoot: options.kbRoot,
    input: options.input ?? null,
    state: options.state ?? null,
  })

  return new Promise<CapabilityRunOutput>((resolveRun, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      settle(() => {
        child.kill()
        reject(fail('timeout'))
      })
    }, timeoutMs)

    /** End the run once; whatever the script does afterwards is ignored. */
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }

    child.stdin.on('error', () => {
      // A script that exits before reading stdin breaks the pipe; the close
      // handler reports the real failure, so this is only here to keep the
      // stream error from crashing the host.
    })
    child.stdin.end(request, 'utf8')

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (stdout.length <= MAX_STDOUT_BYTES) stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (stderr.length <= MAX_STDOUT_BYTES) stderr += String(chunk)
    })
    child.on('error', (error: Error) => {
      settle(() => {
        // ENOENT means the interpreter itself is not there.
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
        reject(missing ? fail('python-missing') : fail('other'))
      })
    })
    child.on('close', () => {
      settle(() => {
        let parsed: unknown
        try {
          parsed = JSON.parse(stdout)
        } catch {
          reject(fail('bad-output', `${CAPABILITY_ERROR_MESSAGES['bad-output']}${stderr.trim() === '' ? '' : `\n脚本输出：${stderr.trim().slice(0, 500)}`}`))
          return
        }
        if (typeof parsed !== 'object' || parsed === null) {
          reject(fail('bad-output'))
          return
        }
        const answer = parsed as {
          ok?: unknown
          result?: unknown
          state?: unknown
          artifacts?: unknown
          kind?: unknown
          message?: unknown
          hint?: unknown
        }
        if (answer.ok !== true) {
          const kind = typeof answer.kind === 'string' ? answer.kind : undefined
          const message = typeof answer.message === 'string' && answer.message !== ''
            ? answer.message
            : CAPABILITY_ERROR_MESSAGES['capability-failed']
          const hint = typeof answer.hint === 'string' ? answer.hint : undefined
          reject(fail('capability-failed', message, hint ?? (kind !== undefined ? `能力报告的失败类型：${kind}` : undefined)))
          return
        }
        resolveRun({
          ...answer.result !== undefined ? { result: answer.result } : {},
          ...answer.state !== undefined ? { state: answer.state } : {},
          ...answer.artifacts !== undefined ? { artifacts: artifactsOf(answer.artifacts, options.name, reject) } : {},
        })
      })
    })
  })
}

/** Validate one artifact list: bare names only, so a script cannot escape its directory. */
function artifactsOf(value: unknown, name: string, reject: (error: CapabilityError) => void): readonly CapabilityArtifact[] {
  if (!Array.isArray(value)) {
    reject(fail('bad-output', `能力「${name}」的 artifacts 必须是数组。`))
    return []
  }
  const artifacts: CapabilityArtifact[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      reject(fail('bad-output', `能力「${name}」的 artifacts 项必须是对象。`))
      return []
    }
    const { name: fileName, contentBase64 } = item as { name?: unknown; contentBase64?: unknown }
    if (typeof fileName !== 'string' || fileName === '' || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      reject(fail('bad-output', `能力「${name}」的 artifacts 项必须是纯文件名：${String(fileName)}`))
      return []
    }
    if (typeof contentBase64 !== 'string') {
      reject(fail('bad-output', `能力「${name}」的 artifacts 项缺少 base64 内容：${fileName}`))
      return []
    }
    artifacts.push({ name: fileName, contentBase64 })
  }
  return artifacts
}
