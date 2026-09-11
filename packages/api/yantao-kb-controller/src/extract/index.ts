/**
 * Extract a resource document's text: one subprocess call, one JSON object
 * back.
 *
 * Reading pdf/epub/doc/docx/ppt/pptx has no Node library worth its supply
 * chain, but the machine already runs Python with Office COM (the mail
 * connector's precedent, ADR-0019) — so the extractor is a Python script
 * (`extract.py`, ADR-0020) that turns one file into plain text. This module
 * owns the contract between the two: it builds the argv, runs the script with
 * a hidden window and UTF-8 pipes, and turns every failure mode — missing
 * Python, a missing per-format library, a scanned PDF with no text layer, an
 * encrypted file, a timeout, garbage on stdout — into one {@link ExtractError}
 * carrying a Chinese message and a Chinese hint (ADR-0006).
 *
 * The `spawn` implementation is injectable, so tests exercise every branch
 * without Python ever being touched.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/extract
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SpawnLike } from '../open.ts'

/** What the extractor answers with on stdout. */
export interface ExtractResult {
  /** The document's plain text, `\n`-normalized. */
  readonly text: string
  /** Self-describing metadata, cached beside the text by the caller. */
  readonly meta: {
    /** The format that was extracted. */
    readonly format: string
    /** The extract's character count. */
    readonly chars: number
  }
}

/** Why an extraction failed; the UI picks its wording and its remedy from this. */
export type ExtractErrorKind =
  | 'python-missing'
  | 'lib-missing'
  | 'no-text'
  | 'unreadable'
  | 'input-missing'
  | 'doc-unavailable'
  | 'unsupported'
  | 'timeout'
  | 'bad-output'
  | 'other'

/**
 * A failed extraction. `kind` is machine-readable, `message` is what went
 * wrong, and `hint` is what the human can do about it.
 */
export class ExtractError extends Error {
  /** Which failure this is. */
  readonly kind: ExtractErrorKind

  /** What the human can do about it. */
  readonly hint: string

  /**
   * @param kind - which failure this is.
   * @param message - the Chinese message to show.
   * @param hint - the Chinese remedy to show alongside it.
   */
  constructor(kind: ExtractErrorKind, message: string, hint: string) {
    super(message)
    this.name = 'ExtractError'
    this.kind = kind
    this.hint = hint
  }
}

/** Options of {@link extractText}. */
export interface ExtractTextOptions {
  /** The document format; the caller derives it from the file's suffix. */
  readonly format: string
  /** Absolute path of the document to extract. */
  readonly input: string
  /** Python interpreter to run; defaults to `python` on Windows, `python3` elsewhere. */
  readonly python?: string
  /** The spawn to use; tests pass a fake so Python is never touched. */
  readonly spawn?: SpawnLike
  /** How long the script may run before it is killed; defaults to 300s — books are big. */
  readonly timeoutMs?: number
}

/** Chinese message per failure kind. */
const EXTRACT_ERROR_MESSAGES: Readonly<Record<ExtractErrorKind, string>> = {
  'python-missing': '无法启动 Python：找不到解释器。',
  'lib-missing': '缺少该格式所需的 Python 库。',
  'no-text': '这份文档没有可抽取的文字层（可能是扫描版）。',
  unreadable: '文档已加密或已损坏，无法读取。',
  'input-missing': '找不到要抽取的文件。',
  'doc-unavailable': '无法通过 Office 读取这份老格式文档。',
  unsupported: '不支持抽取这种格式。',
  timeout: '抽取文档文本超时。',
  'bad-output': '抽取脚本返回的不是预期的 JSON。',
  other: '抽取文档文本失败。',
}

/** Chinese remedy per failure kind; the controller reuses it for its own refusals. */
export const EXTRACT_HINTS: Readonly<Record<ExtractErrorKind, string>> = {
  'python-missing': '请安装 Python 3（安装时勾选 Add to PATH）。',
  'lib-missing': '请按格式安装对应库：pip install pypdf / ebooklib / python-docx / python-pptx / pywin32。',
  'no-text': '扫描版需要 OCR，当前版本不支持；可换一份文字版的文件。',
  unreadable: '请先解除加密，或换一份完好的文件。',
  'input-missing': '请确认资源文件还在知识库的 resources/ 下。',
  'doc-unavailable': '请确认已安装 Word / PowerPoint 桌面版；或先把文件另存为 .docx / .pptx。',
  unsupported: '目前支持 txt / md / pdf / epub / doc / docx / ppt / pptx。',
  timeout: '文档可能过大，请重试一次。',
  'bad-output': '请确认 extract.py 与工作台版本匹配。',
  other: '请查看服务端日志了解详情。',
}

/** Kinds the Python side is allowed to name on stderr. */
const PYTHON_KINDS: readonly ExtractErrorKind[] = [
  'lib-missing', 'no-text', 'unreadable', 'input-missing', 'doc-unavailable', 'other',
]

/** How long the script may run before it is killed: books are big. */
export const EXTRACT_TIMEOUT_MS = 300_000

/**
 * How much stdout is kept. A book's plain text is megabytes, not bytes, so the
 * cap is generous — but the cap is applied while accumulating, so a runaway
 * script is answered with `bad-output` rather than with an out-of-memory host.
 */
const MAX_STDOUT_BYTES = 64 * 1024 * 1024

/**
 * Where `extract.py` lives. The module runs from `src/extract/` under vitest
 * and from `lib/types/extract/` once built, so both are tried in order.
 * @returns the path of the existing script, or the source-tree path as a fallback.
 */
function scriptPath(): string {
  const fallback = new URL('./extract.py', import.meta.url)
  const candidates = [fallback, new URL('../../../src/extract/extract.py', import.meta.url)]
  const found = candidates.find(candidate => existsSync(fileURLToPath(candidate)))
  return fileURLToPath(found ?? fallback)
}

/**
 * The arguments to pass to `extract.py`.
 * @param format - the document format.
 * @param input - absolute path of the document.
 * @returns the argument vector, script path included.
 */
export function extractArgs(format: string, input: string): readonly string[] {
  return [scriptPath(), '--format', format, '--input', input]
}

/** Build the error for a failure kind. */
function fail(kind: ExtractErrorKind): ExtractError {
  return new ExtractError(kind, EXTRACT_ERROR_MESSAGES[kind], EXTRACT_HINTS[kind])
}

/**
 * The kind the script reported on stderr, when it reported one.
 * @param stderr - everything the script wrote to stderr.
 * @returns the kind, or undefined when stderr is not one of our error objects.
 */
function kindFromStderr(stderr: string): ExtractErrorKind | undefined {
  try {
    const parsed: unknown = JSON.parse(stderr)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const kind = (parsed as { kind?: unknown }).kind
    if (typeof kind !== 'string') return undefined
    return (PYTHON_KINDS as readonly string[]).includes(kind) ? kind as ExtractErrorKind : undefined
  } catch {
    return undefined
  }
}

/**
 * Extract one document's text by running the Python script on it.
 *
 * Resolves with the text and its self-describing metadata, or rejects with an
 * {@link ExtractError}.
 * @param options - the format and input path, and optionally a Python
 *   interpreter, a timeout, or a stand-in spawn.
 * @returns the extract and its metadata.
 */
export async function extractText(options: ExtractTextOptions): Promise<ExtractResult> {
  const {
    format, input,
    python = process.platform === 'win32' ? 'python' : 'python3',
    spawn: spawnImpl = spawn,
    timeoutMs = EXTRACT_TIMEOUT_MS,
  } = options

  const child = spawnImpl(python, [...extractArgs(format, input)], {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })

  return new Promise<ExtractResult>((resolve, reject) => {
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

    /** End the extraction once; whatever the script does afterwards is ignored. */
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
        if (code !== 0) {
          reject(fail(kindFromStderr(stderr) ?? 'other'))
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(stdout)
        } catch {
          reject(fail('bad-output'))
          return
        }
        if (
          typeof parsed !== 'object' || parsed === null
          || typeof (parsed as { text?: unknown }).text !== 'string'
        ) {
          reject(fail('bad-output'))
          return
        }
        const { text, meta } = parsed as { text: string; meta?: unknown }
        if (
          typeof meta !== 'object' || meta === null
          || typeof (meta as { chars?: unknown }).chars !== 'number'
        ) {
          reject(fail('bad-output'))
          return
        }
        resolve({ text, meta: { format, chars: (meta as { chars: number }).chars } })
      })
    })
  })
}
