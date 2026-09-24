/**
 * One task session's transcript, read back for the 任务 tab's 「详情」 drawer
 * (ADR-0033). The events are already on disk — the durable session log keeps
 * every prompt, every assistant message, every tool call and its result — so
 * the drawer needs no new RPC and no change to any run path: it opens a
 * `follow` stream, takes the opening snapshot (for a running task that is
 * whatever has been flushed so far), pages backwards through any older
 * history with the session controller's existing `page` RPC, and shapes the
 * events into the flat item list the drawer renders.
 *
 * Pure shaping plus one loader over the session Remote face — no React — so
 * the recognition rules (which events surface, what clips, what pairs) are
 * pinned by unit tests.
 * @module @deepseek-ai/dsh-client-ui-yantao/session-detail
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionAddress, SessionPageRequest, SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionRemote } from './remote.ts'

/** One rendered line of the drawer: a prompt, a reply, or one tool call. */
export type DetailItem =
  | {
    /** A user-role message — the human's prompt, or an injected context block. */
    readonly kind: 'user'
    readonly seq: number
    readonly turn: number
    /** The message's text blocks joined. */
    readonly text: string
    /** True when the message was injected by the pipeline (skill body, notices), not typed by the human. */
    readonly injected: boolean
  }
  | {
    /** One assistant step's text (a tool-only step has none and is skipped). */
    readonly kind: 'assistant'
    readonly seq: number
    readonly turn: number
    readonly text: string
  }
  | {
    /** One tool call, paired with its result when that has landed. */
    readonly kind: 'tool'
    readonly seq: number
    readonly turn: number
    readonly name: string
    /** The raw arguments JSON as the model produced it, clipped. */
    readonly args: string
    /** The result's text, once the paired `tool/result` landed; null while pending. */
    readonly result: string | null
    /** The result's failure identity, when the tool errored. */
    readonly error: string | null
  }

/** One session's shaped transcript, oldest first. */
export interface SessionDetail {
  readonly items: readonly DetailItem[]
}

/** Read one session's transcript back — the drawer's injected seam (ADR-0033). */
export type SessionDetailLoader = (
  sessionId: string,
  signal?: AbortSignal,
) => Promise<readonly DetailItem[]>

/** How much of one user or assistant message the drawer keeps. */
const TEXT_CLIP = 16_000
/** How much of one tool call's raw arguments the drawer keeps. */
const ARGS_CLIP = 4_000
/** How much of one tool result the drawer keeps. */
const RESULT_CLIP = 8_000

/** The marker a clip appends, so a shortened read is never mistaken for a whole one. */
const CLIP_MARK = '\n（过长，已截断）'

/** Clip one string to `max` code units, marking the cut. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}${CLIP_MARK}`
}

/** The text blocks of one message-shaped `content` array, joined; defensive — wire JSON. */
function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part !== 'object' || part === null) return ''
    if ((part as { type?: unknown }).type !== 'text') return ''
    const text = (part as { text?: unknown }).text
    return typeof text === 'string' ? text : ''
  }).join('')
}

/** The `tool/call` event's arguments string, or `''` when the envelope is not what we expect. */
function argsOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const args = (data as { arguments?: unknown }).arguments
  return typeof args === 'string' ? args : ''
}

/** The `tool/result` event's text and error identity, read defensively. */
function resultOf(data: unknown): { text: string; error: string | null } {
  if (typeof data !== 'object' || data === null) return { text: '', error: null }
  const record = data as { message?: { content?: unknown }; error?: unknown }
  const text = textOfContent(record.message?.content)
  const raw = record.error
  if (typeof raw !== 'object' || raw === null) return { text, error: null }
  const fields = raw as { name?: unknown; code?: unknown }
  const name = typeof fields.name === 'string' ? fields.name : '错误'
  const code = typeof fields.code === 'string'
    ? fields.code
    : typeof fields.code === 'number' ? String(fields.code) : ''
  return { text, error: `${name}(${code})` }
}

/**
 * Shape one session's durable events into the drawer's item list (ADR-0033):
 * user prompts and assistant replies surface verbatim (clipped), tool calls
 * pair with their results by `callId`, and everything else — turn brackets,
 * step markers, request headers, assistant attempts that committed nothing —
 * is scaffolding the audit does not need. The system prompt is not an event
 * at all (it layers in at request time, ADR-0022), so hiding it costs nothing.
 * @param events - the session's durable events, oldest first.
 * @returns the shaped items in the same order.
 */
/** One tool call being assembled: mutable until its result pairs in. */
type ToolDraft = {
  kind: 'tool'
  seq: number
  turn: number
  name: string
  args: string
  result: string | null
  error: string | null
}

export function detailFromEvents(events: readonly SessionWireEvent[]): readonly DetailItem[] {
  const items: DetailItem[] = []
  const pending = new Map<string, ToolDraft>()
  let turn = 0
  for (const event of events) {
    if (event.type === 'turn/start') {
      const data = event.data as { turn?: unknown }
      if (typeof data.turn === 'number') turn = data.turn
      continue
    }
    if (event.type === 'user/message') {
      const data = event.data as { source?: { kind?: unknown } }
      const text = textOfContent((event.data as { content?: unknown }).content)
      if (text === '') continue
      items.push({
        kind: 'user', seq: event.seq, turn,
        text: clip(text, TEXT_CLIP),
        injected: data.source?.kind !== 'user',
      })
      continue
    }
    if (event.type === 'assistant/message') {
      const message = (event.data as { message?: { content?: unknown } }).message
      const text = textOfContent(message?.content)
      if (text === '') continue
      items.push({ kind: 'assistant', seq: event.seq, turn, text: clip(text, TEXT_CLIP) })
      continue
    }
    if (event.type === 'tool/call') {
      const data = event.data as { callId?: unknown; name?: unknown }
      if (typeof data.callId !== 'string' || typeof data.name !== 'string') continue
      const item: ToolDraft = {
        kind: 'tool', seq: event.seq, turn,
        name: data.name,
        args: clip(argsOf(event.data), ARGS_CLIP),
        result: null,
        error: null,
      }
      items.push(item)
      pending.set(data.callId, item)
      continue
    }
    if (event.type === 'tool/result') {
      const data = event.data as { callId?: unknown }
      const callId = data.callId
      const item = typeof callId === 'string' ? pending.get(callId) : undefined
      const { text, error } = resultOf(event.data)
      if (item !== undefined) {
        item.result = clip(text, RESULT_CLIP)
        item.error = error
        pending.delete(callId as string)
      }
      continue
    }
  }
  return items
}

/** How many messages one backwards page asks for — few round trips for a task-sized log. */
const PAGE_MESSAGES = 200

/**
 * Read one session's transcript through the session Remote's existing faces
 * (ADR-0033): the `follow` opening snapshot gives the current window and the
 * log cursor; the `page` RPC walks backwards while older history remains.
 * The follow stream is abandoned right after its snapshot — a running task's
 * drawer shows what has been flushed so far, and reopening refreshes it.
 * @param session - the session namespace.
 * @param sessionId - the session to read.
 * @param signal - the drawer's cancel line (closed drawer stops the read).
 * @returns the shaped transcript, oldest first.
 */
export async function loadSessionDetail(
  session: SessionRemote,
  sessionId: string,
  signal?: AbortSignal,
): Promise<readonly DetailItem[]> {
  // The wire id is a plain string; the Remote face brands it (turn-answer's precedent).
  const address: SessionAddress = { kind: 'session', sessionId: sessionId as SessionId }
  // The follow is only opened for its snapshot: abort as soon as it lands.
  const opener = new AbortController()
  const onOuterAbort = (): void => { opener.abort() }
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  let cursor = -1
  let events: SessionWireEvent[] = []
  let hasMore = false
  try {
    for await (const frame of session.follow({ address }, opener.signal)) {
      if (frame.type !== 'snapshot') continue
      cursor = frame.cursor
      events = frame.records.map(record => record.event)
      hasMore = frame.hasMore
      break
    }
  } finally {
    opener.abort() // snapshot in hand — abandon the follow stream
    signal?.removeEventListener('abort', onOuterAbort)
  }
  // Snapshot in hand — the follow stream is abandoned (the opener aborts it).
  while (hasMore) {
    const oldest = events[0]?.seq
    if (oldest === undefined || oldest <= 0) break
    const request: SessionPageRequest = { address, throughSeq: cursor, beforeSeq: oldest, maxMessages: PAGE_MESSAGES }
    const result = await session.page(request, signal)
    if (!result.ok) break
    const page = result.value
    if (page.records.length === 0) break
    events = [...page.records.map(record => record.event), ...events]
    hasMore = page.hasMore
  }
  return detailFromEvents(events)
}
