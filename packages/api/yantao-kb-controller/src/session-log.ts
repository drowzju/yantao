/**
 * One agent session's forensic digest, read back for the kb_read_session_log
 * tool (运行可观测性的最后一层): the DingTalk-side agent can already list run
 * rows (ADR-0065) — this gives it the session BEHIND the row, so「那次调度为
 * 什么零产出」stops being a question only the workbench can answer.
 *
 * The transport reuses the session controller's existing cold-read faces
 * (follow opening snapshot + page-backwards, the 任务 tab 详情 drawer's
 * collector recipe); this module adds only the shaping: which events
 * surface, what clips, and how errors ride. Read-only by construction —
 * nothing here writes anywhere.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/session-log
 */

/** One durable session event, structurally shadowed (wire JSON, defensive). */
export interface SessionEventLike {
  readonly type: string
  readonly seq: number
  readonly time?: number
  readonly data?: unknown
}

/** One page of history, as the in-host session controller returns it (unwrapped). */
export interface SessionPageLike {
  readonly records: readonly { readonly event: SessionEventLike }[]
  readonly hasMore: boolean
}

/** The subset of the follow stream's frames the collector understands. */
export interface SessionFollowFrameLike {
  readonly type: string
  readonly cursor?: number
  readonly records?: readonly { readonly event: SessionEventLike }[]
  readonly hasMore?: boolean
}

/** The session controller's cold-read face, structurally shadowed — the
 * controller takes no compile-time dependency on the session package. */
export interface SessionCollectorFace {
  follow(request: { address: { kind: 'session'; sessionId: string } }, signal?: AbortSignal): AsyncIterable<SessionFollowFrameLike>
  page(request: {
    address: { kind: 'session'; sessionId: string }
    throughSeq: number
    beforeSeq?: number
    maxMessages?: number
  }, signal?: AbortSignal): Promise<SessionPageLike>
}

/** How far each shaped line may run before the ellipsis lands. */
const USER_CLIP = 300
const ASSISTANT_CLIP = 600
const ARGS_CLIP = 200
const RESULT_CLIP = 300
/** Backwards page budget per page call (session-detail's pace). */
const PAGE_MESSAGES = 200
/**
 * Whole-digest ceiling: past it the oldest lines fall off with a marker.
 *
 * Raised 24K → 80K on 2026-10-25. A forensic read of a failed scheduled run is
 * exactly the case where the middle of the session is the evidence, and 24K
 * was a 128K-window number: it clipped long runs down to their head and tail.
 */
export const DIGEST_CHAR_CAP = 80_000

/** Clip one string to `max` code units, marking the cut. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max) + '…'
}

/** The text blocks of one message-shaped content array, joined. */
function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part !== 'object' || part === null) return ''
    if ((part as { type?: unknown }).type !== 'text') return ''
    const text = (part as { text?: unknown }).text
    return typeof text === 'string' ? text : ''
  }).join('')
}

/** The tool/result event's text and error identity, read defensively. */
function resultOf(data: unknown): { text: string; error: string | null } {
  if (typeof data !== 'object' || data === null) return { text: '', error: null }
  const record = data as { message?: { content?: unknown }; error?: unknown }
  const text = textOfContent(record.message?.content)
  if (typeof record.error !== 'object' || record.error === null) return { text, error: null }
  const fields = record.error as { name?: unknown; message?: unknown }
  const name = typeof fields.name === 'string' ? fields.name : '错误'
  const detail = typeof fields.message === 'string' ? '：' + fields.message : ''
  return { text, error: name + detail }
}

/**
 * Collect one session's durable events, oldest first, through the session
 * controller's follow-opening + page-backwards recipe (session-detail's
 * collector, reshaped for the in-host face: no RemoteResult wrapper).
 * @param session - the injected session controller face.
 * @param sessionId - the session to read.
 * @param maxEvents - safety stop for runaway histories.
 * @returns the events, oldest first.
 */
export async function collectSessionEvents(
  session: SessionCollectorFace,
  sessionId: string,
  maxEvents = 4_000,
): Promise<readonly SessionEventLike[]> {
  const address = { kind: 'session' as const, sessionId }
  const opener = new AbortController()
  let cursor = -1
  let events: SessionEventLike[] = []
  let hasMore = false
  try {
    for await (const frame of session.follow({ address }, opener.signal)) {
      if (frame.type !== 'snapshot') continue
      cursor = frame.cursor ?? -1
      events = (frame.records ?? []).map(record => record.event)
      hasMore = frame.hasMore ?? false
      break
    }
  } finally {
    opener.abort() // 快照到手即弃流——冷读者不留活连接
  }
  while (hasMore && events.length < maxEvents) {
    const oldest = events[0]?.seq
    if (oldest === undefined || oldest <= 0) break
    const page = await session.page({ address, throughSeq: cursor, beforeSeq: oldest, maxMessages: PAGE_MESSAGES })
    if (page.records.length === 0) break
    events = [...page.records.map(record => record.event), ...events]
    hasMore = page.hasMore
  }
  return events
}

/**
 * Distill one session's events into a forensic digest: every tool call with
 * its outcome, every assistant word, every error — clipped, one event per
 * line, oldest first. This is the text the agent reads to answer「那次运行
 * 干了什么、卡在哪」without the workbench.
 * @param events - the session's durable events, oldest first.
 * @returns the digest text and how many events were folded in.
 */
export function digestOfEvents(events: readonly SessionEventLike[]): { digest: string; eventCount: number } {
  const lines: string[] = []
  const names = new Map<string, string>() // callId → tool name, for result pairing
  for (const event of events) {
    const data = event.data as Record<string, unknown> | undefined
    switch (event.type) {
      case 'user/message': {
        const text = textOfContent((data as { content?: unknown } | undefined)?.content)
        if (text.trim() !== '') lines.push('【用户】' + clip(text, USER_CLIP))
        break
      }
      case 'assistant/message': {
        const text = textOfContent((data as { content?: unknown } | undefined)?.content)
        if (text.trim() !== '') lines.push('【助手】' + clip(text, ASSISTANT_CLIP))
        break
      }
      case 'tool/call': {
        const callId = typeof data?.callId === 'string' ? data.callId : '#' + String(event.seq)
        const args = typeof data?.arguments === 'string' ? data.arguments : JSON.stringify(data?.arguments ?? {})
        names.set(callId, data?.name !== undefined ? String(data.name) : '?')
        lines.push('→ ' + (data?.name ?? '?') + '(' + clip(args, ARGS_CLIP) + ')')
        break
      }
      case 'tool/result': {
        const message = (data as { message?: { toolCallId?: unknown; content?: unknown } } | undefined)?.message
        const callId = typeof message?.toolCallId === 'string' ? message.toolCallId : ''
        const { text, error } = resultOf(data)
        const name = names.get(callId) ?? '工具'
        const verdict = error !== null ? '〔错误 ' + clip(error, 300) + '〕' : clip(text, RESULT_CLIP)
        lines.push('← ' + name + '：' + verdict)
        break
      }
      case 'compaction/start':
        lines.push('（上下文压缩开始）')
        break
      case 'compaction/end':
        lines.push('（上下文压缩完成）')
        break
      default:
        break // turn brackets, step markers, headers: scaffolding the digest skips
    }
  }
  return { digest: lines.join('\n'), eventCount: events.length }
}
