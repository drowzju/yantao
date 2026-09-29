/**
 * The validate gesture (ADR-0035): one manual gesture scans the whole KB —
 * a deterministic prescan first, then one real dsh session judges — and ends
 * in a proposal card, the fourth gesture beside 归入 / 提炼 / 提炼到实体.
 *
 * The pipeline mirrors refine's exactly (client-orchestrated session →
 * `jsonRound` → verdict → proposal): the agent's own `kb_*` writes never pass
 * a human confirmation (ADR-0026), so an instruction capability could never
 * honour the one thing a check-up owes the human. The prescan is pure graph
 * arithmetic on `yantaoKb.graph()`'s payload — orphans (incoming ≤ 1, the
 * todo singleton excluded as a structural singleton) and broken links (a
 * target resolving to nothing) — and doubles as the model's roadmap: its
 * budget goes to judgement, not to needle-searching.
 *
 * L1 (this module) may only create pages and links: the prompt pins targets'
 * `edits` to empty and the converter strips them regardless — `write-state`
 * is never on the whitelist, and `todos` are L2's unlock (ADR-0036). The
 * verdict reuses the v2 entry shapes wholesale: after peeling `findings` and
 * `todos` off, what remains maps one-to-one onto a `RefineVerdict`, so
 * `verdictToProposal` and the whole applier machinery run unchanged.
 * @module @deepseek-ai/dsh-client-ui-yantao/validate
 */
import type { Context } from '@deepseek-ai/cordis'
import type { KbGraphResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { cancelSessionTurnOnAbort, kbRemoteOf, sessionRemoteOf, unwrapRemote } from './remote.ts'
import { jsonRound } from './turn-answer.ts'
import {
  answersPrompt, contentViewOf, ENTITY_CLIP, field, parseRefineVerdict, rows, verdictToProposal,
  type RefineCreateVerdict, type RefineEntityView, type RefineQuestion, type RefineTargetVerdict, type RefineVerdict,
  type RefineViews,
} from './refine.ts'
import type { Proposal } from './proposal.ts'

/** The kinds a finding may name (ADR-0035 决定 3); anything else is dropped, not guessed. */
const FINDING_KINDS: readonly string[] = ['orphan', 'broken-link', 'stale', 'contradiction', 'missing']

/** One finding: a pure display row on the card — the fix, if any, rides in the action groups. */
export interface ValidateFinding {
  readonly kind: string
  /** The entity or link the finding names. */
  readonly subject: string
  /** One line of why. */
  readonly why: string
}

/** One todo the verdict proposes (L2's unlock; L1's prompt pins the array empty). */
export interface ValidateTodoVerdict {
  readonly title: string
  /** A `YYYY-MM-DD` due date, when the model saw one. */
  readonly due?: string
  readonly body: string
}

/** The validate verdict (ADR-0035 决定 3): findings and todos are the new species; the rest is v2 verbatim. */
export interface ValidateVerdict {
  readonly reason: string
  readonly findings: readonly ValidateFinding[]
  readonly targets: readonly RefineTargetVerdict[]
  readonly creates: readonly RefineCreateVerdict[]
  readonly todos: readonly ValidateTodoVerdict[]
  readonly questions: readonly RefineQuestion[]
}

/** One orphan the prescan found: an entity few or no others point at. */
export interface ValidateOrphan {
  readonly path: string
  readonly name: string
  readonly type: string
  /** How many links resolve into it. */
  readonly incoming: number
}

/** One broken link the prescan found: a `[[…]]` that resolves to nothing. */
export interface ValidateBrokenLink {
  /** The file the link lives in. */
  readonly host: string
  /** The target as written inside the brackets. */
  readonly target: string
}

/** The deterministic half of a validate run — zero tokens, zero hallucination. */
export interface ValidatePreScan {
  /** How many entity files the KB holds. */
  readonly entities: number
  /** Entities with at most one inbound link; the todo singleton is excluded. */
  readonly orphans: readonly ValidateOrphan[]
  /** Every unresolved `[[…]]`, paired with its host. */
  readonly broken: readonly ValidateBrokenLink[]
}

/** The run's closing tally (ADR-0035 决定 6): never persisted — the approved card lives in the 流水. */
export interface ValidateStats {
  readonly entities: number
  readonly findings: number
  /** Summed `totalTokens` (input + output where the total is absent) over every step. */
  readonly tokens: number
  readonly elapsedMs: number
}

/** The result of one validate run: the session it happened in, the prescan, the card, the tally. */
export interface ValidateRun {
  readonly sessionId: string
  readonly title: string
  readonly reason: string
  readonly preScan: ValidatePreScan
  readonly stats: ValidateStats
  /** The card — absent only when the verdict asked questions instead of proposing. */
  readonly proposal?: Proposal
  /** The model's questions, when it asked before proposing (at most one round, ADR-0030's semantics). */
  readonly questions?: readonly RefineQuestion[]
  readonly continueWithAnswers?: (answers: readonly string[]) => Promise<ValidateRun>
}

/** The coarse stages the frame's task row reports (ADR-0035 决定 6). */
export type ValidateStage = 'prescan' | 'analyse' | 'proposal'

/**
 * The run's angle (ADR-0035, 2026-09-29 修订): the entry buttons live in the
 * 人物 / 项目 tabs, so each run judges one entity kind — the prescan narrows
 * to that kind's orphans and broken links, while the roster stays whole (a
 * link may resolve to any entity).
 */
export type ValidateScope = 'person' | 'project'

/** The frame's validate face: one scoped run, cancellable through the signal. */
export type ValidateRunner = (options: {
  readonly scope: ValidateScope
  readonly signal?: AbortSignal
  readonly onStage?: (stage: ValidateStage) => void
  /** Fires as soon as the run's session exists — lets the task row anchor 查看/详情 before the verdict. */
  readonly onSession?: (sessionId: string) => void
}) => Promise<ValidateRun>

/** The todo singleton's KB-relative path — a structural singleton, never an orphan. */
const TODOS_SINGLETON = 'entities/todos.md'

/** The entity type a node's path implies, for the prompt's readability. */
function entityTypeOf(path: string): string {
  const dir = path.split('/')[1] ?? ''
  const table: Record<string, string> = { projects: 'project', areas: 'area', people: 'person', meetings: 'meeting' }
  return table[dir] ?? ''
}

/** The display name of one entity path: the stem (a dated meeting keeps its full stem — it is unique). */
function entityNameOf(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.endsWith('.md') ? base.slice(0, -'.md'.length) : base
}

/**
 * Compute the deterministic prescan from the whole-KB graph: orphans are
 * entities at most one link resolves into (the todo singleton excepted —
 * every link-less KB would otherwise flag it), broken links are edges whose
 * target resolved to nothing (zero hits or ambiguous).
 * @param graph - the `yantaoKb.graph()` payload.
 * @returns the prescan.
 */
export function preScanOf(graph: KbGraphResult): ValidatePreScan {
  const incoming = new Map<string, number>()
  for (const node of graph.nodes) incoming.set(node, 0)
  const broken: ValidateBrokenLink[] = []
  for (const edge of graph.edges) {
    if (edge.to === null) {
      broken.push({ host: edge.from, target: edge.target })
      continue
    }
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  }
  const orphans = graph.nodes
    .filter(node => node !== TODOS_SINGLETON && (incoming.get(node) ?? 0) <= 1)
    .map(node => ({ path: node, name: entityNameOf(node), type: entityTypeOf(node), incoming: incoming.get(node) ?? 0 }))
  return { entities: graph.nodes.length, orphans, broken }
}

/**
 * The validate prompt (L1): the prescan's two lists, the whole roster, and
 * the named entities' full text (each clipped at the roster clip). The JSON
 * shape pins L1's whitelist — targets' `edits` empty, `todos` empty — and
 * the converter strips both regardless, so a disobedient model cannot write
 * prose through the card.
 * @param args - the prescan, the roster (every entity's name and type), and
 *   the named entities' contents.
 * @returns the prompt text.
 */
export function validatePrompt(args: {
  readonly preScan: ValidatePreScan
  readonly roster: readonly { readonly name: string; readonly type: string }[]
  readonly named: readonly { readonly name: string; readonly content: string }[]
  /** The run's angle, e.g. 「人物」 — absent means the whole KB. */
  readonly angle?: string
}): string {
  const { preScan } = args
  const blocks = [
    args.angle === undefined
      ? '你是个人知识库的整理助手。这是一次全库体检（实体校验）。'
      : `你是个人知识库的整理助手。这是一次实体校验，视角限定在「${args.angle}」类实体：预扫出的问题和点名实体都只来自这一类，但补链可以指向任何实体。`,
    '下面先给出程序预扫出的确定性问题清单，然后是知识库的实体花名册，以及被点名实体的全文。请研判这些问题该怎么处置：',
    '- 孤儿条目之间、孤儿与其它实体之间，是否该有双链；',
    '- 失效双链原本想指向什么——能否通过新建一个实体让它解析；',
    '- 是否有该建而未建的实体（比如多个孤儿共同指向一个还不存在的主题）。',
    '',
    `【预扫 · 孤儿条目（入链不超过 1）】共 ${preScan.orphans.length} 条`,
    ...(preScan.orphans.length === 0 ? ['（无）'] : preScan.orphans.map(orphan =>
      `- ${orphan.name}（${orphan.type}，入链 ${orphan.incoming}）`)),
    '',
    `【预扫 · 失效双链】共 ${preScan.broken.length} 条`,
    ...(preScan.broken.length === 0 ? ['（无）'] : preScan.broken.map(link =>
      `- [[${link.target}]]（写在 ${link.host}）`)),
    '',
    `【实体花名册】共 ${preScan.entities} 个`,
    ...args.roster.map(entry => `- ${entry.name}（${entry.type}）`),
    '',
    ...args.named.flatMap(view => [`【点名实体：${view.name}】`, view.content.trim(), '']),
    '请只输出一个 JSON 对象，不要输出任何其它文字：',
    '',
    '```json',
    '{',
    '  "reason": "一句话：这次体检的总体印象",',
    '  "findings": [{ "kind": "orphan", "subject": "实体名或链接", "why": "一句话说明" }],',
    '  "targets": [{ "entity": "已有实体名", "edits": [], "links": [{ "to": "另一实体名", "why": "为什么关联" }], "log": "追加到该实体流水的一句话" }],',
    '  "creates": [{ "entityType": "project", "name": "新实体名", "why": "为什么要新建", "edits": [{ "section": "目标", "after": "该小节的正文", "why": "为什么这样写" }], "links": [], "log": "" }],',
    '  "todos": [],',
    '  "questions": [{ "question": "想问用户的问题", "why": "为什么需要问" }]',
    '}',
    '```',
    '',
    '规则：',
    '- findings 是给用户看的发现清单，kind 只能是 orphan（孤儿）/broken-link（失效双链）/stale（陈旧）/contradiction（矛盾）/missing（缺失）之一；没有发现就是空数组。',
    '- 本次是 L1 标准体检：只建页、只建链。targets 的 edits 一律空数组——不许改任何已有实体的正文；todos 一律空数组。',
    '- 每个建议补链的已有实体各给一个 targets 条目，entity 用花名册里的名字原文；名单里没有的不要猜，宁可漏掉。',
    '- links 的 to 必须是花名册里的名字原文，或 creates 里的新实体名。',
    '- 确实需要新建实体才能修复时才用 creates；entityType 只能是 project/area/person/meeting 之一；edits 里只写你要填的区段（常用小节：project 目标/下一步/状态；area 标准/检视/状态；person 状态/近期工作动态；meeting 状态/决议/待办）。',
    '- 不要把 `流水` 写进 edits；不要碰 frontmatter。',
    '- 有会影响处置方式的关键疑问才提问，最多三个；需要提问时 targets、creates、todos 都留空数组，等用户回答后再给最终结论。没有疑问 questions 就是空数组。',
  ]
  return blocks.join('\n')
}

/**
 * Read the model's answer (ADR-0035 决定 3): `findings` and `todos` are this
 * verdict's new species; `targets`/`creates`/`questions` reuse the v2 parser
 * wholesale, so the same tolerance (empty rows dropped, unknown kinds
 * dropped, 宁可少不可错) governs everything. Unreadable JSON is an error the
 * caller shows — a silent empty verdict would look like "nothing to do".
 * @param text - the assistant message's text.
 * @returns the verdict.
 */
export function parseValidateVerdict(text: string): ValidateVerdict {
  const base = parseRefineVerdict(text)
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const source = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    // parseRefineVerdict already threw a readable error for this; reaching
    // here means it parsed for v2 but the source shifted — same verdict.
    parsed = {}
  }
  const value = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  const findings = rows(value.findings).map((row): ValidateFinding | undefined => {
    const kind = field(row, 'kind')
    const subject = field(row, 'subject')
    // A finding without a kind the card knows, or without a subject, is
    // noise, not a row.
    if (!FINDING_KINDS.includes(kind) || subject === '') return undefined
    return { kind, subject, why: field(row, 'why') }
  }).filter((finding): finding is ValidateFinding => finding !== undefined)
  const todos = rows(value.todos).map((row): ValidateTodoVerdict | undefined => {
    const title = field(row, 'title')
    if (title === '') return undefined
    const due = field(row, 'due')
    return { title, ...(due !== '' ? { due } : {}), body: field(row, 'body') }
  }).filter((todo): todo is ValidateTodoVerdict => todo !== undefined)
  return {
    reason: base.reason,
    findings,
    targets: base.targets,
    creates: base.creates,
    todos,
    questions: base.questions,
  }
}

/** The re-ask when the first answer is not readable JSON: JSON alone, nothing else. */
const VALIDATE_REASK = '你上一条回答无法解析为 JSON。请只输出一个 JSON 对象（含 findings/targets/creates/todos/questions 字段），不要输出任何其它文字。'

/**
 * Turn a validate verdict into a proposal (ADR-0035 决定 3/4): peel
 * `findings` and `todos` off, map the rest onto the v2 verdict shape, and let
 * `verdictToProposal` build the card. L1's whitelist is enforced here, not
 * only in the prompt: targets' `edits` are stripped (a target left with
 * nothing at all simply contributes no rows) and `todos` never become
 * actions — L2's unlock, ADR-0036's business.
 * @param verdict - what the model proposed.
 * @param views - the entities the target names resolve against.
 * @param title - the card's heading; the session's name.
 * @returns the proposal, with the findings attached as its display rows.
 */
export function verdictToValidateProposal(
  verdict: ValidateVerdict,
  views: RefineViews,
  title: string,
): Proposal {
  const refined: RefineVerdict = {
    relevant: true,
    reason: verdict.reason,
    // L1: prose edits to existing entities are out of the whitelist.
    targets: verdict.targets.map(target => ({ ...target, edits: [] })),
    creates: verdict.creates,
    questions: [],
  }
  const proposal = verdictToProposal(refined, views, title)
  return {
    ...proposal,
    ...(verdict.findings.length > 0 ? { findings: verdict.findings } : {}),
  }
}

/** One token tally accumulated across every step of a run. */
class TokenTally {
  input = 0
  output = 0
  total = 0

  add(usage: { inputTokens: number; outputTokens: number; totalTokens?: number }): void {
    this.input += usage.inputTokens
    this.output += usage.outputTokens
    this.total += usage.totalTokens ?? usage.inputTokens + usage.outputTokens
  }
}

/**
 * Run one validate pass (ADR-0035): prescan the graph, read every entity,
 * create a session named 「实体校验 <日期>」, take one waited-out JSON turn,
 * and turn the verdict into a proposal — nothing here writes to the KB. A
 * verdict with questions pauses the run for the human's answers, continuing
 * in the same session (at most one round).
 * @param options - the context, the session cwd, the abort signal, and the
 *   stage reporter.
 * @returns the run.
 */
export async function runValidate(options: {
  readonly ctx: Context
  /** The run's angle: only this entity kind's problems are judged. */
  readonly scope: ValidateScope
  readonly cwd?: string
  readonly signal?: AbortSignal
  readonly onStage?: (stage: ValidateStage) => void
  /** Fired the moment the session is created, so failures still leave a viewable session. */
  readonly onSession?: (sessionId: string) => void
}): Promise<ValidateRun> {
  const { ctx, scope, cwd, signal, onStage, onSession } = options
  const startedAt = Date.now()
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw new Error('没有挂载 yantaoKb Remote 命名空间')
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')

  onStage?.('prescan')
  const graph = unwrapRemote(await kb.graph())
  // The prescan runs on the whole graph (an orphan is judged by every
  // inbound link, wherever it comes from), then narrows to the scope: only
  // this kind's orphans and this kind's hosts' broken links enter the prompt.
  const whole = preScanOf(graph)
  const scoped = (path: string): boolean => entityTypeOf(path) === scope
  const preScan: ValidatePreScan = {
    entities: graph.nodes.filter(scoped).length,
    orphans: whole.orphans.filter(orphan => scoped(orphan.path)),
    broken: whole.broken.filter(link => scoped(link.host)),
  }
  const angle = scope === 'person' ? '人物' : '项目'
  // Views for every entity (the target names resolve against the whole
  // roster, and `before` previews need real bodies), but only the prescan's
  // named entities go into the prompt (ADR-0035 决定 4's budget line).
  const read = async (path: string): Promise<string> => unwrapRemote(await kb.read(path)).content
  const roster = graph.nodes.map(path => ({ name: entityNameOf(path), type: entityTypeOf(path) }))
  const views: RefineEntityView[] = await Promise.all(graph.nodes.map(async (path) => {
    const name = entityNameOf(path)
    // The placeholder path (binary) never lands in the prompt for an unnamed
    // entity, and it reads fine as a `before` preview of nothing.
    const view = await contentViewOf(read, path, name, Number.MAX_SAFE_INTEGER)
    return { name, path, content: view.content }
  }))
  const namedNames = new Set([
    ...preScan.orphans.map(orphan => orphan.name),
    ...preScan.broken.map(broken => entityNameOf(broken.host)),
  ])
  const named = views
    .filter(view => namedNames.has(view.name))
    .map(view => ({ name: view.name, content: view.content.length > ENTITY_CLIP
      ? `${view.content.slice(0, ENTITY_CLIP)}\n（内容过长，已截断）`
      : view.content }))

  onStage?.('analyse')
  const created = await session.create(cwd === undefined ? {} : { cwd })
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId
  onSession?.(sessionId)
  // Domain data, not UI copy: the session's name lives in the KB's own
  // language, so it stays Chinese regardless of the workbench locale.
  const sessionName = `实体校验·${angle} ${new Date().toISOString().slice(0, 10)}`
  const named_ = await session.rename({ sessionId, title: sessionName })
  if (!named_.ok) throw named_.error
  if (signal !== undefined) cancelSessionTurnOnAbort(signal, session, sessionId)

  const tally = new TokenTally()
  const onUsage = (usage: { inputTokens: number; outputTokens: number; totalTokens?: number }): void => { tally.add(usage) }
  const stats = (findings: number): { entities: number; findings: number; tokens: number; elapsedMs: number } => ({
    entities: preScan.entities,
    findings,
    tokens: tally.total,
    elapsedMs: Date.now() - startedAt,
  })

  const finish = (final: ValidateVerdict): ValidateRun => {
    onStage?.('proposal')
    const proposal = verdictToValidateProposal(final, { roster: views }, sessionName)
    return {
      sessionId,
      title: sessionName,
      reason: final.reason,
      preScan,
      stats: stats(final.findings.length),
      proposal,
    }
  }

  const verdict = await jsonRound({
    session,
    sessionId,
    prompt: validatePrompt({ preScan, roster, named, angle }),
    reask: VALIDATE_REASK,
    parse: parseValidateVerdict,
    onUsage,
    ...signal !== undefined ? { signal } : {},
  })

  if (verdict.questions.length > 0) {
    const asked = verdict.questions
    return {
      sessionId,
      title: sessionName,
      reason: verdict.reason,
      preScan,
      stats: stats(0),
      questions: asked,
      continueWithAnswers: async (answers: readonly string[]): Promise<ValidateRun> => {
        const second = await jsonRound({
          session,
          sessionId,
          prompt: answersPrompt(asked, answers),
          reask: VALIDATE_REASK,
          parse: parseValidateVerdict,
          onUsage,
          ...signal !== undefined ? { signal } : {},
        })
        return finish(second)
      },
    }
  }
  return finish(verdict)
}
