/**
 * One prompted turn, waited out properly.
 *
 * The session log appends one `assistant/message` event per agent step, and a
 * step that only calls tools carries reasoning and tool calls but no text —
 * so the *first* message of a multi-step turn is never the answer. The
 * durable `turn/end` event is what says the turn is over; the answer is the
 * last text-bearing message before it, the same contract the SDK's
 * `finalResponse` keeps. The reading and mail flows share this module so a
 * tool-using turn can never be mistaken for a finished one again.
 * @module @deepseek-ai/dsh-client-ui-yantao/turn-answer
 */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRemote } from './remote.ts'

/**
 * The text of one durable assistant message: the content parts' `text` blocks
 * only. Reasoning blocks carry text too, and they are not the answer; read
 * defensively because this arrived as wire JSON.
 * @param data - the `assistant/message` event's `data`.
 * @returns the message's text.
 */
function messageText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const message = (data as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part !== 'object' || part === null) return ''
      if ((part as { type?: unknown }).type !== 'text') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

/**
 * The `turn/end` reason's kind, read defensively.
 * @param data - the `turn/end` event's `data`.
 * @returns the kind, or undefined when the envelope is not what we expect.
 */
function turnEndKind(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const reason = (data as { reason?: unknown }).reason
  if (typeof reason !== 'object' || reason === null) return undefined
  const kind = (reason as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : undefined
}

/**
 * Send one prompt and follow the session until that turn's durable
 * `turn/end` lands.
 * @param options - the session namespace, the session id, the prompt, and an
 *   optional abort signal.
 * @returns the turn's final assistant text — `''` when the turn ended
 *   without any text block.
 */
export async function askTurn(options: {
  readonly session: SessionRemote
  readonly sessionId: string
  readonly prompt: string
  readonly signal?: AbortSignal
}): Promise<string> {
  // The wire id is a plain string; the Remote face brands it (reading-flow's precedent).
  const sessionId = options.sessionId as SessionId
  const prompted = await options.session.prompt({
    requestId: randomUUID() as SessionRequestId,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: options.prompt }],
  }, options.signal)
  if (!prompted.ok) throw prompted.error

  // The prompt resolves when queued, so follow opens before the turn's first
  // step: every assistant/message and the turn/end below are this turn's.
  let answer = ''
  for await (const frame of options.session.follow(
    { address: { kind: 'session', sessionId } },
    options.signal,
  )) {
    if (frame.type !== 'event') continue
    if (frame.event.type === 'assistant/message') answer = messageText(frame.event.data)
    if (frame.event.type === 'turn/end') {
      if (turnEndKind(frame.event.data) !== 'completed') {
        throw new Error(`会话回合没有正常完成（${turnEndKind(frame.event.data) ?? '原因未知'}），没有拿到完整回答。`)
      }
      return answer
    }
  }
  throw new Error('会话结束了却没有给出回答。')
}

/** How much of the model's own words a final parse failure keeps for tracing. */
const TAIL_LENGTH = 300

/**
 * The model's answer, flattened and cut to its tail — the ending is where a
 * JSON object would have closed, so it is the part that explains the failure.
 * @param text - the raw answer.
 * @returns the tail, or `''` when the answer had no text at all.
 */
function tail(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= TAIL_LENGTH ? flat : `…${flat.slice(-TAIL_LENGTH)}`
}

/**
 * One JSON round: prompt, wait out the turn, parse. An unreadable first
 * answer is retried once in the same session — a model that answered
 * prose-then-garbage usually answers cleanly when asked for JSON alone — and
 * only a second failure surfaces, carrying the model's own words so the
 * failure is traceable without hunting the session down.
 * @param options - the session, the two prompts, the parser, and the signal.
 * @returns whatever the parser made of the answer.
 */
export async function jsonRound<T>(options: {
  readonly session: SessionRemote
  readonly sessionId: string
  readonly prompt: string
  readonly reask: string
  readonly parse: (text: string) => T
  readonly signal?: AbortSignal
}): Promise<T> {
  const first = await askTurn(options)
  try {
    return options.parse(first)
  } catch {
    const second = await askTurn({ ...options, prompt: options.reask })
    try {
      return options.parse(second)
    } catch {
      throw new Error(`模型没有返回可解析的 JSON。它最后说的是：「${tail(second) || '（没有文本）'}」`)
    }
  }
}
