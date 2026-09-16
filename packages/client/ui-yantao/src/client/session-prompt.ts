/**
 * One prompt into the conversation the human is looking at (ADR-0025 决定 4).
 *
 * The frame's capability gestures route here (ADR-0026 决定 4): the gesture
 * message — `/name` opening the text, an `@path` reference or the selection
 * riding along — is sent as a plain user message, and the controller's
 * pre-step (ADR-0025 决定 3) injects the SKILL.md body. The middle column —
 * the host's own conversation surface — shows the turn. When no session is
 * open one is created first (with the KB root as its directory, ADR-0020)
 * and selected, so the human watches the turn land.
 * @module @deepseek-ai/dsh-client-ui-yantao/session-prompt
 */
// Type-only: pulls the `ctx.sessions` service merge (the session controller's
// client face owns the declaration).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { sessionRemoteOf } from './remote.ts'

/**
 * Send one prompt to the current session, creating and selecting one when the
 * workbench has none.
 * @param ctx - client root context (`sessions` and `remote.session` injected).
 * @param text - the prompt's text.
 * @param cwd - the directory a fallback session is created with.
 * @throws when the session channel is missing or the prompt is refused.
 */
export async function promptCurrentSession(ctx: Context, text: string, cwd?: string): Promise<void> {
  // The explicit annotation keeps the lint program (which does not always see
  // the Context merge above) type-safe too.
  const sessions: ISessions = ctx.sessions
  let sessionId = sessions.list.getSnapshot().current
  if (sessionId === undefined) {
    sessionId = await sessions.create(cwd === undefined ? {} : { cwd })
    // `create` addresses the session in the list but does not select it; the
    // point of the fallback is that the human watches the turn happen.
    sessions.open(sessionId)
  }
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('会话通道不可用，无法发送。')
  const prompted = await session.prompt({
    requestId: randomUUID() as SessionRequestId,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  })
  if (!prompted.ok) throw prompted.error
}
