/**
 * Incremental parsing of `codebuddy -p --output-format stream-json` stdout.
 *
 * The contract (probed 2026-10-13): newline-delimited JSON, one event per
 * line, arriving LIVE while the agent works — `{type:'system'}`,
 * `{type:'assistant', message:{content:[…]}}` (Claude dialect),
 * `{type:'user', message:{content:[tool_result]}}`, and a final
 * `{type:'result', result, session_id, is_error}` line. The buffered
 * `--output-format json` (a whole event ARRAY printed only at process exit)
 * is why the run log sat empty mid-run and why the 2026-10-12 incident — a
 * 2h10m session's array blowing past the old 1 MiB stdout cap, then failing
 * the whole-stream JSON.parse — could happen at all.
 *
 * The parser below stays incremental and line-wise: each complete line is
 * parsed as it lands (the run log distills it in real time), only the latest
 * result event is retained, a garbage line is skipped without losing line
 * sync, and an over-cap line (a giant embedded tool result) is dropped the
 * same way. Memory is bounded by the largest single line, not the stream.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/workspace/output-parse
 */

import { StringDecoder } from 'node:string_decoder'

/** The fields one step needs from the result event. */
export interface CodebuddyResultEvent {
  readonly result: string
  readonly sessionId?: string
  readonly isError: boolean
}

/** The settled parse: the result event, or the failure to report. */
export type CodebuddyOutput =
  | { readonly ok: true; readonly event: CodebuddyResultEvent }
  | { readonly ok: false; readonly error: string }

/** One line may grow this large before it is dropped (still newline-tracked). */
const MAX_LINE_CHARS = 16 * 1024 * 1024

/** How much raw head text feeds an error message. */
const HEAD_CLIP = 300

/**
 * The incremental extractor. Feed raw stdout buffers; call {@link finish}
 * when the process closes. An optional {@link Options.onEvent} receives every
 * successfully parsed event as its line completes — the run log distills
 * events through it while the result hunt continues unaffected.
 */
export class CodebuddyOutputParser {
  private readonly onEvent: ((event: unknown) => void) | undefined

  constructor(options: { readonly onEvent?: (event: unknown) => void } = {}) {
    this.onEvent = options.onEvent
  }

  private readonly decoder = new StringDecoder('utf8')
  /** First HEAD_CLIP chars of the stream, for failure diagnostics. */
  private head = ''
  private lineChunks: string[] = []
  private lineChars = 0
  private discarding = false
  private sawEvent = false
  private malformed = false
  private lastResult: CodebuddyResultEvent | undefined

  /** Feed one stdout chunk (Buffer or string; Buffers decode chunk-safe). */
  feed(chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    if (this.head.length < HEAD_CLIP) this.head = (this.head + text).slice(0, HEAD_CLIP)
    let start = 0
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '\n') {
        this.completeLine(text.slice(start, i))
        start = i + 1
      }
    }
    if (start < text.length) this.append(text.slice(start))
  }

  /** Settle the parse at process close; the last line may lack its newline. */
  finish(): CodebuddyOutput {
    const tail = this.decoder.end()
    if (tail !== '') {
      this.append(tail)
      this.completeLine('')
    } else {
      this.completeLine('')
    }
    if (this.lastResult !== undefined) return { ok: true, event: this.lastResult }
    if (!this.sawEvent) {
      if (this.malformed) {
        return { ok: false, error: `codebuddy 输出不是合法 JSON：${this.head}${this.head.length >= HEAD_CLIP ? '…' : ''}` }
      }
      return { ok: false, error: 'codebuddy 没有任何输出' }
    }
    return { ok: false, error: 'codebuddy 输出缺少 result 字段' }
  }

  /** Append one line segment unless the line blew the cap. */
  private append(segment: string): void {
    if (this.discarding) return
    if (this.lineChars + segment.length > MAX_LINE_CHARS) {
      // Over-cap line (a giant embedded tool result): drop the text but keep
      // scanning for the newline, so the NEXT line — possibly the result —
      // still parses.
      this.discarding = true
      this.lineChunks = []
      this.lineChars = 0
      return
    }
    this.lineChunks.push(segment)
    this.lineChars += segment.length
  }

  /** Parse one completed line (newline reached, or the unterminated tail). */
  private completeLine(finalSegment: string): void {
    if (finalSegment !== '') this.append(finalSegment)
    const raw = this.lineChunks.join('').trim()
    const discarded = this.discarding
    this.lineChunks = []
    this.lineChars = 0
    this.discarding = false
    if (discarded || raw === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.malformed = true
      return
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.malformed = true
      return
    }
    this.sawEvent = true
    const event = resultEventOf(parsed)
    if (event !== undefined) this.lastResult = event
    this.onEvent?.(parsed)
  }
}

/** Read the result-event fields off one parsed value, or undefined. */
function resultEventOf(parsed: unknown): CodebuddyResultEvent | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as { type?: unknown; result?: unknown; session_id?: unknown; is_error?: unknown }
  const isResultEvent = record.type === 'result' || (record.type === undefined && typeof record.result === 'string')
  if (!isResultEvent || typeof record.result !== 'string') return undefined
  return {
    result: record.result,
    isError: record.is_error === true,
    ...(typeof record.session_id === 'string' && record.session_id !== '' ? { sessionId: record.session_id } : {}),
  }
}
