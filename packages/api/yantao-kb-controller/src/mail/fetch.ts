/**
 * Read the human's Outlook mail: one subprocess call, one JSON array back.
 *
 * There is no Node COM bridge worth trusting for this, and Graph+OAuth would
 * mean tenant consent for what is a local, personal read — so the reader is a
 * Python script (`read_outlook.py`, ADR-0019) that attaches to the already
 * logged-in Outlook profile through pywin32. This module owns the contract between the
 * two: it builds the argv, runs the script with a hidden window and UTF-8
 * pipes, and turns every failure mode — missing Python, Outlook not running,
 * a folder that is not there, a timeout, garbage on stdout — into one
 * {@link MailFetchError} carrying a Chinese message and a Chinese hint
 * (ADR-0006).
 *
 * The `spawn` implementation is injectable, so tests exercise every branch
 * without Outlook ever being touched.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/mail/fetch
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SpawnLike } from '../open.ts'

/** One mail as the reader reports it. */
export interface MailMessage {
  /** Stable dedup key: `sha1("receivedAt|senderAddress|subject")`. */
  readonly id: string
  /** Outlook's MAPI EntryID; useful for follow-up work, never as a primary key. */
  readonly entryId: string
  /** Reception time as an ISO 8601 string, normalized to UTC. */
  readonly receivedAt: string
  /** The sender's display name. */
  readonly senderName: string
  /** The sender's address as Outlook reports it. */
  readonly senderAddress: string
  /** Subject line, empty when the mail has none. */
  readonly subject: string
  /** Plain text body, at most 3000 characters. */
  readonly body: string
  /** True when `body` was cut at the 3000-character limit. */
  readonly truncated: boolean
}

/** Why a fetch failed; the UI picks its wording and its remedy from this. */
export type MailFetchErrorKind =
  | 'python-missing'
  | 'outlook-unavailable'
  | 'folder-missing'
  | 'timeout'
  | 'bad-output'
  | 'other'

/**
 * A failed mail fetch. `kind` is machine-readable, `message` is what went
 * wrong, and `hint` is what the human can do about it.
 */
export class MailFetchError extends Error {
  /** Which failure this is. */
  readonly kind: MailFetchErrorKind

  /** What the human can do about it. */
  readonly hint: string

  /**
   * @param kind - which failure this is.
   * @param message - the Chinese message to show.
   * @param hint - the Chinese remedy to show alongside it.
   */
  constructor(kind: MailFetchErrorKind, message: string, hint: string) {
    super(message)
    this.name = 'MailFetchError'
    this.kind = kind
    this.hint = hint
  }
}

/**
 * What {@link mailArgs} needs: the parts of {@link FetchMailOptions} that turn
 * into arguments. `folder` may be present-but-undefined, which is what
 * {@link fetchMail} has after destructuring its own options.
 */
export interface MailArgsOptions {
  /** Lower bound (exclusive) on reception time, as an ISO 8601 string. */
  readonly since: string
  /** How many of the newest mails to return; the script defaults to 50. */
  readonly limit?: number | undefined
  /** Outlook folder name to read instead of the default inbox. */
  readonly folder?: string | undefined
}

/** Options of {@link fetchMail}. */
export interface FetchMailOptions extends MailArgsOptions {
  /** Python interpreter to run; defaults to `python` on Windows, `python3` elsewhere. */
  readonly python?: string
  /** The spawn to use; tests pass a fake so Outlook is never touched. */
  readonly spawn?: SpawnLike
  /** How long the script may run before it is killed; defaults to 120s. */
  readonly timeoutMs?: number
}

/** Chinese message per failure kind. */
const MAIL_ERROR_MESSAGES: Readonly<Record<MailFetchErrorKind, string>> = {
  'python-missing': '无法启动 Python：找不到解释器，或缺少 pywin32。',
  'outlook-unavailable': '无法连接 Outlook：COM/MAPI 接口不可用。',
  'folder-missing': '找不到指定的邮件文件夹。',
  timeout: '读取 Outlook 邮件超时。',
  'bad-output': '邮件读取脚本返回的不是预期的 JSON 数组。',
  other: '读取 Outlook 邮件失败。',
}

/** Chinese remedy per failure kind. */
const MAIL_ERROR_HINTS: Readonly<Record<MailFetchErrorKind, string>> = {
  'python-missing': '请安装 Python 3（安装时勾选 Add to PATH）并执行 pip install pywin32；'
    + 'Python 的位数必须与 Office 一致（64 位 Office 配 64 位 Python）。',
  'outlook-unavailable': '经典 Outlook 桌面版必须已启动并配置好 profile；'
    + '“新版 Outlook”没有 COM 接口，无法读取。',
  'folder-missing': '请确认文件夹名称与 Outlook 中显示的名称完全一致。',
  timeout: '可以缩小时间范围或减少 limit 后重试。',
  'bad-output': '请确认 read_outlook.py 与工作台版本匹配。',
  other: '请查看服务端日志了解详情。',
}

/** Kinds the Python side is allowed to name on stderr. */
const PYTHON_KINDS: readonly MailFetchErrorKind[] = ['python-missing', 'outlook-unavailable', 'folder-missing', 'other']

/** How long the script may run before it is killed. */
export const MAIL_TIMEOUT_MS = 120_000

/**
 * How much stdout is kept. `spawn` has no `maxBuffer` (that is `exec`'s), so
 * the cap is applied while accumulating: a runaway script is answered with
 * `bad-output` rather than with an out-of-memory host.
 */
const MAX_STDOUT_BYTES = 32 * 1024 * 1024

/**
 * Where `read_outlook.py` lives. The module runs from `src/mail/` under vitest
 * and from `lib/types/mail/` once built, so both are tried in order.
 * @returns the path of the existing script, or the source-tree path as a fallback.
 */
function scriptPath(): string {
  const fallback = new URL('./read_outlook.py', import.meta.url)
  const candidates = [fallback, new URL('../../../src/mail/read_outlook.py', import.meta.url)]
  const found = candidates.find(candidate => existsSync(fileURLToPath(candidate)))
  return fileURLToPath(found ?? fallback)
}

/**
 * The arguments to pass to `read_outlook.py`.
 * @param options - the same options {@link fetchMail} takes.
 * @returns the argument vector, script path included.
 */
export function mailArgs(options: MailArgsOptions): readonly string[] {
  const args = [scriptPath(), '--since', options.since, '--limit', String(options.limit ?? 50), '--json']
  if (options.folder !== undefined && options.folder !== '') args.push('--folder', options.folder)
  return args
}

/** Build the error for a failure kind. */
function fail(kind: MailFetchErrorKind): MailFetchError {
  return new MailFetchError(kind, MAIL_ERROR_MESSAGES[kind], MAIL_ERROR_HINTS[kind])
}

/**
 * The kind the script reported on stderr, when it reported one.
 * @param stderr - everything the script wrote to stderr.
 * @returns the kind, or undefined when stderr is not one of our error objects.
 */
function kindFromStderr(stderr: string): MailFetchErrorKind | undefined {
  try {
    const parsed: unknown = JSON.parse(stderr)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const kind = (parsed as { kind?: unknown }).kind
    if (typeof kind !== 'string') return undefined
    return (PYTHON_KINDS as readonly string[]).includes(kind) ? kind as MailFetchErrorKind : undefined
  } catch {
    return undefined
  }
}

/**
 * Fetch the newest mails received after `since`.
 *
 * Resolves with the mails the script printed (newest first, as Outlook sorts
 * them), or rejects with a {@link MailFetchError}.
 * @param options - the time bound, and optionally a cap, a folder, a Python
 *   interpreter, a timeout, or a stand-in spawn.
 * @returns the mails, newest first.
 */
export async function fetchMail(options: FetchMailOptions): Promise<MailMessage[]> {
  const {
    since, limit, folder,
    python = process.platform === 'win32' ? 'python' : 'python3',
    spawn: spawnImpl = spawn,
    timeoutMs = MAIL_TIMEOUT_MS,
  } = options

  const args = mailArgs({ since, limit, folder })
  const child = spawnImpl(python, args, {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })

  return new Promise<MailMessage[]>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    // Declared before `settle` uses it; the callback only ever runs later.
    const timer = setTimeout(() => {
      settle(() => {
        child.kill()
        reject(fail('timeout'))
      })
    }, timeoutMs)

    /** End the fetch once; whatever the script does afterwards is ignored. */
    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }

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
    child.on('close', (code: number | null) => {
      settle(() => {
        if (code === 0) {
          let parsed: unknown
          try {
            parsed = JSON.parse(stdout)
          } catch {
            reject(fail('bad-output'))
            return
          }
          if (!Array.isArray(parsed)) {
            reject(fail('bad-output'))
            return
          }
          resolve(parsed as MailMessage[])
          return
        }
        const kind = kindFromStderr(stderr)
        reject(fail(kind ?? 'other'))
      })
    })
  })
}
