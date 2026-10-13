/**
 * Incremental parsing of `codebuddy -p --output-format json` stdout.
 *
 * The output contract (probed 2026-10-13): a pretty-printed event ARRAY whose
 * final element is the result event (`{type:'result', result, session_id,
 * is_error, …}`); older builds emitted the single result object directly.
 *
 * Why not one JSON.parse at close: the 2026-10-12 incident. A 2h10m 定时
 * review session's event stream — every tool call, every file snapshot —
 * blew past the runtime's old 1 MiB stdout cap; the silently-truncated
 * buffer was no longer valid JSON and a successful run was recorded as
 * "codebuddy 输出不是合法 JSON". The extractor below walks the stream
 * incrementally instead: it tracks the array's top-level element boundaries
 * (string/escape aware), parses each element as it completes, and keeps only
 * the latest result event. Retained memory is bounded by the largest single
 * element worth keeping, not by the stream; an over-cap element (a giant
 * file-history snapshot) is skipped WITHOUT losing boundary sync; and a
 * stream truncated AFTER the result event still yields that result, because
 * the closing `]` is no longer load-bearing.
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

/** One element may grow this large before it is skipped (still boundary-tracked). */
const MAX_ELEMENT_CHARS = 16 * 1024 * 1024

/** How much raw head text feeds an error message. */
const HEAD_CLIP = 300

/** What the per-character state machine reports back to the chunk walker. */
type StepEvent = 'elementStart' | 'elementEnd' | null

/**
 * The incremental extractor. Feed raw stdout buffers; call {@link finish}
 * when the process closes. An optional {@link Options.onEvent} receives every
 * successfully parsed element as it completes — the run log distills events
 * through it while the result hunt continues unaffected.
 */
export class CodebuddyOutputParser {
  private readonly onEvent: ((event: unknown) => void) | undefined

  constructor(options: { readonly onEvent?: (event: unknown) => void } = {}) {
    this.onEvent = options.onEvent
  }

  private readonly decoder = new StringDecoder('utf8')
  /** First HEAD_CLIP chars of the stream, for failure diagnostics. */
  private head = ''
  private mode: 'start' | 'array' | 'legacy' = 'start'
  // Array-mode state.
  private inElement = false
  private skipping = false
  private depth = 0
  private inString = false
  private escaped = false
  private elementChunks: string[] = []
  private elementChars = 0
  private sawElement = false
  private malformed = false
  private lastResult: CodebuddyResultEvent | undefined
  // Legacy single-object mode.
  private legacyChunks: string[] = []
  private legacyChars = 0

  /** Feed one stdout chunk (Buffer or string; Buffers decode chunk-safe). */
  feed(chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    if (this.head.length < HEAD_CLIP) this.head = (this.head + text).slice(0, HEAD_CLIP)
    // runStart: the current element's text run inside THIS chunk. Elements
    // spanning chunks carry over: a chunk that opens inside an element
    // starts its run at 0.
    let runStart = this.inElement && !this.skipping ? 0 : -1
    for (let i = 0; i < text.length; i += 1) {
      const event = this.step(text[i] as string)
      if (event === 'elementStart') runStart = this.skipping ? -1 : i
      if (event === 'elementEnd') {
        if (runStart >= 0) this.append(text.slice(runStart, i + 1))
        runStart = -1
        this.completeElement()
      }
    }
    if (this.inElement && runStart >= 0 && runStart < text.length) this.append(text.slice(runStart))
  }

  /** Settle the parse at process close. */
  finish(): CodebuddyOutput {
    const tail = this.decoder.end()
    if (tail !== '') this.feed(tail)
    if (this.mode === 'legacy') {
      const raw = this.legacyChunks.join('')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { ok: false, error: `codebuddy 输出不是合法 JSON：${this.head}${this.head.length >= HEAD_CLIP ? '…' : ''}` }
      }
      const event = resultEventOf(parsed)
      return event === undefined
        ? { ok: false, error: 'codebuddy 输出缺少 result 字段' }
        : { ok: true, event }
    }
    if (this.lastResult !== undefined) return { ok: true, event: this.lastResult }
    if (this.mode === 'start') return { ok: false, error: 'codebuddy 没有任何输出' }
    if (this.malformed) {
      return { ok: false, error: `codebuddy 输出不是合法 JSON：${this.head}${this.head.length >= HEAD_CLIP ? '…' : ''}` }
    }
    return { ok: false, error: this.sawElement ? 'codebuddy 输出缺少 result 字段' : `codebuddy 输出不是合法 JSON：${this.head}` }
  }

  /** Advance the state machine by one character. */
  private step(char: string): StepEvent {
    if (this.mode === 'start') {
      if (char === '\uFEFF' || /\s/.test(char)) return null
      if (char === '[') { this.mode = 'array'; return null }
      if (char === '{') {
        this.mode = 'legacy'
        this.legacyChunks.push(char)
        this.legacyChars += 1
        return null
      }
      // Junk before the document: tolerate it, the head clip keeps it visible.
      this.mode = 'legacy'
      this.legacyChunks.push(char)
      this.legacyChars += 1
      return null
    }
    if (this.mode === 'legacy') {
      if (this.legacyChars < MAX_ELEMENT_CHARS) {
        this.legacyChunks.push(char)
        this.legacyChars += 1
      }
      return null
    }
    // Array mode.
    if (!this.inElement) {
      if (char === '{') {
        this.inElement = true
        this.skipping = false
        this.depth = 1
        this.inString = false
        this.escaped = false
        this.elementChunks = []
        this.elementChars = 0
        this.sawElement = true
        return 'elementStart'
      }
      return null // whitespace, ',' , ']' — boundaries need nothing
    }
    if (this.inString) {
      if (this.escaped) this.escaped = false
      else if (char === '\\') this.escaped = true
      else if (char === '"') this.inString = false
      return null
    }
    if (char === '"') { this.inString = true; return null }
    if (char === '{' || char === '[') { this.depth += 1; return null }
    if (char === '}' || char === ']') {
      this.depth -= 1
      if (this.depth === 0) {
        this.inElement = false
        return 'elementEnd'
      }
    }
    return null
  }

  /** Append one element segment unless the element blew the cap. */
  private append(segment: string): void {
    if (this.skipping) return
    if (this.elementChars + segment.length > MAX_ELEMENT_CHARS) {
      // Over-cap element (a giant file snapshot): drop the text but the
      // state machine keeps tracking its boundaries, so the NEXT element —
      // possibly the result — still parses.
      this.skipping = true
      this.elementChunks = []
      this.elementChars = 0
      return
    }
    this.elementChunks.push(segment)
    this.elementChars += segment.length
  }

  /** Parse one completed element; keep the latest result event. */
  private completeElement(): void {
    if (this.skipping) {
      // The over-cap element kept its boundaries but not its text.
      this.skipping = false
      this.elementChunks = []
      this.elementChars = 0
      return
    }
    const raw = this.elementChunks.join('')
    this.elementChunks = []
    this.elementChars = 0
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.malformed = true
      return
    }
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
