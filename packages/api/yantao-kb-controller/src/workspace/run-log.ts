/**
 * The distilled process log of one workspace run (ADR-0056 附：运行可观测性).
 *
 * One file per run at `<kbRoot>/sessions/workspace/<runId>.log` — the KB's
 * `sessions/` is the archive zone (「流水」区只追加、不改写), so a run's
 * process trail belongs beside the archived sessions: browsable in the
 * resource tree, openable in any editor, and reachable from the run history's
 * 查看 button through the plain read-only file tab (no new RPC).
 *
 * Content is DISTILLED HUMAN TEXT, not the raw event stream (2026-10-13
 * 裁决): step separators, the agent's prose verbatim, one line per tool
 * call. Forensic depth lives in codebuddy's own session journal — the run
 * row already records each step's `sessionId`. Unknown event shapes degrade
 * to a one-line JSON glimpse; nothing throws.
 *
 * The writer is strictly fire-and-forget: every write funnels through a
 * serial promise queue, a failed append marks the writer broken (one
 * console.warn, then silence) and NEVER propagates into the chain — a log
 * failure must not fail a run. A soft byte cap stops the append and leaves
 * a marker, which is what keeps the read-side whole-file load bounded.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/workspace/run-log
 */

import { appendFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readWorkspaceRuns, WORKSPACE_RUN_LOG_DIR } from '@deepseek-ai/dsh-yantao-kb'

/** Soft ceiling on one log file; past it the writer stops with a marker line. */
const MAX_LOG_BYTES = 8 * 1024 * 1024

/** Line-budget clips: tool inputs stay terse, tool results a bit fuller. */
const TOOL_INPUT_CLIP = 160
const TOOL_RESULT_CLIP = 200
const UNKNOWN_EVENT_CLIP = 120

/** Fire-and-forget appender with a byte cap: broken writers go silent. */
export class RunLogWriter {
  private queue: Promise<void>
  private bytes = 0
  private broken = false

  constructor(private readonly path: string) {
    this.queue = Promise.resolve()
  }

  /** First write: create the file with the run's header line. */
  open(header: string): void {
    this.bytes = Buffer.byteLength(header, 'utf8')
    this.enqueue(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(this.path, `${header}\n\n`, 'utf8')
    })
  }

  /** One step's opening rule: `──── 第 N 步 · clock · resume sess ────`. */
  stepHeader(index: number, resumeSessionId: string | undefined): void {
    const parts = [`第 ${index + 1} 步`, wallClock().slice(11)]
    if (resumeSessionId !== undefined) parts.push(`resume ${resumeSessionId}`)
    this.line(`\n──── ${parts.join(' · ')} ────`)
  }

  /** One parsed stdout event, distilled to lines; unrecognized shapes degrade. */
  event(event: unknown): void {
    const text = summarizeEvent(event)
    if (text !== '') this.line(text)
  }

  /** stderr rides in prefixed — it is diagnostics, not agent output. */
  stderr(chunk: string): void {
    for (const raw of chunk.split('\n')) {
      const line = raw.trim()
      if (line !== '') this.line(`! ${line}`)
    }
  }

  /** A raw line (terminal verdicts); queued like everything else. */
  line(text: string): void {
    if (this.broken) return
    this.bytes += Buffer.byteLength(text, 'utf8') + 1
    if (this.bytes > MAX_LOG_BYTES) {
      this.broken = true
      this.appendRaw('\n（日志已达上限，后续省略）\n')
      return
    }
    this.appendRaw(text)
  }

  /** Await the write queue — tests use this; the runtime fire-and-forgets. */
  settled(): Promise<void> {
    return this.queue
  }

  /** Serialize one write behind everything already queued — each assignment
      chains off the previous tail, which is what makes the queue serial. */
  private enqueue(write: () => Promise<void>): void {
    this.queue = this.queue.then(write).catch(() => { this.fail() })
  }

  private appendRaw(text: string): void {
    const suffix = text.endsWith('\n') ? text : `${text}\n`
    this.enqueue(() => appendFile(this.path, suffix))
  }

  private fail(): void {
    if (this.broken) return
    this.broken = true
    console.warn(`workspace run log ${this.path} stopped receiving writes`)
  }
}

/** Delete orphaned run logs: files whose run id left the history ring. */
export async function pruneOrphanRunLogs(kbRoot: string): Promise<void> {
  const dir = join(kbRoot, WORKSPACE_RUN_LOG_DIR)
  const entries = await readdir(dir).catch(() => undefined)
  if (entries === undefined || entries.length === 0) return
  const runs = await readWorkspaceRuns(kbRoot).catch(() => undefined)
  if (runs === undefined) return
  const alive = new Set(runs.map(run => run.id))
  await Promise.all(entries
    .filter(name => name.endsWith('.log') && !alive.has(name.slice(0, -'.log'.length)))
    .map(name => rm(join(dir, name), { force: true }).catch(() => undefined)))
}

/** Local wall-clock stamp `YYYY/MM/DD HH:mm:ss` — the one formatter for run-log
    and runtime alike; time-only callers slice off the date half, so month and
    day are zero-padded to keep that slice a constant 11 characters. */
export function wallClock(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}/${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/** Clip one line of text to a budget. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/**
 * Distill one parsed stdout event into log text ('' to skip). The event
 * shapes follow the observed `--output-format stream-json` contract (Claude
 * dialect: assistant/user events carry `message.content`); anything else
 * degrades to a one-line JSON summary rather than throwing.
 */
function summarizeEvent(event: unknown): string {
  if (typeof event !== 'object' || event === null) return ''
  const record = event as { type?: unknown; message?: unknown; subtype?: unknown }
  if (record.type === 'result') return '' // the runtime reports the result itself
  // Per-run machinery noise: init banners, file snapshots, reasoning deltas.
  if (record.type === 'system' || record.type === 'file-history-snapshot' || record.type === 'reasoning') return ''
  const blocks = contentBlocksOf(record)
  if (blocks === undefined) {
    if (record.type === 'assistant' || record.type === 'user') return ''
    return `· ${clip(JSON.stringify(event), UNKNOWN_EVENT_CLIP)}`
  }
  const parts: string[] = []
  for (const block of blocks) {
    const kind = (block as { type?: unknown }).type
    // Both observed dialects: Claude-style `text` and Responses-style
    // `output_text` carry the agent's prose; `input_text` echoes the prompt
    // already snapshotted in the run row — skipped as noise.
    if ((kind === 'text' || kind === 'output_text') && typeof (block as { text?: unknown }).text === 'string') {
      const text = (block as { text: string }).text.trim()
      if (text !== '') parts.push(`\n${text}\n`)
    } else if (kind === 'tool_use') {
      const { name, input } = block as { name?: unknown; input?: unknown }
      const inputText = input === undefined ? '' : JSON.stringify(input)
      parts.push(`→ 工具 ${typeof name === 'string' ? name : '?'}：${clip(inputText, TOOL_INPUT_CLIP)}`)
    } else if (kind === 'tool_result') {
      parts.push(`← ${clip(toolResultTextOf(block), TOOL_RESULT_CLIP)}`)
    }
    // thinking and anything else: skipped — the prose and the tool trail are the story
  }
  return parts.join('\n')
}

/** The content blocks of an assistant/user message, or undefined. Two
 * dialects observed: Claude-style `{type:'assistant', message:{content}}`
 * and codebuddy's `{type:'message', role, content}` — read both. */
function contentBlocksOf(record: { content?: unknown; message?: unknown }): readonly unknown[] | undefined {
  if (Array.isArray(record.content)) return record.content as readonly unknown[]
  if (typeof record.message === 'object' && record.message !== null) {
    const content = (record.message as { content?: unknown }).content
    if (Array.isArray(content)) return content as readonly unknown[]
  }
  return undefined
}

/** Flatten a tool_result block's content (string or text-block array) to text. */
function toolResultTextOf(block: unknown): string {
  const content = (block as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    const text = (part as { text?: unknown } | null)?.text
    return typeof text === 'string' ? text : ''
  }).join(' ')
}
