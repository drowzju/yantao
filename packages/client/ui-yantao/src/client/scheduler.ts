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
import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import { cronNextAfter, parseCron } from './cron.ts'
import { envelopeRejectionOf, proposalOfAnswer } from './capability-match.ts'
import { annotateInboxProposal, cancelSessionTurnOnAbort, enqueueInboxProposal, capabilityInstructions, loadProposalInbox, scheduledRunForget, scheduledRunMark, sessionRemoteOf } from './remote.ts'
import type { Proposal, ProposalAction, ProposalHighlight } from './proposal.ts'
import { askTurn } from './turn-answer.ts'
import { collectEvents, textOfContent } from './session-detail.ts'
import { formatTokens } from './insights.ts'

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
  /** ISO timestamp the session was created — the run-report's 起点锚. */
  readonly startedAt: string
  /** ISO timestamp the run settled (the final answer landed, or the failure threw). */
  readonly finishedAt: string
  /** The turn's final assistant text, for the completion notification's body. */
  readonly answer: string
  /**
   * The inbox entry the answer parsed into (ADR-0047), when the run closed
   * with an actions-envelope JSON — the 提议 tab's queue holds the decision
   * now. Absent when the answer carried no proposal or the enqueue failed
   * (the plain notice is the fallback, the session keeps the answer).
   */
  readonly proposalId?: string
  /**
   * The read-closure scan's warnings (ADR-0059 决定 2), one line each —
   * attached to the card's highlight channel and echoed here so the
   * completion notice can name the count. Absent when the scan found
   * nothing (or could not run).
   */
  readonly warnings?: readonly string[]
  /**
   * The run's performance accounting (2026-10-10 晨间事故的性能追问): folded
   * from the session's durable event log after the final answer — wall-clock
   * span, gateway retries and their accumulated waits, tool-call volume,
   * model steps, token totals, and 64KB output truncations. Absent when the
   * event log could not be read (statistics are garnish, never the dish).
   */
  readonly stats?: ScheduleRunStats
}

/** One fired schedule's performance accounting, folded from the durable events. */
export interface ScheduleRunStats {
  /** Wall-clock span from session creation to the final answer landing. */
  readonly durationMs: number
  /** Gateway/model retries the log recorded (`llm/retry` events). */
  readonly retries: number
  /** Summed backoff waits the retry events announced (`delayMs`). */
  readonly retryDelayMs: number
  /** Tool calls the model made (`tool/call` events). */
  readonly toolCalls: number
  /** Model steps that reported token usage (`assistant/message` with usage). */
  readonly steps: number
  /** Uncached prompt tokens summed across those steps. */
  readonly inputTokens: number
  /** Completion tokens summed across those steps. */
  readonly outputTokens: number
  /** Exec outputs the 64KB cap clipped (results carrying the truncation marker). */
  readonly truncations: number
}

/** The exec bridge's 64KB truncation marker — the string it appends to a clipped stream.
 * Exported for the controller-side parity spec: a wording drift between the
 * two halves silently zeroes the truncations counter (ocr 评审 #8). */
export const TRUNCATION_MARKER = '输出超过 64KB'

/** The tool the ADR-0055 convention teaches (nomination probe + stats share the name). */
const PROPOSE_TOOL = 'kb_propose_actions'

/** The read tool whose calls are 校验 B's read witnesses (ADR-0059 决定 2). */
const READ_RESOURCE_TOOL = 'kb_read_resource'

/** Cap on one scan's closure warnings — the store caps the card's highlights at 20 anyway. */
const CLOSURE_WARNINGS_MAX = 20

/**
 * The resource paths this run actually read, folded from the durable events
 * (ADR-0059 决定 2): every `kb_read_resource` call's `path` argument. The
 * log is the machine's account of what the round truly read — 溯源核对
 * cross-checks the model's claims against it, not against the model's
 * self-report. Defensive throughout: a malformed envelope contributes nothing.
 * @param events - the session's durable events, oldest first.
 * @returns the read paths, deduplicated, in first-seen order.
 */
export function readPathsFromEvents(events: readonly SessionWireEvent[]): ReadonlySet<string> {
  const paths = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const data = event.data as { name?: unknown; arguments?: unknown }
    if (data.name !== READ_RESOURCE_TOOL || typeof data.arguments !== 'string') continue
    try {
      const parsed = JSON.parse(data.arguments) as { path?: unknown }
      if (typeof parsed.path === 'string' && parsed.path.trim() !== '') paths.add(parsed.path.trim())
    } catch { /* a malformed arguments blob is not a read witness */ }
  }
  return paths
}

/**
 * 校验 B（ADR-0059 决定 2）——读取闭合的双向核对：
 *
 * 正向（伪证）：每条动作声称的 `sourcePath` 必须 ∈ 实际读取集合——引用了
 * 没读过的文件就是伪证，纯精确匹配零误杀。
 *
 * 反向（遗漏）：读取集合中每个资源要么被至少一条动作引用，要么在 note 里
 * 声明「无要点」——读了没写就是遗漏。决定 1 的强制也由此兜底执法：缺
 * `sourcePath` 的提炼动作使其来源资源在反向闭合中无着落而被点名。
 *
 * 违例不阻塞任何东西——此处已是 run 收尾，入队早已发生——而是以警告附着
 * 到卡片（走既有 ProposalHighlight 通道），在人审批准前可见。
 * @param readPaths - the run's actual read set (from {@link readPathsFromEvents}).
 * @param actions - the enqueued proposal's actions.
 * @param note - the entry's note, whose 「无要点」declaration exempts the reverse check.
 * @returns the warnings, each shaped for the card's highlight channel.
 */
export function readClosureWarnings(
  readPaths: ReadonlySet<string>,
  actions: readonly ProposalAction[],
  note?: string,
): readonly ProposalHighlight[] {
  const warnings: ProposalHighlight[] = []
  const cited = new Set<string>()
  const phantom = new Set<string>()
  for (const action of actions) {
    const sourcePath = action.kind === 'append-log' || action.kind === 'write-state' || action.kind === 'create-link'
      ? action.sourcePath?.trim()
      : undefined
    if (sourcePath === undefined || sourcePath === '') continue
    cited.add(sourcePath)
    if (!readPaths.has(sourcePath) && !phantom.has(sourcePath)) {
      phantom.add(sourcePath)
      warnings.push({
        sender: '溯源校验',
        subject: sourcePath,
        why: '有动作声称提炼自此文件，但本轮从未读取过它（疑似伪证，请抽查内容）',
      })
    }
  }
  // 反向闭合的豁免：模型如实声明「本期无要点」即免——读了没写不算遗漏。
  if (!note?.includes('无要点')) {
    for (const path of readPaths) {
      if (cited.has(path)) continue
      warnings.push({
        sender: '读取闭合',
        subject: path,
        why: '本轮读过该资源，但没有动作引用它，note 也未声明「本期无要点」（疑似遗漏）',
      })
    }
  }
  return warnings.slice(0, CLOSURE_WARNINGS_MAX)
}

/**
 * Whether the durable log shows a `kb_propose_actions` call that SUCCEEDED —
 * its `tool/result` landed without an `error`. The tool enqueues atomically
 * (all rows validated or nothing written), so success means the inbox entry
 * is on disk; a failed or never-answered call enqueued nothing and must NOT
 * count as a nomination, or the model's valid prose envelope would be
 * silently dropped (2026-10-10 ocr 评审 #4).
 * @param events - the session's durable events, oldest first.
 * @returns true when at least one nomination call resolved successfully.
 */
export function toolNominationSucceeded(events: readonly SessionWireEvent[]): boolean {
  const resolved = new Map<string, boolean>()
  for (const event of events) {
    if (event.type === 'tool/call') {
      const data = event.data as { callId?: unknown; name?: unknown }
      if (data.name === PROPOSE_TOOL && typeof data.callId === 'string') resolved.set(data.callId, false)
      continue
    }
    if (event.type === 'tool/result') {
      // The canonical tool/result payload nests the call identity inside the
      // tool message (`message.toolCallId` / `message.source.callId`); older
      // producers and test harnesses put a top-level `callId` — accept all.
      const data = event.data as {
        callId?: unknown
        error?: unknown
        message?: { toolCallId?: unknown; source?: { callId?: unknown }; content?: unknown }
      }
      const id = data.callId ?? data.message?.toolCallId ?? data.message?.source?.callId
      if (typeof id === 'string' && resolved.has(id)) {
        // Rejection rides the TEXT, not the error field: the tool answers a
        // failed validation with `Error: 提议未通过校验…（整单未入队）` as a
        // plain result (observed in session a5000eab, twice). Count a result
        // as success only when neither channel says failure.
        const text = textOfContent(data.message?.content)
        resolved.set(id, (data.error === undefined || data.error === null) && !text.startsWith('Error:'))
      }
    }
  }
  for (const ok of resolved.values()) if (ok) return true
  return false
}

/**
 * Fold one run's durable events into the performance accounting. The session
 * is fresh per fire, so every event belongs to this run. Defensive — wire
 * JSON throughout.
 * @param events - the session's durable events, oldest first.
 * @param durationMs - the measured wall-clock span.
 * @returns the accounting.
 */
export function statsFromEvents(events: readonly SessionWireEvent[], durationMs: number): ScheduleRunStats {
  let retries = 0
  let retryDelayMs = 0
  let toolCalls = 0
  let truncations = 0
  let steps = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const event of events) {
    if (event.type === 'llm/retry') {
      retries += 1
      const delay = (event.data as { delayMs?: unknown } | null)?.delayMs
      if (typeof delay === 'number' && Number.isFinite(delay)) retryDelayMs += delay
      continue
    }
    if (event.type === 'tool/call') {
      toolCalls += 1
      continue
    }
    if (event.type === 'tool/result') {
      // Probe the result's TEXT (the field the exec bridge appends the
      // marker to), not a JSON.stringify of the whole event (ocr 评审 #8).
      const data = event.data as { message?: { content?: unknown } } | null
      if (textOfContent(data?.message?.content).includes(TRUNCATION_MARKER)) truncations += 1
      continue
    }
    if (event.type !== 'assistant/message') continue
    const usage = (event.data as { usage?: unknown } | null)?.usage
    if (typeof usage !== 'object' || usage === null) continue
    const input = (usage as { inputTokens?: unknown }).inputTokens
    const output = (usage as { outputTokens?: unknown }).outputTokens
    if (typeof input !== 'number' || typeof output !== 'number') continue
    steps += 1
    inputTokens += input
    outputTokens += output
  }
  return { durationMs, retries, retryDelayMs, toolCalls, truncations, steps, inputTokens, outputTokens }
}

/**
 * Render the accounting as one compact line for the 任务 row and the
 * completion notice — the numbers the morning-after diagnosis actually
 * wanted (总时长、重试与等待、工具量、截断), nothing more.
 * @param stats - the folded accounting.
 * @returns the line, e.g. `用时 8.5 分钟 · 12 步 · 网关重试 2 次（累计等待 8.4 分钟） · 工具 45 次 · 输出截断 4 次 · tokens 进 1.2M/出 35k`.
 */
export function formatRunStats(stats: ScheduleRunStats): string {
  const minutes = stats.durationMs / 60_000
  const span = minutes >= 10 ? `${Math.round(minutes)} 分钟` : `${Math.round(minutes * 10) / 10} 分钟`
  const parts = [`用时 ${span}`, `${stats.steps} 步`]
  if (stats.retries > 0) {
    const waitMinutes = Math.round(stats.retryDelayMs / 6_000) / 10
    parts.push(`网关重试 ${stats.retries} 次（累计等待 ${waitMinutes} 分钟）`)
  }
  parts.push(`工具 ${stats.toolCalls} 次`)
  if (stats.truncations > 0) parts.push(`输出截断 ${stats.truncations} 次`)
  if (stats.steps > 0) parts.push(`tokens 进 ${formatTokens(stats.inputTokens)}/出 ${formatTokens(stats.outputTokens)}`)
  return parts.join(' · ')
}

/**
 * The proposal convention (ADR-0047 决定 7, ADR-0055 修订), appended by the
 * scheduler to every fired prompt. The 2026-10-10 morning incident retired
 * the envelope-as-prose era: a hand-written JSON envelope was fragile
 * (batch-merged actions, missing fields) and its loss surfaced only through
 * a whole extra repair turn. The convention now teaches the
 * `kb_propose_actions` tool — validation runs at the tool boundary and a
 * bad row is repaired within the same turn — while keeping the vocabulary
 * lesson (capability-agnostic kinds only; the mail machines live in the
 * mail capability's SKILL.md) and the honest-silence allowance. The
 * schedule's provenance rides the convention so the inbox entry keeps its
 * `schedule:<id>` lineage; the tool defaults to `agent:*` without it.
 *
 * The prose-envelope parser (`proposalOfAnswer`) survives as a fallback for
 * model inertia and stale prompt snapshots — the scheduler detects a
 * SUCCESSFUL tool nomination first and skips the parse, so the two paths
 * never double-enqueue.
 * @param prompt - the schedule's snapshot prompt.
 * @param provenance - the schedule's identity, relayed through the tool's
 *   `source`/`sourceName` params (the same trust strength as the envelope
 *   era: the model authored all of it either way).
 * @returns the prompt with the convention appended.
 */
export function withProposalConvention(
  prompt: string,
  provenance?: { readonly source: string; readonly sourceName: string },
): string {
  const provenanceLine = provenance === undefined
    ? ''
    : `\n本次调度的来源标识：调用本工具时传 source="${provenance.source}"、sourceName="${provenance.sourceName}"。`
  return `${prompt}
【调度约定（ADR-0047/0055）】任务完成后，若有值得人拍板的写入动作，请调用 kb_propose_actions 工具提交提议（本工具只入队，不执行任何动作）：
- title：一句话概括这批动作。
- actions：每项一个待人工批准的写入动作，常用类别与字段：
- {"kind":"append-log","entityPath":"<实体文件路径>","entityName":"<实体名，可省略>","text":"<流水一行>","reason":"<缘由>"}
- {"kind":"append-section","path":"<实体文件路径>","section":"决议|待办|…","text":"<内容>","why":"<缘由>"}
- {"kind":"edit-section","path":"<路径>","section":"<节名>","before":"<现状>","after":"<改为>","why":"<缘由>"}
- {"kind":"create-entity","entityType":"person|meeting|area|project","name":"<名>","reason":"<缘由>"}
- {"kind":"create-project","name":"<名>","reason":"<缘由>","areas":["<库中已有领域>"]}
- {"kind":"write-state","entityPath":"<路径>","entityName":"<名，可省略>","text":"<状态一行>","reason":"<缘由>"}
- {"kind":"save-resource","path":"resources/<名>.md","content":"<全文>","reason":"<缘由>"}
- {"kind":"add-todo","title":"<题目>","due":"YYYY-MM-DD 或省略","body":"<详情>","reason":"<缘由>"}
- {"kind":"add-memory","scope":"<能力名>","text":"<规则一句话>","reason":"<缘由>"}
- 溯源（ADR-0059）：若本任务是资源提炼（从 resources/ 等文件提炼实体的动态、状态），每条陈述事实的实体动作（append-log/write-state/create-link）必须携带 "sourcePath":"<来源资源路径>"，可选 "sourceQuote":"<原文摘句>"；纯决策类动作（add-todo、create-entity 命名等）不要求溯源，也不要编造来源。读过但没写成动作的资源若确无要点，须在 note 里声明「本期无要点」——调度收尾的读取闭合校验会把读过却无着落的资源当遗漏点名。
规则：只把值得人批准的写入列进提议，不为凑数编造；没有值得提议的就完全不调用本工具（纯文字汇报即可）；入队成功后不要再在回答里重复输出提议 JSON。动作不要自行执行（不要经 kb_write_state / kb_edit_section / kb_append_log 等落库），留给人在「提议」卡上勾选批准后再写入。${provenanceLine}`
}

/**
 * Inline a bound capability's instruction text ahead of the schedule's own
 * prompt (调度首跳直通，2026-10-10 性能追问采纳项 4): the fired session
 * starts already holding the SKILL.md body, sparing the agent its first
 * `kb_run_capability` round-trip (one tool call, one model step, and — in
 * the morning incident — a 64KB-class payload re-read). The instruction
 * text leads, the task's own prompt follows beneath a separator; the
 * proposal-envelope convention (withProposalConvention) still wraps the whole
 * from outside.
 * @param prompt - the schedule's snapshot prompt.
 * @param capability - the bound capability's name, for the framing line.
 * @param instructions - the assembled instruction text from `capabilityInstructions`.
 * @returns the composed prompt.
 */
export function withInlineInstructions(prompt: string, capability: string, instructions: string): string {
  return `${instructions}

---

以上是能力「${capability}」的完整指令正文（调度首跳直通，已随任务附带，无需再经 kb_run_capability 读取）。下面是本次调度任务本身的指示：

${prompt}`
}

/**
 * The inbox note for one filed proposal (ADR-0047): the session pointer, plus
 * the covered mail range when the envelope carried one — the hidden
 * watermark bookkeeping made visible on the row and the card, so the human
 * settles the entry knowing exactly which mails the verdict will close out.
 * @param proposal - what the answer parsed into.
 * @returns the note text.
 */
function inboxNoteOf(proposal: Proposal): string {
  const base = '会话可在任务页回看'
  const range = proposal.mails
  if (range === undefined) return base
  const day = (iso: string): string => {
    const at = new Date(iso)
    return Number.isNaN(at.getTime()) ? iso : `${at.getMonth() + 1}-${at.getDate()}`
  }
  const span = range.firstReadAt !== undefined ? `${day(range.firstReadAt)} → ${day(range.lastReadAt)}` : day(range.lastReadAt)
  return `${base} · 覆盖邮件 ${span}`
}

/** The frame's schedule-runner face: one background session over one fired schedule. */
export type ScheduleRunner = (args: {
  /** The schedule's stable id — the inbox entry's provenance (ADR-0047). */
  readonly id: string
  /** The schedule's display name; the session is titled 「调度 · <name>」. */
  readonly name: string
  /** The snapshot prompt to run. */
  readonly prompt: string
  /** An optional capability binding (首跳直通)：its instructions are inlined ahead of the prompt. */
  readonly capability?: string
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
 *   optional capability binding, the session cwd, the cancel signal, and the
 *   session-anchor sink.
 * @returns the session id, the final answer text, and the inbox entry id
 *   when one was filed.
 */
export async function runScheduledTask(options: {
  readonly ctx: Context
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly capability?: string
  readonly cwd?: string
  readonly signal?: AbortSignal
  readonly onSession?: (sessionId: string) => void
}): Promise<ScheduleRunResult> {
  const { ctx, id, name, prompt, capability, cwd, signal, onSession } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')
  const startedAt = Date.now()

  // 首跳直通 (2026-10-10 性能追问采纳项 4): a capability-bound schedule
  // starts with the capability's instruction text already inlined, saving
  // the agent its first `kb_run_capability` hop. A fetch failure degrades to
  // the plain prompt — the agent's own tool call remains the fallback path.
  let effectivePrompt = prompt
  if (capability !== undefined && capability !== '') {
    try {
      const instructions = await capabilityInstructions(ctx, capability)
      effectivePrompt = withInlineInstructions(prompt, capability, instructions)
    } catch (reason: unknown) {
      console.warn(`inline instructions for schedule ${id} (capability "${capability}") failed; firing with the plain prompt:`, reason)
    }
  }

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

  // ADR-0061 决定 1：开火前把会话登记进调度登记簿——此后直到回合落定，
  // kb_add_todo 拒绝直写，把无人监督的自动运行逼回提议队列。登记失败只警告
  // 降级（提示词约定仍在教提议路径），回合结束即注销；漏注销由 TTL 兜底。
  try {
    await scheduledRunMark(ctx, { sessionId })
  } catch (reason: unknown) {
    console.warn(`scheduled-run mark for schedule ${id} failed; the run proceeds ungated:`, reason)
  }
  let answer: string
  try {
    answer = await askTurn({
      session,
      sessionId,
      // ADR-0047 决定 7 / ADR-0055: the proposal convention rides every fire
      // (see withProposalConvention) — the schedule author never hand-writes
      // it, and since ADR-0055 it teaches the kb_propose_actions tool.
      // 首跳直通 composes inside it: instructions lead, the convention wraps all.
      prompt: withProposalConvention(effectivePrompt, { source: `schedule:${id}`, sourceName: name }),
      ...(signal !== undefined ? { signal } : {}),
    })
  } finally {
    void scheduledRunForget(ctx, { sessionId }).catch(() => {})
  }

  // The durable log is read once here and reused: the tool-nomination probe
  // needs it before deciding the parse path, and the stats fold reuses the
  // same events (a repair turn refetches — the rare path pays twice).
  let events: readonly SessionWireEvent[] = []
  let eventsRead = false
  try {
    events = await collectEvents(session, sessionId, signal)
    eventsRead = true
  } catch (reason: unknown) {
    console.warn(`stats collection for schedule ${id} failed; continuing without:`, reason)
  }

  // ADR-0055: when the model nominated through kb_propose_actions and the
  // call SUCCEEDED, the entry is already on disk — parsing the prose would
  // risk a double enqueue, so the tool path skips the parse entirely and
  // looks the entry up (bounded to this run) for the notice's 分流 instead.
  // A FAILED tool call is not a nomination (nothing was enqueued): the prose
  // fallback stays live (2026-10-10 ocr 评审 #4 — the old check keyed on the
  // bare tool/call and silently dropped a valid prose envelope behind it).
  let nominatedViaTool = toolNominationSucceeded(events)

  // 校验 B 的供料（ADR-0059 决定 2）：工具入队路径下，命中条目的载荷与
  // note 在这里一并取回——闭合扫描要用它的 actions 和「无要点」豁免声明。
  let freshActions: readonly ProposalAction[] | undefined
  let freshNote: string | undefined

  // Anti-silent-loss (2026-10-10 早晨事故): an answer that clearly TRIED to
  // close with an envelope but failed field validation used to vanish —
  // proposalOfAnswer returned null, nothing warned, the nomination was gone.
  // Now the rejection is diagnosed (which kind missed which fields), warned,
  // and the model gets exactly one repair turn quoting the diagnostic; a
  // prose answer without any envelope-shaped fragment stays honest silence.
  // The whole prose path is the FALLBACK now (model inertia, stale prompt
  // snapshots); a successful tool nomination skips it entirely.
  let finalAnswer = answer
  let proposal: ReturnType<typeof proposalOfAnswer> = null
  let proposalId: string | undefined
  if (!nominatedViaTool) {
    proposal = proposalOfAnswer(finalAnswer, `调度「${name}」的提议`)
    if (proposal === null) {
      const rejection = envelopeRejectionOf(finalAnswer)
      if (rejection !== undefined) {
        console.warn(`proposal envelope for schedule ${id} rejected; asking for one repair turn: ${rejection}`)
        // 修复轮也是一轮带工具的回合（ADR-0061 决定 1）：重新登记再开口，
        // 结束即注销，与主回合同一纪律。
        try {
          await scheduledRunMark(ctx, { sessionId })
        } catch (reason: unknown) {
          console.warn(`scheduled-run re-mark for schedule ${id} failed; the repair turn proceeds ungated:`, reason)
        }
        try {
          finalAnswer = await askTurn({
            session,
            sessionId,
            prompt: `你上一条回答末尾的提议信封未通过校验：${rejection}。请按报错修正动作的字段形态（保持原有的动作类别与意图，逐封展开所需字段，不要合并成批量数组），在回答最末尾重新输出完整的提议信封 JSON；若确实没有值得提议的动作，直接回复「无提议」即可。`,
            ...(signal !== undefined ? { signal } : {}),
          })
        } finally {
          void scheduledRunForget(ctx, { sessionId }).catch(() => {})
        }
        // The repair turn added events; refetch so the stats cover the
        // whole run, repair included.
        try {
          events = await collectEvents(session, sessionId, signal)
          eventsRead = true
        } catch (reason: unknown) {
          console.warn(`stats refetch for schedule ${id} failed; keeping the earlier read:`, reason)
        }
        // 修复轮重检 (2026-10-10 ocr 评审 #2): the repaired model may have
        // switched to the kb_propose_actions tool instead of printing prose —
        // re-check before parsing, or a tool enqueue PLUS a prose envelope
        // would land the same proposal twice. A successful tool call wins;
        // only a still-un-nominated answer falls back to the prose parse.
        nominatedViaTool = toolNominationSucceeded(events)
        if (!nominatedViaTool) proposal = proposalOfAnswer(finalAnswer, `调度「${name}」的提议`)
      }
    }
  }

  if (nominatedViaTool) {
    // The successful tool enqueue is on disk; look this run's entry up for
    // the notice's 分流. The createdAt lower bound (2026-10-10 ocr 评审 #3)
    // keeps a validation failure from adopting a PREVIOUS fire's still-
    // pending entry as this run's proposal. A lookup failure — or a miss —
    // degrades to the plain notice; parsing prose here could double-enqueue,
    // so it never falls back to that.
    try {
      const inbox = await loadProposalInbox(ctx)
      const fresh = [...inbox.proposals].reverse()
        .find(row => row.source === `schedule:${id}` && row.status === 'pending'
          && Date.parse(row.createdAt) >= startedAt)
      if (fresh !== undefined) {
        proposalId = fresh.id
        const payload = fresh.proposal as { actions?: ProposalAction[] } | null
        freshActions = Array.isArray(payload?.actions) ? payload.actions : []
        freshNote = fresh.note
      }
    } catch (reason: unknown) {
      console.warn(`inbox lookup for schedule ${id} failed; keeping the plain notice:`, reason)
    }
  }

  // Performance accounting (2026-10-10 晨间事故的性能追问): fold the fresh
  // session's durable log into one stats line — the diagnosis that took a
  // manual zstd surgery this morning becomes a number the 任务 row always
  // carries. Statistics are garnish: a read failure drops them, never the run.
  const stats: ScheduleRunStats | undefined = eventsRead ? statsFromEvents(events, Date.now() - startedAt) : undefined

  // ADR-0047: an answer that closes with the actions-envelope JSON becomes
  // an inbox entry — the human decides from the 提议 tab, the session stays
  // the evidence. Enqueue trouble never fails the run: the plain completion
  // notice is the fallback, and the answer lives on in the session.
  if (proposal !== null) {
    try {
      const enqueued = await enqueueInboxProposal(ctx, {
        source: `schedule:${id}`,
        sourceName: name,
        title: proposal.title,
        note: inboxNoteOf(proposal),
        proposal: proposal as unknown as Parameters<typeof enqueueInboxProposal>[1]['proposal'],
      })
      proposalId = enqueued.id
    } catch (reason: unknown) {
      // The plain completion notice stays the fallback, but the loss must
      // stay diagnosable — the 50-pending soft cap rejecting silently would
      // drop every later proposal with no trace anywhere.
      console.warn(`proposal enqueue for schedule ${id} failed; keeping the plain notice:`, reason)
      proposalId = undefined
    }
  }

  // 校验 B（读取闭合，ADR-0059 决定 2）：run 收尾扫描——同一份事件日志既
  // 作证「本轮读过什么」，也作证「写了什么出处」。违例不阻塞（入队早已
  // 发生，ToolRunContext 无 sessionId 的既有限制使工具层也做不了这次核
  // 对），而是附到卡片的高亮通道上，人审批准前可见，并随结果计入完成通知。
  let warnings: readonly string[] | undefined
  if (proposalId !== undefined && eventsRead) {
    const actions = freshActions ?? proposal?.actions ?? []
    const note = freshNote ?? (proposal !== null ? inboxNoteOf(proposal) : undefined)
    const highlights = readClosureWarnings(readPathsFromEvents(events), actions, note)
    if (highlights.length > 0) {
      try {
        await annotateInboxProposal(ctx, { id: proposalId, highlights })
        warnings = highlights.map(highlight => `${highlight.sender}：${highlight.subject} — ${highlight.why}`)
      } catch (reason: unknown) {
        console.warn(`read-closure annotation for schedule ${id} failed; the card ships unannotated:`, reason)
      }
    }
  }
  // 运行上报的起止锚（born-terminal 报告的两端）：startedAt 即会话创建时刻，
  // finishedAt 收在此处——提案入队、闭合扫描都不算进运行时长。
  const finishedAt = new Date().toISOString()
  const startedAtIso = new Date(startedAt).toISOString()
  if (proposalId !== undefined) {
    return {
      sessionId,
      startedAt: startedAtIso,
      finishedAt,
      answer: finalAnswer,
      proposalId,
      ...(warnings !== undefined ? { warnings } : {}),
      ...(stats !== undefined ? { stats } : {}),
    }
  }
  return { sessionId, startedAt: startedAtIso, finishedAt, answer: finalAnswer, ...(stats !== undefined ? { stats } : {}) }
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
