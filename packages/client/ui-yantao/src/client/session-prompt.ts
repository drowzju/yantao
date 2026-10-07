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
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { sessionRemoteOf } from './remote.ts'

/**
 * Send one prompt to the current session, creating and selecting one when the
 * workbench has none.
 * @param ctx - client root context (`sessions` and `remote.session` injected).
 * @param text - the prompt's text.
 * @param cwd - the directory a fallback session is created with.
 * @param openSession - the uiWorkspace navigation callback (0.2.1: the
 *   service arrives through a dynamic-inject ref, so the caller owns the
 *   wait-or-run discipline).
 * @throws when the session channel is missing or the prompt is refused.
 */
export async function promptCurrentSession(ctx: Context, text: string, cwd: string | undefined,
  openSession: (sessionId: SessionId) => void): Promise<void> {
  // The explicit annotation keeps the lint program (which does not always see
  // the Context merge above) type-safe too.
  const sessions: ISessions = ctx.sessions
  // 0.2.1 的会话导航归视图所有者（uiWorkspace 持有唯一的 mainView 引用）：
  // 「当前会话」即列表里 mainView 计数大于零的那一行。
  const list = sessions.list.getSnapshot()
  let sessionId = Object.values(list.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
  if (sessionId === undefined) {
    sessionId = await sessions.create(cwd === undefined ? {} : { cwd })
    // `create` 只登记目录，不开进主视图；经 uiWorkspace 开进去，人才看着回合落地。
    openSession(sessionId)
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
