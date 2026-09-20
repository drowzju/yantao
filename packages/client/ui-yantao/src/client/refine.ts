/**
 * The refine loop (ADR-0029, extended by ADR-0030): one real dsh session reads
 * an entity — and, when a resource is in play, that resource — and answers a
 * JSON verdict the human then confirms on the proposal card.
 *
 * Three gestures, one pipeline: dragging a resource onto an entity row (归入),
 * an entity row's right-click 「提炼」, and a resource row or directory's
 * right-click 「提炼到实体」 (distill) all land here. The session is created,
 * named (「提炼 <对象名>」) and driven from the browser through the session
 * Remote, exactly the mail analysis's path (ADR-0019) — no pre-step, no
 * capability declaration, no new RPC; the agent cannot start one itself. The
 * session is kept so the judgement can be re-read; nothing here writes to
 * the KB. The verdict becomes a Proposal whose `edit-section` rows carry the
 * section's current body as `before` — the applier re-reads and re-locates at
 * apply time (ADR-0029 决定 4), so `before` is a preview aid, not a snapshot
 * contract.
 *
 * The distill gesture turns the pipeline around: one resource collides with
 * the whole roster, and the verdict names every entity it touched — possibly
 * none, in which case it proposes a new entity (the applier creates it and
 * the create's own edits follow it by name). A verdict may also carry
 * questions: the run pauses, the human answers, and the same session takes
 * one more turn to the final verdict — questions never ride along with
 * actions, and there is at most one question round.
 *
 * A resource the controller refuses as binary (`yantao-kb/binary`, the NUL
 * marker of ADR-0028) is injected as an explicit placeholder: the model judges
 * relevance from the file name alone and is told so. Text resources are
 * clipped at the same 32k the agent-side `kb_read_resource` uses (ADR-0028) —
 * the defence is copied, not invented; roster entities are clipped tighter,
 * so a big library cannot blow the prompt.
 * @module @deepseek-ai/dsh-client-ui-yantao/refine
 */
import type { Context } from '@deepseek-ai/cordis'
import { sessionRemoteOf, kbRemoteOf, unwrapRemote } from './remote.ts'
import { jsonRound } from './turn-answer.ts'
import type { Proposal, ProposalAction, ProposalEntityType } from './proposal.ts'

/** The three gestures that drive the one pipeline. */
export type RefineMode = 'intake' | 'refine' | 'distill'

/** One section replacement the model proposes. */
export interface RefineEdit {
  /** The section heading without the `## ` prefix, e.g. `目标`. */
  readonly section: string
  /** The section's complete new body. */
  readonly after: string
  /** One line of why — the card row's explanation. */
  readonly why: string
}

/** One suggested `[[双链]]`: the other entity's name, and why. */
export interface RefineLink {
  /** The linked entity's name, exactly as the roster spelled it. */
  readonly to: string
  /** One line of why — the card row's explanation. */
  readonly why: string
}

/** One question the model wants answered before it can propose. */
export interface RefineQuestion {
  readonly question: string
  /** One line of why the answer matters. */
  readonly why: string
}

/** One already-existing entity the verdict proposes to touch. */
export interface RefineTargetVerdict {
  /** The entity's name, exactly as the roster spelled it; `''` binds to the gesture's own entity. */
  readonly entity: string
  readonly edits: readonly RefineEdit[]
  readonly links: readonly RefineLink[]
  /** One line to append to the entity's `## 流水` with the confirmed writes. */
  readonly log: string
}

/** One entity the verdict proposes to create (zero-hit: nothing in the roster fits). */
export interface RefineCreateVerdict {
  readonly entityType: ProposalEntityType
  readonly name: string
  /** Why a new entity — the create row's reason on the card. */
  readonly why: string
  readonly edits: readonly RefineEdit[]
  readonly links: readonly RefineLink[]
  readonly log: string
}

/** What the model answers: a relevance gate, a reason, the per-entity verdicts, and questions. */
export interface RefineVerdict {
  /**
   * Whether the resource belongs with the entity. The intake prompt gates on
   * this (irrelevant → no card, no trace); the refine and distill prompts pin
   * it true.
   */
  readonly relevant: boolean
  /** One line of why — the toast for an irrelevant resource, the card's context otherwise. */
  readonly reason: string
  readonly targets: readonly RefineTargetVerdict[]
  readonly creates: readonly RefineCreateVerdict[]
  /**
   * The model's questions, when it needs answers before proposing. A verdict
   * carrying questions proposes nothing else; the run continues once the
   * human answers, in the same session.
   */
  readonly questions: readonly RefineQuestion[]
}

/** The result of one refine run: the session it happened in, and what it proposed. */
export interface RefineRun {
  /** The session's id — kept for re-reading the judgement. */
  readonly sessionId: string
  /** The session's name, 「提炼 <对象名>」, echoed back for the window. */
  readonly title: string
  /** False only when an intake verdict judged the resource irrelevant. */
  readonly relevant: boolean
  /** The verdict's reason line. */
  readonly reason: string
  /** The proposal — absent when the resource was judged irrelevant (no card, no trace). */
  readonly proposal?: Proposal
  /**
   * The verdict's questions, when the model asked before proposing. The frame
   * shows them; the human's answers feed {@link continueWithAnswers}.
   */
  readonly questions?: readonly RefineQuestion[]
  /**
   * The run's second half: the human's answers go back into the same session,
   * one more turn lands the final verdict. At most one question round — a
   * second-round verdict's questions are dropped, not honoured (ADR-0030).
   */
  readonly continueWithAnswers?: (answers: readonly string[]) => Promise<RefineRun>
}

/** One resource file the intake and distill gestures name. */
export interface RefineResource {
  /** The resource's KB-relative path. */
  readonly path: string
  /** The resource's display name (its file name). */
  readonly name: string
}

/** The gesture one rail emits; the frame owns the run (ADR-0029 决定 2). */
export interface RefineGesture {
  /**
   * `intake` for a resource dropped on an entity row, `refine` for the row
   * menu's 提炼, `distill` for a resource's 提炼到实体 (ADR-0030).
   */
  readonly mode: RefineMode
  /** The gesture's own entity — intake and refine only. */
  readonly entityPath?: string
  readonly entityName?: string
  readonly entityType?: string
  /** The resource — intake (dropped) and distill (right-clicked). */
  readonly resource?: RefineResource
}

/** One roster entry the distill gesture hands over: who exists, and where. */
export interface RefineRosterEntry {
  readonly name: string
  readonly type: string
  readonly path: string
}

/** The frame's refine face: one run, with the sibling names for `[[双链]]` and the distill roster. */
export type RefineRunner = (
  args: RefineGesture & {
    readonly siblings?: readonly string[]
    readonly roster?: readonly RefineRosterEntry[]
  },
) => Promise<RefineRun>

/** The MIME type a dragged resource row carries its KB path under (ADR-0029 决定 2). */
export const RESOURCE_DRAG_TYPE = 'application/x-yantao-resource'

/** What a drop on an entity row carries: a library resource, or OS files. */
export type DropPayload =
  | { readonly kind: 'resource'; readonly path: string }
  | { readonly kind: 'files'; readonly files: readonly File[] }

/**
 * Read one drop event's payload: a library drag (a resource row's own drag
 * start) carries the resource's KB path under the workbench's MIME type; an
 * OS drag carries files. Anything else is nothing this pipeline accepts.
 * Read from the `dragover`'s `dataTransfer` this is always "files" (the
 * payload is protected until drop) — callers consult it on drop only.
 * @param dataTransfer - the drop event's data transfer.
 * @returns the payload, or null when the drop carries nothing for the pipeline.
 */
export function dropPayloadOf(
  dataTransfer: { getData(type: string): string; readonly files: ArrayLike<File> },
): DropPayload | null {
  const path = dataTransfer.getData(RESOURCE_DRAG_TYPE)
  if (path !== '') return { kind: 'resource', path }
  const files = Array.from(dataTransfer.files)
  return files.length > 0 ? { kind: 'files', files } : null
}

/** What one resource contributes to the prompt: its name and its (possibly placeholder) content. */
interface ResourceView {
  readonly name: string
  readonly content: string
}

/** How much of one text resource the prompt sees — the ADR-0028 line, copied. */
const RESOURCE_CLIP = 32 * 1024

/**
 * How much of one roster entity's content the distill prompt sees — tighter
 * than a resource's clip, because the roster arrives whole: a big library
 * must not blow the prompt.
 */
const ENTITY_CLIP = 8 * 1024

/**
 * The built-in body skeletons, mirrored from `packages/yantao/kb` — the
 * client cannot import that package (bundle purity, the same reason the todo
 * board parses nothing), and the four strings are the whole of it. Kept in
 * step with `builtinEntityBody` by the ADR-0029 tests.
 */
const BUILTIN_BODIES: Record<string, string> = {
  project: '## 目标\n\n\n## 下一步\n\n\n## 状态',
  area: '## 标准\n\n\n## 检视\n\n\n## 状态',
  person: '## 状态',
  meeting: '## 状态\n\n\n## 决议\n\n\n## 待办',
}

/** Where a user template for one entity type lives, KB-relative (ADR-0026 决定 1). */
function userTemplatePath(entityType: string): string {
  return `.dsh/yantao/templates/${entityType}.md`
}

/**
 * The entity type's body skeleton: the user's template when one exists (body
 * only — its own frontmatter is stripped, and a duplicated `## 流水` anchor
 * is the one pathology that falls back to the built-in), the built-in
 * skeleton otherwise. The same reading order entity creation uses
 * (ADR-0029 决定 2), minus the code path it cannot share (bundle purity).
 * @param read - one KB file's reader.
 * @param entityType - the entity kind, e.g. `project`.
 * @returns the template's body skeleton.
 */
export async function templateBodyOf(read: (path: string) => Promise<string>, entityType: string): Promise<string> {
  const fallback = BUILTIN_BODIES[entityType] ?? '## 状态'
  let text: string
  try {
    text = await read(userTemplatePath(entityType))
  } catch {
    return fallback
  }
  const normalized = text.replace(/\r\n/g, '\n')
  const stripped = /^---\n[\s\S]*?\n---\n?/.test(normalized)
    ? normalized.replace(/^---\n[\s\S]*?\n---\n?/, '')
    : normalized
  const body = stripped.trim()
  const logs = body.match(/^## 流水[ \t]*$/gm)
  if (logs !== null && logs.length > 1) return fallback
  return body === '' ? fallback : body
}

/** One string field of a parsed JSON row, or `''` when it is not a string. */
function field(row: unknown, key: string): string {
  if (typeof row !== 'object' || row === null) return ''
  const value = (row as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** The rows of one block, dropping anything that is not an object. */
function rows(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** The edits of one verdict block, dropping the ones that would wipe or dangle (宁可少，不可错). */
function editsOf(value: unknown): readonly RefineEdit[] {
  return rows(value).map((row): RefineEdit | undefined => {
    const section = field(row, 'section')
    const after = field(row, 'after')
    // An edit without a section or with an empty body would wipe or dangle —
    // dropped, not guessed (宁可少，不可错).
    if (section === '' || after === '') return undefined
    return { section, after, why: field(row, 'why') }
  }).filter((edit): edit is RefineEdit => edit !== undefined)
}

/** The links of one verdict block, dropping the ones with nowhere to point. */
function linksOf(value: unknown): readonly RefineLink[] {
  return rows(value).map((row): RefineLink | undefined => {
    const to = field(row, 'to')
    if (to === '') return undefined
    return { to, why: field(row, 'why') }
  }).filter((link): link is RefineLink => link !== undefined)
}

/** The entity types a create may name — the controller's own creatable set. */
const ENTITY_TYPES: readonly string[] = ['project', 'area', 'person', 'meeting']

/**
 * Read the model's answer: a fenced JSON object, or bare JSON — the outermost
 * braces win, as the mail parser learned. Anything unreadable is an error the
 * caller shows; a silent empty verdict would look like "nothing to do".
 * @param text - the assistant message's text.
 * @returns the verdict.
 */
export function parseRefineVerdict(text: string): RefineVerdict {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const source = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('模型没有返回可解析的 JSON，请到该会话里查看它的原话。')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('模型没有返回可解析的 JSON，请到该会话里查看它的原话。')
  }
  const value = parsed as Record<string, unknown>
  const targets = rows(value.targets).map((row): RefineTargetVerdict | undefined => {
    if (typeof row !== 'object' || row === null) return undefined
    const record = row as Record<string, unknown>
    const edits = editsOf(record.edits)
    const links = linksOf(record.links)
    const log = field(record, 'log')
    // A target with nothing to do is noise, not a row.
    if (edits.length === 0 && links.length === 0 && log === '') return undefined
    return { entity: field(record, 'entity'), edits, links, log }
  }).filter((target): target is RefineTargetVerdict => target !== undefined)
  // A model that answered the old single-entity shape (top-level edits/log)
  // still lands: its edits bind to the gesture's own entity.
  if (targets.length === 0) {
    const edits = editsOf(value.edits)
    const log = field(value, 'log')
    if (edits.length > 0 || log !== '') targets.push({ entity: '', edits, links: [], log })
  }
  const creates = rows(value.creates).map((row): RefineCreateVerdict | undefined => {
    if (typeof row !== 'object' || row === null) return undefined
    const record = row as Record<string, unknown>
    const entityType = field(record, 'entityType')
    const name = field(record, 'name')
    if (!ENTITY_TYPES.includes(entityType) || name === '') return undefined
    return {
      entityType: entityType as ProposalEntityType,
      name,
      why: field(record, 'why'),
      edits: editsOf(record.edits),
      links: linksOf(record.links),
      log: field(record, 'log'),
    }
  }).filter((create): create is RefineCreateVerdict => create !== undefined)
  const questions = rows(value.questions).map((row): RefineQuestion | undefined => {
    const question = field(row, 'question')
    if (question === '') return undefined
    return { question, why: field(row, 'why') }
  }).filter((question): question is RefineQuestion => question !== undefined)
  return {
    relevant: value.relevant === true,
    reason: field(value, 'reason'),
    targets,
    creates,
    questions,
  }
}

/** The re-ask when the first answer is not readable JSON: JSON alone, nothing else. */
const REASK = '你上一条回答无法解析为 JSON。请只输出一个 JSON 对象（含 relevant/reason/targets/creates/questions 字段），不要输出任何其它文字。'

/**
 * The refine prompt: the gesture's object in full — an entity, or a resource
 * against the whole roster — and the exact JSON shape to answer with. Domain
 * data throughout — section names and rules are the KB's own language.
 * @param args - the mode; the entity (intake/refine); the resource
 *   (intake/distill); the type's template (intake/refine); the sibling names
 *   (intake/refine); the roster with contents (distill).
 * @returns the prompt text.
 */
export function refinePrompt(args: {
  readonly mode: RefineMode
  readonly entityName?: string
  readonly entityType?: string
  readonly entityContent?: string
  readonly template?: string
  readonly resource?: ResourceView
  readonly siblings?: readonly string[]
  readonly roster?: readonly { readonly name: string; readonly type: string; readonly content: string }[]
}): string {
  const intake = args.mode === 'intake'
  const distill = args.mode === 'distill'
  const opening = intake
    ? '你是个人知识库的整理助手。下面是一个实体笔记和一份资源文件。请判断这份资源与这个实体是否相关：相关则提议对实体笔记的具体修改；无关则如实判不相关。'
    : args.mode === 'refine'
      ? '你是个人知识库的整理助手。下面是一个实体笔记和它这一类型的正文模板。请对照模板检查区段结构，按你的理解追加新发现，并建议与其它实体的双链。'
      : '你是个人知识库的整理助手。下面是一份资源文件和知识库里的实体清单（每个实体带当前内容）。请找出与这份资源相关的实体，为每个相关实体提议具体修改；如果资源值得留存但没有任何现有实体适合承接，提议新建实体；如果有会影响整理方式的关键疑问，先向用户提问。'
  const siblings = args.siblings === undefined || args.siblings.length === 0
    ? '（无）'
    : args.siblings.join('、')
  const blocks = [
    opening,
    '',
    ...(distill ? [] : [`知识库里已有的其它实体（建议双链时从中选）：${siblings}`, '']),
    ...(!distill && args.entityName !== undefined
      ? [`【实体：${args.entityName}（${args.entityType}）】`, (args.entityContent ?? '').trim(), '']
      : []),
    ...(args.resource !== undefined
      ? [`【资源：${args.resource.name}】`, args.resource.content.trim(), '']
      : []),
    ...(!distill && args.template !== undefined
      ? [`【${args.entityType} 类型的正文模板】`, args.template.trim(), '']
      : []),
    ...(distill
      ? (args.roster ?? []).flatMap(view => [`【实体：${view.name}（${view.type}）】`, view.content.trim(), ''])
      : []),
    '请只输出一个 JSON 对象，不要输出任何其它文字：',
    '',
    '```json',
    '{',
    '  "relevant": true,',
    `  "reason": "${intake ? '一句话：为什么相关（或为什么无关）' : '一句话：这次提炼做了什么'}",`,
    '  "targets": [{ "entity": "已有实体名", "edits": [{ "section": "目标", "after": "该小节替换后的完整正文", "why": "为什么这样改" }], "links": [{ "to": "另一实体名", "why": "为什么关联" }], "log": "追加到该实体流水的一句话" }],',
    '  "creates": [{ "entityType": "project", "name": "新实体名", "why": "为什么要新建", "edits": [], "links": [], "log": "" }],',
    '  "questions": [{ "question": "想问用户的问题", "why": "为什么需要问" }]',
    '}',
    '```',
    '',
    '规则：',
    ...(intake
      ? ['- 资源与实体是否相关，拿不准就判不相关（relevant 为 false），此时 targets、creates 都是空数组、log 是空字符串。']
      : ['- relevant 恒为 true：提炼不判相关性。']),
    ...(distill
      ? ['- 每个相关实体各给一个 targets 条目，entity 写清单里的名字原文；与资源无关的实体不要出现在 targets 里。']
      : ['- targets 至多一条，entity 就是上面给出的那个实体（也可以留空字符串）。']),
    '- entity 必须用清单里的名字原文；名单里没有的实体不要猜，宁可漏掉。',
    '- section 写小节标题（不带 ## ）。可以用实体已有小节，也可以用模板里的小节——实体缺这个区段时，确认后会新建。',
    '- 洞见的落点：影响目标的进 `目标`，可执行的进 `下一步`，事实性的进 `状态`；area 用 `标准`/`检视`。不要发明模板之外的新小节。',
    '- 不要把 `流水` 写进 edits（它只增不改）；要记录的动态写进 log。',
    '- 不要碰 frontmatter（文件开头的 --- 块）。',
    '- after 是该小节替换后的完整正文：既有内容要保留的原样带上，新增的接在后面；与其它实体的关联直接写成 [[实体名]]。',
    '- links 的 to 也必须是已有实体名，或 creates 里的新实体名。',
    '- 只有确实没有合适实体承接时才用 creates；entityType 只能是 project/area/person/meeting 之一。新建实体不必写出完整模板，edits 里只写你要填的区段（常用小节：project 目标/下一步/状态；area 标准/检视/状态；person 状态；meeting 状态/决议/待办）。',
    '- 有会影响整理方式的关键疑问才提问，最多三个；需要提问时 targets 和 creates 都留空数组，等用户回答后再给最终结论。没有疑问 questions 就是空数组。',
    '- log 是一句话，人确认后会随改动一起追加到该实体的流水。',
  ]
  return blocks.join('\n')
}

/**
 * The second round's prompt: the questions and the human's answers, and the
 * demand for the final verdict — same shape, no more questions.
 * @param questions - what the model asked.
 * @param answers - what the human answered, aligned by index.
 * @returns the prompt text.
 */
export function answersPrompt(questions: readonly RefineQuestion[], answers: readonly string[]): string {
  const lines = [
    '用户已回答你先前提出的问题。请基于这些回答给出最终的 JSON 结论（字段格式与之前相同），不要再提问：',
    '',
  ]
  questions.forEach((question, index) => {
    lines.push(`问题：${question.question}`)
    lines.push(`回答：${answers[index] ?? ''}`)
    lines.push('')
  })
  return lines.join('\n')
}

/**
 * One section's current body, as the proposal's `before` preview carries it:
 * from after the heading to the next heading of the same or higher level,
 * trimmed. A section the file does not carry previews as empty — the applier
 * will create it.
 * @param content - the entity file's content.
 * @param heading - the full heading, e.g. `## 目标`.
 * @returns the section's current body.
 */
function sectionBody(content: string, heading: string): string {
  const lines = content.replace(/\s*$/, '').split('\n')
  const start = lines.findIndex(line => line.trim() === heading)
  if (start === -1) return ''
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2} /.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

/** One entity as the proposal builder sees it: its name, path, and the content the model saw. */
export interface RefineEntityView {
  readonly name: string
  readonly path: string
  readonly content: string
}

/** The entities a verdict resolves its targets against: the gesture's own entity, plus the roster. */
export interface RefineViews {
  /** The gesture's own entity (intake/refine) — binds an unnamed target. */
  readonly primary?: RefineEntityView
  /** Every roster entity (distill) — where the names resolve. */
  readonly roster?: readonly RefineEntityView[]
}

/**
 * Resolve one target's name to its view. A roster name wins; an empty name —
 * the legacy single-entity shape — and the primary's own name both bind to
 * the gesture's own entity. Anything else resolves to nothing: the model was
 * given the exact names, and guessing a filename is worse than missing a row.
 */
function resolveTarget(entity: string, views: RefineViews): RefineEntityView | undefined {
  const named = (views.roster ?? []).find(view => view.name === entity)
  if (named !== undefined) return named
  if (views.primary !== undefined && (entity === '' || views.primary.name === entity)) return views.primary
  return undefined
}

/**
 * Turn a verdict into a proposal (ADR-0029 决定 3, ADR-0030): the creates run
 * first — the applier resolves each new entity's path as it runs, so the
 * create's own edits, links, and log follow it by name (`afterCreate`) — then
 * every target's edits become `edit-section` actions carrying the section's
 * current body as `before`, its links become `create-link` rows, and its log
 * line becomes the fixed `append-log` row — ticked or not with everything
 * else, never written on its own authority. A target the roster cannot
 * resolve is dropped, not guessed.
 * @param verdict - what the model proposed.
 * @param views - the entities the names resolve against.
 * @param title - the card's heading; the session's name.
 * @returns the proposal.
 */
export function verdictToProposal(verdict: RefineVerdict, views: RefineViews, title: string): Proposal {
  const actions: ProposalAction[] = []
  for (const create of verdict.creates) {
    actions.push({
      kind: 'create-entity',
      entityType: create.entityType,
      name: create.name,
      reason: create.why !== '' ? create.why : '知识库里没有合适的实体',
    })
    for (const edit of create.edits) {
      actions.push({
        kind: 'edit-section',
        path: '',
        afterCreate: create.name,
        section: edit.section,
        before: '',
        after: edit.after,
        why: edit.why,
      })
    }
    for (const link of create.links) {
      actions.push({
        kind: 'create-link',
        entityPath: '',
        entityName: create.name,
        afterCreate: create.name,
        link: `[[${link.to}]]`,
        reason: link.why,
      })
    }
    actions.push({
      kind: 'append-log',
      entityPath: '',
      entityName: create.name,
      afterCreate: create.name,
      text: create.log !== '' ? create.log : `提炼「${create.name}」`,
      reason: '提炼记录',
    })
  }
  for (const target of verdict.targets) {
    const view = resolveTarget(target.entity, views)
    if (view === undefined) continue
    for (const edit of target.edits) {
      actions.push({
        kind: 'edit-section',
        path: view.path,
        section: edit.section,
        before: sectionBody(view.content, `## ${edit.section}`),
        after: edit.after,
        why: edit.why,
      })
    }
    for (const link of target.links) {
      actions.push({
        kind: 'create-link',
        entityPath: view.path,
        entityName: view.name,
        link: `[[${link.to}]]`,
        reason: link.why,
      })
    }
    actions.push({
      kind: 'append-log',
      entityPath: view.path,
      entityName: view.name,
      text: target.log !== '' ? target.log : `提炼「${view.name}」`,
      reason: '提炼记录',
    })
  }
  return { title, actions }
}

/**
 * One file as the prompt sees it: text content clipped at `clip`, or an
 * explicit placeholder when the controller refuses the file as binary — the
 * model is told the content is unreadable so it judges by name alone,
 * honestly.
 */
async function contentViewOf(
  read: (path: string) => Promise<string>,
  path: string,
  name: string,
  clip: number,
): Promise<string> {
  let text: string
  try {
    text = await read(path)
  } catch (error) {
    if ((error as { code?: string }).code === 'yantao-kb/binary') {
      return `（二进制文件，内容不可读。请只凭文件名「${name}」与路径判断。）`
    }
    throw error
  }
  return text.length > clip ? `${text.slice(0, clip)}\n（内容过长，已截断）` : text
}

/**
 * Run one refine analysis: read the object up front — an entity, or the whole
 * roster for distill — then create a session, name it 「提炼 <对象名>」, and
 * take one waited-out turn. An intake verdict of `relevant: false` ends the
 * run with no proposal — the caller toasts the reason; a verdict with
 * questions pauses the run for the human's answers, continuing in the same
 * session. Nothing here writes to the KB.
 * @param options - the context, the mode, the entity (intake/refine), the
 *   resource (intake/distill), the sibling entity names for `[[双链]]`
 *   suggestions, the distill roster, and the signal.
 * @returns the session and the verdict.
 */
export async function runRefine(options: {
  readonly ctx: Context
  readonly mode: RefineMode
  readonly entityPath?: string
  readonly entityName?: string
  readonly entityType?: string
  readonly resource?: RefineResource
  readonly siblings?: readonly string[]
  readonly roster?: readonly RefineRosterEntry[]
  readonly cwd?: string
  readonly signal?: AbortSignal
}): Promise<RefineRun> {
  const { ctx, mode, cwd, signal } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw new Error('没有挂载 yantaoKb Remote 命名空间')
  // unwrapRemote rethrows the RemoteError itself, so its `code` (the binary
  // marker the content view matches on) survives the read.
  const read = async (path: string): Promise<string> => unwrapRemote(await kb.read(path)).content

  let primary: RefineEntityView | undefined
  let template = ''
  if (mode === 'intake' || mode === 'refine') {
    const entityPath = options.entityPath
    const entityName = options.entityName
    if (entityPath === undefined || entityName === undefined) throw new Error('该手势缺少实体信息')
    template = await templateBodyOf(read, options.entityType ?? '')
    primary = { name: entityName, path: entityPath, content: await read(entityPath) }
  }
  let resource: ResourceView | undefined
  if (options.resource !== undefined) {
    resource = {
      name: options.resource.name,
      content: await contentViewOf(read, options.resource.path, options.resource.name, RESOURCE_CLIP),
    }
  }
  const roster: RefineEntityView[] = []
  if (mode === 'distill') {
    for (const entry of options.roster ?? []) {
      roster.push({
        name: entry.name,
        path: entry.path,
        content: await contentViewOf(read, entry.path, entry.name, ENTITY_CLIP),
      })
    }
  }

  const created = await session.create(cwd === undefined ? {} : { cwd })
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId
  // Domain data, not UI copy: the session's name lives in the KB's own
  // language, so it stays Chinese regardless of the workbench locale.
  const sessionName = mode === 'distill'
    ? `提炼 ${options.resource?.name ?? '资源'}`
    : `提炼 ${options.entityName ?? ''}`
  const named = await session.rename({ sessionId, title: sessionName })
  if (!named.ok) throw named.error

  const verdict = await jsonRound({
    session,
    sessionId,
    prompt: refinePrompt({
      mode,
      ...primary !== undefined ? { entityName: primary.name, entityType: options.entityType, entityContent: primary.content } : {},
      ...template !== '' ? { template } : {},
      ...resource !== undefined ? { resource } : {},
      ...options.siblings !== undefined ? { siblings: options.siblings } : {},
      ...mode === 'distill' ? { roster: roster.map(view => ({
        name: view.name,
        type: (options.roster ?? []).find(entry => entry.name === view.name)?.type ?? '',
        content: view.content,
      })) } : {},
    }),
    reask: REASK,
    parse: parseRefineVerdict,
    ...signal !== undefined ? { signal } : {},
  })

  const views: RefineViews = {
    ...primary !== undefined ? { primary } : {},
    ...mode === 'distill' ? { roster } : {},
  }
  const finish = (final: RefineVerdict): RefineRun => {
    const relevant = mode === 'intake' ? final.relevant : true
    const noProposal = mode === 'intake' && !final.relevant
    return {
      sessionId,
      title: sessionName,
      relevant,
      reason: final.reason,
      ...(!noProposal ? { proposal: verdictToProposal(final, views, sessionName) } : {}),
    }
  }

  // Questions take precedence: nothing is proposed until the human answers,
  // and the answers continue the same session. The second round's own
  // questions are dropped — at most one question round (ADR-0030).
  if (verdict.questions.length > 0) {
    const asked = verdict.questions
    return {
      sessionId,
      title: sessionName,
      relevant: mode === 'intake' ? verdict.relevant : true,
      reason: verdict.reason,
      questions: asked,
      continueWithAnswers: async (answers: readonly string[]): Promise<RefineRun> => {
        const second = await jsonRound({
          session,
          sessionId,
          prompt: answersPrompt(asked, answers),
          reask: REASK,
          parse: parseRefineVerdict,
          ...signal !== undefined ? { signal } : {},
        })
        return finish({ ...second, questions: [] })
      },
    }
  }
  return finish(verdict)
}
