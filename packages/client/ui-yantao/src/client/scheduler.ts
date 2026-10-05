/**
 * The frontend scheduler (ADR-0045 决定 2): the scan logic that decides what
 * one schedule does on a tick, plus the runner that fires one schedule's
 * prompt as a background session. The frame owns the interval and the task
 * rows; this module stays React-free so the due/missed decision is pinned by
 * unit tests.
 *
 * Lifecycle semantics (ADR-0045 决定 2/3): the scheduler lives and dies with
 * the renderer — alive while the window hides in the tray, dead on refresh
 * or quit. A fire found older than the tolerance is a *missed* fire: marked
 * (`lastMissedAt`), never caught up. The baseline a schedule measures from
 * is the latest of `lastFiredAt` / `lastMissedAt` / the creation time its id
 * embeds, so a marked miss never re-fires the notice.
 * @module @deepseek-ai/dsh-client-ui-yantao/scheduler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KbSchedule } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { cronNextAfter, parseCron } from './cron.ts'
import { proposalOfAnswer } from './capability-match.ts'
import { cancelSessionTurnOnAbort, enqueueInboxProposal, sessionRemoteOf } from './remote.ts'
import { askTurn } from './turn-answer.ts'

/** The schedule slice the scan needs — the full row in practice. */
export type Scannable = Pick<KbSchedule, 'id' | 'cron' | 'enabled' | 'lastFiredAt' | 'lastMissedAt'>

/** What one tick decided for one schedule. */
export type ScheduleAction =
  /** Fire now: the due time is fresh (inside the tolerance). */
  | { readonly kind: 'fire'; readonly at: Date }
  /** Mark as missed: the due time is older than the tolerance — no catch-up (ADR-0045 决定 3). */
  | { readonly kind: 'missed'; readonly at: Date }
  /** Nothing due. */
  | { readonly kind: 'wait' }

/**
 * The creation time a schedule id embeds (`sch_<base36 ms>_<random>`) — the
 * baseline for a schedule that never fired and never missed, so a schedule
 * created while its due time was already past does not instantly "miss".
 * @param id - the schedule's stable id.
 * @returns the creation time, or null for a foreign id shape.
 */
export function scheduleCreatedAt(id: string): Date | null {
  const match = /^sch_([0-9a-z]+)_/.exec(id)
  const stamp = match?.[1]
  if (stamp === undefined) return null
  const ms = Number.parseInt(stamp, 36)
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null
}

/**
 * The instant a schedule measures its next fire from: the latest accounted
 * fire — real (`lastFiredAt`) or marked-missed (`lastMissedAt`) — falling
 * back to its creation time, and finally to the epoch (a schedule with no
 * usable stamps at all simply misses forward to the present).
 * @param schedule - the row to baseline.
 */
export function scheduleBaseline(schedule: Scannable): Date {
  const stamps = [schedule.lastFiredAt, schedule.lastMissedAt]
    .filter((stamp): stamp is string => typeof stamp === 'string')
    .map(stamp => Date.parse(stamp))
    .filter(ms => !Number.isNaN(ms))
  const created = scheduleCreatedAt(schedule.id)?.getTime()
  return new Date(Math.max(0, ...stamps, ...(created === undefined ? [] : [created])))
}

/**
 * Decide one schedule's action on a tick. A disabled schedule or an
 * unparseable cron waits; the next fire after the baseline is fresh → fire,
 * stale → missed, future → wait.
 * @param schedule - the row to scan.
 * @param now - the tick's instant.
 * @param toleranceMs - how old a due time may be and still count as a live
 *   fire rather than a missed one; should cover the scan interval.
 */
export function scheduleScan(schedule: Scannable, now: Date, toleranceMs: number): ScheduleAction {
  if (!schedule.enabled) return { kind: 'wait' }
  const parsed = parseCron(schedule.cron)
  if (parsed === null) return { kind: 'wait' }
  const next = cronNextAfter(parsed, scheduleBaseline(schedule))
  if (next === null || next.getTime() > now.getTime()) return { kind: 'wait' }
  return now.getTime() - next.getTime() > toleranceMs
    ? { kind: 'missed', at: next }
    : { kind: 'fire', at: next }
}

/** The outcome of one fired schedule. */
export interface ScheduleRunResult {
  /** The session the run lived in — kept so the judgement can be re-read in the 任务 tab (ADR-0033). */
  readonly sessionId: string
  /** The turn's final assistant text, for the completion notification's body. */
  readonly answer: string
  /**
   * The inbox entry the answer parsed into (ADR-0047), when the run closed
   * with an actions-envelope JSON — the 提议 tab's queue holds the decision
   * now. Absent when the answer carried no proposal or the enqueue failed
   * (the plain notice is the fallback, the session keeps the answer).
   */
  readonly proposalId?: string
}

/**
 * The proposal-envelope convention (ADR-0047), appended by the scheduler to
 * every fired prompt — acceptance finding 2026-10-05: relying on the schedule
 * author to hand-write the convention meant no schedule actually carried it
 * (the mail run answered with a prose report and the inbox stayed empty).
 * The convention now rides the fire, not the author's memory: the suffix
 * teaches the model the one envelope schema the card's applier knows, tells
 * it to nominate rather than execute, and permits no-envelope silence (the
 * plain notice stays the honest fallback).
 * @param prompt - the schedule's snapshot prompt.
 * @returns the prompt with the convention appended.
 */
export function withProposalEnvelope(prompt: string): string {
  return `${prompt}
【调度约定（ADR-0047）】任务完成后，若有值得人拍板的写入动作，请在回答的最末尾单独输出一个提议信封 JSON（可放在 \`\`\`json 围栏中），形如：
{"title":"一句话概括这批动作","actions":[ … ]}
actions 每项是一个待人工批准的写入动作，常用类别与字段：
- {"kind":"append-log","entityPath":"<实体文件路径>","entityName":"<实体名>","text":"<流水一行>","reason":"<缘由>"}
- {"kind":"append-section","path":"<实体文件路径>","section":"决议|待办|…","text":"<内容>","why":"<缘由>"}
- {"kind":"edit-section","path":"<路径>","section":"<节名>","before":"<现状>","after":"<改为>","why":"<缘由>"}
- {"kind":"create-entity","entityType":"person|meeting|area|project","name":"<名>","reason":"<缘由>"}
- {"kind":"create-project","name":"<名>","reason":"<缘由>","areas":["<库中已有领域>"]}
- {"kind":"write-state","entityPath":"<路径>","entityName":"<名>","text":"<状态一行>","reason":"<缘由>"}
- {"kind":"save-resource","path":"resources/<名>.md","content":"<全文>","reason":"<缘由>"}
- {"kind":"add-todo","title":"<题目>","due":"YYYY-MM-DD 或省略","body":"<详情>","reason":"<缘由>"}
- {"kind":"add-memory","scope":"<能力名>","text":"<规则一句话>","reason":"<缘由>"}
- {"kind":"archive-mails","entryId":"<邮件 EntryID>","sender":"<发件人>","subject":"<主题>","summary":"<摘要>","reason":"<缘由>"}
规则：只把值得人批准的写入列进信封，不为凑数编造；没有值得提议的就完全不输出信封（纯文字汇报即可）。信封里的动作不要自行执行（不要经 kb_write_state / kb_edit_section / kb_append_log 等落库），留给人在「提议」卡上勾选批准后再写入。`
}

/** The frame's schedule-runner face: one background session over one fired schedule. */
export type ScheduleRunner = (args: {
  /** The schedule's stable id — the inbox entry's provenance (ADR-0047). */
  readonly id: string
  /** The schedule's display name; the session is titled 「调度 · <name>」. */
  readonly name: string
  /** The snapshot prompt to run. */
  readonly prompt: string
  /** The 任务 row's cancel line (ADR-0031). */
  readonly signal?: AbortSignal
  /** Called as soon as the session exists, so the task row can anchor 「详情」. */
  readonly onSession?: (sessionId: string) => void
}) => Promise<ScheduleRunResult>

/**
 * Fire one schedule: a fresh, independently named session over the snapshot
 * prompt — the mail analysis's path (ADR-0019), never an injection into the
 * conversation the human is watching (ADR-0045 决定：独立会话). When the
 * answer closes with an actions-envelope JSON (the prompt convention,
 * ADR-0047), it lands in the proposal inbox for the human's decision; an
 * enqueue failure degrades to the plain notice — the run itself succeeded.
 * @param options - the context, the schedule's id, name and prompt, the
 *   session cwd, the cancel signal, and the session-anchor sink.
 * @returns the session id, the final answer text, and the inbox entry id
 *   when one was filed.
 */
export async function runScheduledTask(options: {
  readonly ctx: Context
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly cwd?: string
  readonly signal?: AbortSignal
  readonly onSession?: (sessionId: string) => void
}): Promise<ScheduleRunResult> {
  const { ctx, id, name, prompt, cwd, signal, onSession } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')

  const created = await session.create(cwd === undefined ? {} : { cwd })
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId
  const named = await session.rename({ sessionId, title: `调度 · ${name}` })
  if (!named.ok) throw named.error
  onSession?.(sessionId)

  // A cancelled run must not leave the server rounding on (the refine loop's
  // discipline): aborting the signal tears down the local wait, and
  // `session/cancel` ends the turn itself.
  if (signal !== undefined) cancelSessionTurnOnAbort(signal, session, sessionId)

  const answer = await askTurn({
    session,
    sessionId,
    // ADR-0047: the envelope convention rides every fire (see
    // withProposalEnvelope) — the schedule author never hand-writes it.
    prompt: withProposalEnvelope(prompt),
    ...(signal !== undefined ? { signal } : {}),
  })

  // ADR-0047: an answer that closes with the actions-envelope JSON becomes
  // an inbox entry — the human decides from the 提议 tab, the session stays
  // the evidence. Enqueue trouble never fails the run: the plain completion
  // notice is the fallback, and the answer lives on in the session.
  const proposal = proposalOfAnswer(answer, `调度「${name}」的提议`)
  if (proposal !== null) {
    try {
      const enqueued = await enqueueInboxProposal(ctx, {
        source: `schedule:${id}`,
        sourceName: name,
        title: proposal.title,
        note: '会话可在任务页回看',
        proposal: proposal as unknown as Parameters<typeof enqueueInboxProposal>[1]['proposal'],
      })
      return { sessionId, answer, proposalId: enqueued.id }
    } catch { /* the plain notice is the report */ }
  }
  return { sessionId, answer }
}

declare global {
  interface Window {
    /** The desktop shell's bridge (preload.cjs) — absent in a plain browser. */
    readonly yantao?: {
      readonly notify: (message: { readonly title: string; readonly body: string }) => void
    }
  }
}

/**
 * Announce a settled run through the desktop bridge. The shell decides
 * whether that is worth a system notification (it pops one only while the
 * window is hidden — ADR-0045 决定 7); a plain browser without the bridge
 * stays silent.
 * @param message - the notification's title and body.
 */
export function notifySchedule(message: { title: string; body: string }): void {
  window.yantao?.notify(message)
}
