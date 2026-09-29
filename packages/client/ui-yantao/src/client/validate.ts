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
 * target resolving to nothing) — and reaches the card without passing the
 * model at all (ADR-0036 决定 2).
 *
 * The model is a narrow diagnostician (ADR-0036): the prescan's findings are
 * shown to the human directly, so the prompt attaches the two lists only as
 * context and tells the model not to recite them. Its whole budget goes to
 * three semantic dimensions — stale / contradiction / missing — emitted as
 * display-row findings plus link-only targets. Pages are not created here
 * (that is the 提炼 gesture's craft) and prose is never touched: the verdict
 * maps onto a `RefineVerdict` with `creates` empty, so `verdictToProposal`
 * and the applier machinery run unchanged.
 * @module @deepseek-ai/dsh-client-ui-yantao/validate
 */
import type { Context } from '@deepseek-ai/cordis'
import type { KbGraphResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { cancelSessionTurnOnAbort, kbRemoteOf, sessionRemoteOf, unwrapRemote } from './remote.ts'
import { jsonRound } from './turn-answer.ts'
import {
  answersPrompt, contentViewOf, ENTITY_CLIP, field, parseRefineVerdict, rows, verdictToProposal,
  type RefineEntityView, type RefineQuestion, type RefineTargetVerdict, type RefineVerdict,
  type RefineViews,
} from './refine.ts'
import type { Proposal, ProposalAction } from './proposal.ts'
import { verifyValidateVerdict } from './validate-verify.ts'
import { brokenLinkSectionFixes, suggestLinkFixes } from './broken-link-suggest.ts'

/**
 * The kinds a model finding may name (ADR-0036 决定 3): the semantic
 * dimensions only — `orphan`/`broken-link` belong to the prescan, which
 * reports them itself, so a model row carrying them is recitation, dropped
 * by the parser here and verified away by the defence layer (ADR-0036 决定 5).
 */
const FINDING_KINDS: readonly string[] = ['stale', 'contradiction', 'missing']

/** One finding: a pure display row on the card — the fix, if any, rides in the action groups. */
export interface ValidateFinding {
  readonly kind: string
  /** The entity or link the finding names. */
  readonly subject: string
  /** One line of why. */
  readonly why: string
}

/** The validate verdict (ADR-0036 决定 1/3): a pure check-up — findings and link-only targets; no creates, no todos. */
export interface ValidateVerdict {
  readonly reason: string
  readonly findings: readonly ValidateFinding[]
  readonly targets: readonly RefineTargetVerdict[]
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
  /** Deterministic rows the card's prescan block shows: orphans + degraded display rows + fix rows (ADR-0036 决定 6). */
  readonly prescan: number
  readonly findings: number
  /** Rows the defence layer dropped before the card saw them (ADR-0036 决定 5). */
  readonly filtered: number
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
 * The diagnostic prompt (ADR-0036 决定 2/3/7): the prescan's two lists ride
 * along as context only — the card already shows them, so the prompt says
 * not to recite — plus the whole roster and the named entities' full text
 * (each clipped at the roster clip). Three semantic dimensions, their
 * criteria hard-coded line by line; the JSON shape pins the pure check-up —
 * no creates, no todos, targets carry links only — and the converter strips
 * edits regardless, so a disobedient model cannot write prose through the
 * card.
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
    '下面先给出程序预扫出的确定性问题清单——这些系统已经直接呈现给用户，你不需要在回答里复述它们；然后是知识库的实体花名册，以及被点名实体的全文。你的任务是在这份清单之上做语义研判：',
    '- 过期：点名实体的「状态」等小节声称的事，与该实体正文的其它部分或更近的内容相冲突；',
    '- 矛盾：单个实体之内、或点名实体彼此之间，存在互相打架的陈述；',
    '- 缺实体：多处指向一个还不存在的主语，值得为它建一个新实体——你只提示这件事，不要试图产出建页方案，建页由用户在「提炼」手势里完成。',
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
    '  "findings": [{ "kind": "stale", "subject": "实体名或链接", "why": "一句话说明" }],',
    '  "targets": [{ "entity": "已有实体名", "links": [{ "to": "另一实体名", "why": "为什么关联" }], "log": "追加到该实体流水的一句话" }],',
    '  "questions": [{ "question": "想问用户的问题", "why": "为什么需要问" }]',
    '}',
    '```',
    '',
    '规则：',
    '- findings 是给用户看的语义发现，kind 只能是 stale（过期）/contradiction（矛盾）/missing（缺失）之一；孤儿与失效双链已由系统预扫并直接呈现，复述一律无效；没有发现就是空数组。',
    '- 本次是纯体检：不建页、不改正文。没有 creates，没有 todos，targets 里也没有 edits——你只能通过 links 建议补链。',
    '- 每个建议补链的已有实体各给一个 targets 条目，entity 用花名册里的名字原文；名单里没有的不要猜，宁可漏掉。',
    '- links 的 to 必须是花名册里的名字原文。',
    '- 不要把 `流水` 写进任何字段；不要碰 frontmatter。',
    '- 有会影响处置方式的关键疑问才提问，最多三个；需要提问时 targets 留空数组，等用户回答后再给最终结论。没有疑问 questions 就是空数组。',
  ]
  return blocks.join('\n')
}

/**
 * Read the model's answer (ADR-0036 决定 3/7): findings carry the semantic
 * kinds only; `targets`/`questions` reuse the v2 parser wholesale, so the
 * same tolerance (empty rows dropped, unknown kinds dropped, 宁可少不可错)
 * governs everything. `creates`/`todos` keys, should a stale model emit
 * them, are silently ignored — the pure check-up has no slot for them. A
 * missing `targets` array falls back to the v2 parser's own reading.
 * Unreadable JSON is an error the caller shows — a silent empty verdict
 * would look like "nothing to do".
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
  return {
    reason: base.reason,
    findings,
    targets: base.targets,
    questions: base.questions,
  }
}

/** The re-ask when the first answer is not readable JSON: JSON alone, nothing else. */
const VALIDATE_REASK = '你上一条回答无法解析为 JSON。请只输出一个 JSON 对象（含 findings/targets/questions 字段），不要输出任何其它文字。'

/**
 * The deterministic broken-link material one run attaches to the card
 * (ADR-0036 决定 4): tickable `edit-section` rows for the links a roster
 * candidate can repair, display-only rows for the rest — no candidate
 * cleared the bar, or the link hides where code may not write (the
 * append-only `流水`, frontmatter, the preamble).
 */
export interface BrokenLinkFixes {
  readonly actions: readonly ProposalAction[]
  readonly findings: readonly ValidateFinding[]
}

/**
 * Turn the prescan's broken links into fix material: for each link, score
 * the roster ({@link suggestLinkFixes}); a best candidate at or above the
 * bar yields one `edit-section` action per affected section (except `流水`,
 * which degrades to a display row — the append-only iron law outranks the
 * fix), no candidate yields a 「无可信修复候选」 display row, and a link no
 * section body holds degrades likewise. Duplicate (host, target) pairs —
 * the same broken link written twice — collapse into one pass.
 * @param preScan - the run's (scoped) prescan.
 * @param views - every entity's name, path and full text.
 * @param roster - every entity name, the candidates score against.
 * @returns the actions and display rows, in prescan order.
 */
export function brokenLinkFixesOf(
  preScan: ValidatePreScan,
  views: readonly RefineEntityView[],
  roster: readonly { readonly name: string }[],
): BrokenLinkFixes {
  const byPath = new Map(views.map(view => [view.path, view]))
  const actions: ProposalAction[] = []
  const findings: ValidateFinding[] = []
  const seen = new Set<string>()
  for (const link of preScan.broken) {
    const key = `${link.host}\u0000${link.target}`
    if (seen.has(key)) continue
    seen.add(key)
    const host = byPath.get(link.host)
    if (host === undefined) continue
    const candidates = suggestLinkFixes(link.target, roster)
    const subject = `[[${link.target}]]`
    const best = candidates.at(0)
    if (best === undefined) {
      findings.push({ kind: 'broken-link', subject, why: `无可信修复候选（位于 ${host.name}），请手工改写` })
      continue
    }
    const fixes = brokenLinkSectionFixes(host.content, link.target, best.name)
    if (fixes.length === 0) {
      findings.push({ kind: 'broken-link', subject, why: `失链不在任何小节正文里（位于 ${host.name}），请手工改写` })
      continue
    }
    for (const fix of fixes) {
      if (fix.section === '流水') {
        findings.push({ kind: 'broken-link', subject, why: `「流水」只增不改（位于 ${host.name}），这条失链请手工处理` })
        continue
      }
      actions.push({
        kind: 'edit-section',
        path: host.path,
        section: fix.section,
        before: fix.before,
        after: fix.after,
        why: `将 [[${link.target}]]（位于 ${host.name}）改写为 [[${best.name}]]`,
      })
    }
  }
  return { actions, findings }
}

/**
 * The deterministic material one run hands the card (ADR-0036 决定 2/4): the
 * prescan's orphans for display, plus the broken-link fix material
 * ({@link brokenLinkFixesOf}) — tickable `edit-section` rows for the links a
 * roster candidate can repair, display-only rows for the rest.
 */
export interface ValidateCardBlocks {
  readonly orphans: readonly ValidateOrphan[]
  readonly fixes: BrokenLinkFixes
}

/**
 * Turn a validate verdict into a proposal (ADR-0036 决定 1/4/6): peel
 * `findings` off, map the rest onto the v2 verdict shape with `creates`
 * pinned empty, and let `verdictToProposal` build the model block. Targets'
 * `edits` are stripped here, not only banned in the prompt (a target left
 * with nothing at all simply contributes no rows) — the check-up produces
 * links, never prose. The deterministic blocks ride separately: the fix
 * actions are placed at the FRONT of the execution order (the applier
 * resolves ticked indices against `[...prescan.actions, ...actions]`) and
 * packaged with the orphans and the degraded display rows into `prescan`,
 * so a prescan row and a model row can never meet in one array.
 * @param verdict - what the model proposed.
 * @param views - the entities the target names resolve against.
 * @param title - the card's heading; the session's name.
 * @param blocks - the deterministic prescan material; absent for tests and
 *   degenerate runs without one.
 * @returns the proposal, with the model findings attached as its display rows.
 */
export function verdictToValidateProposal(
  verdict: ValidateVerdict,
  views: RefineViews,
  title: string,
  blocks?: ValidateCardBlocks,
): Proposal {
  const refined: RefineVerdict = {
    relevant: true,
    reason: verdict.reason,
    targets: verdict.targets.map(target => ({ ...target, edits: [] })),
    creates: [],
    questions: [],
  }
  const proposal = verdictToProposal(refined, views, title)
  const fixActions = blocks?.fixes.actions ?? []
  return {
    ...proposal,
    ...(fixActions.length > 0 ? { actions: [...fixActions, ...proposal.actions] } : {}),
    ...(blocks === undefined ? {} : {
      prescan: {
        orphans: blocks.orphans,
        findings: blocks.fixes.findings,
        actions: blocks.fixes.actions,
      },
    }),
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
 * Run one validate pass (ADR-0035/0036): prescan the graph, read every
 * entity, create a session named 「实体校验 <日期>」, take one waited-out
 * JSON turn, and turn the verdict into a proposal — nothing here writes to
 * the KB. A verdict with questions pauses the run for the human's answers,
 * continuing in the same session (at most one round).
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

  // Deterministic fix material (ADR-0036 决定 4): computed once, before the
  // verdict even exists — the prescan's broken links never pass the model.
  const blocks: ValidateCardBlocks = { orphans: preScan.orphans, fixes: brokenLinkFixesOf(preScan, views, roster) }
  const prescanRows = blocks.orphans.length + blocks.fixes.findings.length + blocks.fixes.actions.length

  const stats = (findings: number, filtered: number): ValidateStats => ({
    entities: preScan.entities,
    prescan: prescanRows,
    findings,
    filtered,
    tokens: tally.total,
    elapsedMs: Date.now() - startedAt,
  })

  const finish = (final: ValidateVerdict): ValidateRun => {
    onStage?.('proposal')
    // Defence before display (ADR-0036 决定 5): the model's rows are checked
    // against the roster, the named entities and the broken targets — what
    // resolves to nothing never reaches the card.
    const checked = verifyValidateVerdict({
      verdict: final,
      rosterNames: roster.map(entry => entry.name),
      namedNames: [...namedNames],
      brokenTargets: preScan.broken.map(link => link.target),
    })
    const filtered = checked.counts.findings + checked.counts.targets + checked.counts.links
    const proposal = verdictToValidateProposal(checked.verdict, { roster: views }, sessionName, blocks)
    return {
      sessionId,
      title: sessionName,
      reason: checked.verdict.reason,
      preScan,
      stats: stats(checked.verdict.findings.length, filtered),
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
      stats: stats(0, 0),
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
