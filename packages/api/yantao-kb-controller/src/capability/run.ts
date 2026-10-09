/**
 * The builtin envelope-script machinery (ADR-0021), surviving ADR-0052's
 * execution unification in exactly one role: the **mail dedicated RPC**.
 * The generic "host spawns a declaration-speaking script" channel is
 * retired — every script execution goes through the exec bridge
 * (`capability/exec.ts`), and `kb_run_capability` returns SKILL.md
 * instructions only. What remains here is the subprocess contract the mail
 * panel's dedicated RPC drives (`mailRun`): one Python subprocess, one JSON
 * object in on stdin (`name`, `kbRoot`, `input`, `state`, `channel`), one
 * JSON object back on stdout — `{ok: true, result?, state?, artifacts?}` or
 * `{ok: false, kind, message, hint?}`.
 *
 * The shared vocabulary also lives here: `CapabilityError` (every failure
 * mode becomes one error with a Chinese message and hint, ADR-0006), the
 * reach types (`CapabilityInvoker`, `CapabilityAppliesTo`) the routing file
 * validates, and the observable run envelope (`CapabilityExec`, ADR-0044
 * 决定 6) the 提炼经验 gesture mines. The `spawn` implementation is
 * injectable, so tests exercise every branch without Python ever being
 * touched.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability
 */
import { spawn } from 'node:child_process'
import type { SpawnLike } from '../open.ts'
import type { KbCapabilityArtifact as CapabilityArtifact } from '../types.ts'

/** What a resource may be applied to, as recorded in the capability's route entry. */
export interface CapabilityAppliesTo {
  /**
   * Resource suffixes (with dot, lowercase), e.g. `['.epub', '.pdf']` — or
   * `true` for *every* resource (ADR-0025 决定 4's registration shortcut:
   * a third-party skill speaks for itself, the menu need not filter).
   */
  readonly resource?: readonly string[] | boolean
  /** Entity types the capability accepts, e.g. `['project']`. */
  readonly entity?: readonly string[]
  /** External sources the capability reads, e.g. `['mailbox']`. */
  readonly external?: readonly string[]
  /**
   * Opt into the selection right-click menu (ADR-0025 决定 5): only declared
   * instruction capabilities appear there — the menu must not grow with every
   * capability that has no better idea than bare text.
   */
  readonly selection?: boolean
}

/** Who may invoke a capability (ADR-0023 决定 2): the 能力 tab, the agent's `kb_run_capability`, or both. */
export type CapabilityInvoker = 'human' | 'agent'

/** Why a capability run failed; the UI picks its wording and its remedy from this. */
export type CapabilityErrorKind =
  | 'not-found'
  | 'bad-manifest'
  | 'not-invocable'
  | 'python-missing'
  | 'timeout'
  | 'cancelled'
  | 'bad-output'
  | 'capability-failed'
  | 'other'

/**
 * The observable envelope of one capability run (ADR-0044 决定 6): what the
 * UI's 提炼经验 gesture feeds its distiller. Captured by the host around the
 * subprocess — the distiller never sees more than this, and a plain run
 * (clean exit, empty tails) gives the distiller nothing to mine.
 */
export interface CapabilityExec {
  /** The command line the host ran (interpreter + entry script). */
  readonly command: string
  /** The process exit code; null when the host killed it or the spawn failed. */
  readonly exitCode: number | null
  /** Wall-clock duration of the run, milliseconds. */
  readonly durationMs: number
  /** The last characters of stdout (capped at {@link EXEC_TAIL_CHARS}). */
  readonly stdoutTail: string
  /** The last characters of stderr (capped at {@link EXEC_TAIL_CHARS}). */
  readonly stderrTail: string
}

/** How much of each stream the envelope keeps — a tail, not a transcript. */
export const EXEC_TAIL_CHARS = 2000

/**
 * A failed capability run. `kind` is machine-readable, `message` is what went
 * wrong, and `hint` is what the human can do about it.
 */
export class CapabilityError extends Error {
  /** Which failure this is. */
  readonly kind: CapabilityErrorKind

  /** What the human can do about it. */
  readonly hint: string

  /** The run's observable envelope at the moment of failure, when one was captured. */
  readonly exec?: CapabilityExec | undefined

  /**
   * @param kind - which failure this is.
   * @param message - the Chinese message to show.
   * @param hint - the Chinese remedy to show alongside it.
   * @param exec - the run's envelope, when the failure happened mid-subprocess.
   */
  constructor(kind: CapabilityErrorKind, message: string, hint: string, exec?: CapabilityExec) {
    super(message)
    this.name = 'CapabilityError'
    this.kind = kind
    this.hint = hint
    this.exec = exec
  }
}

/** Chinese message per failure kind. */
const CAPABILITY_ERROR_MESSAGES: Readonly<Record<CapabilityErrorKind, string>> = {
  'not-found': '找不到这个能力。',
  'bad-manifest': '能力声明无效。',
  'not-invocable': '这个能力没有对 agent 开放。',
  'python-missing': '无法启动 Python：找不到解释器。',
  timeout: '能力执行超时。',
  cancelled: '能力执行已取消。',
  'bad-output': '能力脚本返回的不是预期的 JSON。',
  'capability-failed': '能力执行失败。',
  other: '能力执行失败。',
}

/** Chinese remedy per failure kind. */
export const CAPABILITY_HINTS: Readonly<Record<CapabilityErrorKind, string>> = {
  'not-found': '请确认能力已注册在中央路由文件 .dsh/skills/yantao.json 中，且技能目录还在。',
  'bad-manifest': '请检查中央路由文件 .dsh/skills/yantao.json：条目形如 {path, invocation, appliesTo}。',
  'not-invocable': '请在能力详情页勾选「允许 agent 调用」，或手动在中央路由文件的 invocation 里加入 "agent"。',
  'python-missing': '请安装 Python 3（安装时勾选 Add to PATH）。',
  timeout: '任务可能过大，请重试一次。',
  cancelled: '本次执行已按要求停止；已经落地的部分不受影响。',
  'bad-output': '请检查能力的入口脚本：stdout 必须是一个 JSON 对象。',
  'capability-failed': '请按提示处理；问题出在能力本身，不是工作台。',
  other: '请查看服务端日志了解详情。',
}

/** Build the error for a failure kind, carrying the run's envelope when captured. */
function fail(kind: CapabilityErrorKind, message?: string, hint?: string, exec?: CapabilityExec): CapabilityError {
  return new CapabilityError(kind, message ?? CAPABILITY_ERROR_MESSAGES[kind], hint ?? CAPABILITY_HINTS[kind], exec)
}

/**
 * Validate one `invocation` value (ADR-0023 决定 2): a non-empty array drawn
 * from `human`/`agent`; absent defaults to `['human']` — undeclared means the
 * agent never sees the capability. Shared by the routing file's reader.
 */
export function invocationOf(name: string, value: unknown): readonly CapabilityInvoker[] {
  if (value === undefined) return ['human']
  if (!Array.isArray(value) || value.length === 0 || value.some(item => item !== 'human' && item !== 'agent')) {
    throw fail('bad-manifest', `能力「${name}」的 invocation 必须是由 "human" 和/或 "agent" 组成的非空数组。`)
  }
  return value as readonly CapabilityInvoker[]
}

/** Validate one `appliesTo` value; unknown shapes are refused, not coerced. Shared by the routing file's reader. */
export function appliesToOf(name: string, value: unknown): CapabilityAppliesTo {
  if (typeof value !== 'object' || value === null) {
    throw fail('bad-manifest', `能力「${name}」的 appliesTo 必须是对象。`)
  }
  const { resource, entity, external, selection } = value as Record<string, unknown>
  if (selection !== undefined && typeof selection !== 'boolean') {
    throw fail('bad-manifest', `能力「${name}」的 appliesTo.selection 必须是布尔值。`)
  }
  return {
    ...resource !== undefined ? { resource: resourceOf(name, resource) } : {},
    ...entity !== undefined ? { entity: stringList(name, 'entity', entity) } : {},
    ...external !== undefined ? { external: stringList(name, 'external', external) } : {},
    ...selection !== undefined ? { selection } : {},
  }
}

/** Validate one `appliesTo.resource`: `true` (every resource) or a suffix list. */
function resourceOf(name: string, value: unknown): readonly string[] | boolean {
  if (value === true) return true
  return suffixList(name, 'resource', value)
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

/** One artifact the script asks the controller to write; the wire shape is `KbCapabilityArtifact`. */

/** What the entry script answers with on stdout when it succeeded. */
export interface CapabilityRunOutput {
  /** The capability's answer to its caller; opaque to the controller. */
  readonly result?: unknown
  /** The capability's next persisted state; omitted leaves the old one. */
  readonly state?: unknown
  /** Files to write under `.dsh/yantao/capabilities/<name>/`. */
  readonly artifacts?: readonly CapabilityArtifact[]
  /** The run's observable envelope (ADR-0044 决定 6), for the human channel's distill gesture. */
  readonly exec?: CapabilityExec
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
  /**
   * Which channel is calling, injected into the request envelope by the host
   * (ADR-0034 决定 5). Unlike `input` — the caller's own words, forgeable —
   * this is the controller's testimony, and it is what a privileged verb
   * (the mail capability's delete) checks before it will run. Required: a
   * silent absence would read as least-privileged to a careful script but as
   * an unforgeable human stamp to a naive one — the host always knows which
   * channel it is, so it always says so.
   */
  readonly channel: 'human' | 'agent'
  /** The capability's previous persisted state, or null when it never ran. */
  readonly state?: unknown
  /** Python interpreter; defaults to `python` on Windows, `python3` elsewhere. */
  readonly python?: string
  /** The spawn to use; tests pass a fake so Python is never touched. */
  readonly spawn?: SpawnLike
  /** How long the script may run before it is killed; defaults to 300s. */
  readonly timeoutMs?: number
  /**
   * Abort the run from outside (ADR-0031): the human's cancel trips the
   * signal, the child is killed, and the run rejects with the `cancelled`
   * kind — the caller's own signal is the witness that it asked for this.
   */
  readonly signal?: AbortSignal
}

/** How long a capability may run before it is killed. */
export const CAPABILITY_TIMEOUT_MS = 300_000

/** How much stdout is kept before a runaway script is answered with `bad-output`. */
const MAX_STDOUT_BYTES = 64 * 1024 * 1024

/**
 * Run the mail capability's entry script (ADR-0052 决定 5: the one survivor
 * of the execution unification) — one subprocess call, no retries.
 * @param options - see {@link RunCapabilityOptions}.
 * @returns the script's output (result, next state, artifacts).
 */
export async function runCapability(options: RunCapabilityOptions): Promise<CapabilityRunOutput> {
  const {
    python = process.platform === 'win32' ? 'python' : 'python3',
    spawn: spawnImpl = spawn,
    timeoutMs = CAPABILITY_TIMEOUT_MS,
  } = options

  // The observable envelope (ADR-0044 决定 6): wall clock starts before the
  // spawn; `execOf` below freezes the tail state at each settle site.
  const startedAt = Date.now()
  const command = `${python} ${options.entryPath}`

  const child = spawnImpl(python, [options.entryPath], {
    windowsHide: true,
    // The frozen envelope contract (ADR-0043 决定 8): the declared channel
    // delivers the same environment the exec bridge does, so a script reads
    // one contract regardless of how it was invoked.
    env: {
      ...process.env,
      KB_ROOT: options.kbRoot,
      CAPABILITY_NAME: options.name,
      CAPABILITY_CHANNEL: options.channel,
      PYTHONIOENCODING: 'utf-8',
    },
  })

  const request = JSON.stringify({
    name: options.name,
    kbRoot: options.kbRoot,
    input: options.input ?? null,
    state: options.state ?? null,
    channel: options.channel,
  })

  return new Promise<CapabilityRunOutput>((resolveRun, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    /** Freeze the streams' current tail state into the run's envelope. */
    const execOf = (exitCode: number | null): CapabilityExec => ({
      command,
      exitCode,
      durationMs: Date.now() - startedAt,
      stdoutTail: stdout.length > EXEC_TAIL_CHARS ? stdout.slice(-EXEC_TAIL_CHARS) : stdout,
      stderrTail: stderr.length > EXEC_TAIL_CHARS ? stderr.slice(-EXEC_TAIL_CHARS) : stderr,
    })

    const timer = setTimeout(() => {
      settle(() => {
        child.kill()
        reject(fail('timeout', undefined, undefined, execOf(null)))
      })
    }, timeoutMs)

    /** End the run once; whatever the script does afterwards is ignored. */
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }

    // Cancellation (ADR-0031): an aborted signal kills the child and rejects
    // with the `cancelled` kind. The listener stays for the run's lifetime;
    // after settle it is inert (kill on an exited child, reject on a settled
    // promise are both no-ops), and the signal dies with the run.
    const onAbort = (): void => {
      settle(() => {
        child.kill()
        reject(fail('cancelled', undefined, undefined, execOf(null)))
      })
    }
    if (options.signal !== undefined) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
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
        reject(missing ? fail('python-missing', undefined, undefined, execOf(null)) : fail('other', undefined, undefined, execOf(null)))
      })
    })
    child.on('close', () => {
      settle(() => {
        // One envelope per settle: every consumer below shares the same
        // sampled timestamp and stream tails instead of each `execOf` call
        // drifting apart.
        const exec = execOf(child.exitCode)
        let parsed: unknown
        try {
          parsed = JSON.parse(stdout)
        } catch {
          reject(fail('bad-output', `${CAPABILITY_ERROR_MESSAGES['bad-output']}${stderr.trim() === '' ? '' : `\n脚本输出：${stderr.trim().slice(0, 500)}`}`, undefined, exec))
          return
        }
        if (typeof parsed !== 'object' || parsed === null) {
          reject(fail('bad-output', undefined, undefined, exec))
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
          reject(fail('capability-failed', message, hint ?? (kind !== undefined ? `能力报告的失败类型：${kind}` : undefined), exec))
          return
        }
        resolveRun({
          ...answer.result !== undefined ? { result: answer.result } : {},
          ...answer.state !== undefined ? { state: answer.state } : {},
          ...answer.artifacts !== undefined
            ? { artifacts: artifactsOf(answer.artifacts, options.name, exec, reject) }
            : {},
          exec,
        })
      })
    })
  })
}

/**
 * Validate one artifact list: bare names only, so a script cannot escape its
 * directory. Every rejection carries the run's envelope like every other
 * failure path — a validation-rejected run must stay distillable too.
 */
function artifactsOf(
  value: unknown,
  name: string,
  exec: CapabilityExec,
  reject: (error: CapabilityError) => void,
): readonly CapabilityArtifact[] {
  if (!Array.isArray(value)) {
    reject(fail('bad-output', `能力「${name}」的 artifacts 必须是数组。`, undefined, exec))
    return []
  }
  const artifacts: CapabilityArtifact[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      reject(fail('bad-output', `能力「${name}」的 artifacts 项必须是对象。`, undefined, exec))
      return []
    }
    const { name: fileName, contentBase64 } = item as { name?: unknown; contentBase64?: unknown }
    if (typeof fileName !== 'string' || fileName === '' || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      reject(fail('bad-output', `能力「${name}」的 artifacts 项必须是纯文件名：${String(fileName)}`, undefined, exec))
      return []
    }
    if (typeof contentBase64 !== 'string') {
      reject(fail('bad-output', `能力「${name}」的 artifacts 项缺少 base64 内容：${fileName}`, undefined, exec))
      return []
    }
    artifacts.push({ name: fileName, contentBase64 })
  }
  return artifacts
}
