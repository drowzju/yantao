/**
 * The refine loop (ADR-0029): one real dsh session reads an entity — and, for
 * the intake gesture, one resource — and answers a JSON verdict the human then
 * confirms on the proposal card.
 *
 * Two gestures, one pipeline: dragging a resource onto an entity row (归入)
 * and an entity row's right-click 「提炼」 both land here. The session is
 * created, named (「提炼 <实体名>」) and driven from the browser through the
 * session Remote, exactly the mail analysis's path (ADR-0019) — no pre-step,
 * no capability declaration, no new RPC; the agent cannot start one itself.
 * The session is kept so the judgement can be re-read; nothing here writes to
 * the KB. The verdict becomes a Proposal whose `edit-section` rows carry the
 * section's current body as `before` — the applier re-reads and re-locates at
 * apply time (ADR-0029 决定 4), so `before` is a preview aid, not a snapshot
 * contract.
 *
 * A resource the controller refuses as binary (`yantao-kb/binary`, the NUL
 * marker of ADR-0028) is injected as an explicit placeholder: the model judges
 * relevance from the file name alone and is told so. Text resources are
 * clipped at the same 32k the agent-side `kb_read_resource` uses (ADR-0028) —
 * the defence is copied, not invented.
 * @module @deepseek-ai/dsh-client-ui-yantao/refine
 */
import type { Context } from '@deepseek-ai/cordis'
import { sessionRemoteOf, kbRemoteOf, unwrapRemote } from './remote.ts'
import { jsonRound } from './turn-answer.ts'
import type { Proposal, ProposalAction } from './proposal.ts'

/** The two gestures that drive the one pipeline. */
export type RefineMode = 'intake' | 'refine'

/** One section replacement the model proposes. */
export interface RefineEdit {
  /** The section heading without the `## ` prefix, e.g. `目标`. */
  readonly section: string
  /** The section's complete new body. */
  readonly after: string
  /** One line of why — the card row's explanation. */
  readonly why: string
}

/** What the model answers: a relevance gate, a reason, the edits, one log line. */
export interface RefineVerdict {
  /**
   * Whether the resource belongs with the entity. The intake prompt gates on
   * this (irrelevant → no card, no trace); the refine prompt pins it true.
   */
  readonly relevant: boolean
  /** One line of why — the toast for an irrelevant resource, the card's context otherwise. */
  readonly reason: string
  readonly edits: readonly RefineEdit[]
  /** One line to append to the entity's `## 流水` with the confirmed writes. */
  readonly log: string
}

/** The result of one refine run: the session it happened in, and what it proposed. */
export interface RefineRun {
  /** The session's id — kept for re-reading the judgement. */
  readonly sessionId: string
  /** The session's name, 「提炼 <实体名>」, echoed back for the window. */
  readonly title: string
  /** False only when an intake verdict judged the resource irrelevant. */
  readonly relevant: boolean
  /** The verdict's reason line. */
  readonly reason: string
  /** The proposal — absent when the resource was judged irrelevant (no card, no trace). */
  readonly proposal?: Proposal
}

/** One resource file the intake gesture names. */
export interface RefineResource {
  /** The resource's KB-relative path. */
  readonly path: string
  /** The resource's display name (its file name). */
  readonly name: string
}

/** What one resource contributes to the prompt: its name and its (possibly placeholder) content. */
interface ResourceView {
  readonly name: string
  readonly content: string
}

/** How much of one text resource the prompt sees — the ADR-0028 line, copied. */
const RESOURCE_CLIP = 32 * 1024

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
  meeting: '## 状态',
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
  const edits = rows(value.edits).map((row): RefineEdit | undefined => {
    const section = field(row, 'section')
    const after = field(row, 'after')
    // An edit without a section or with an empty body would wipe or dangle —
    // dropped, not guessed (宁可少，不可错).
    if (section === '' || after === '') return undefined
    return { section, after, why: field(row, 'why') }
  }).filter((edit): edit is RefineEdit => edit !== undefined)
  return {
    relevant: value.relevant === true,
    reason: field(value, 'reason'),
    edits,
    log: field(value, 'log'),
  }
}

/** The re-ask when the first answer is not readable JSON: JSON alone, nothing else. */
const REASK = '你上一条回答无法解析为 JSON。请只输出一个 JSON 对象（含 relevant/reason/edits/log 字段），不要输出任何其它文字。'

/**
 * The refine prompt: the entity in full, the type's template, the resource
 * when intaking, and the exact JSON shape to answer with. Domain data
 * throughout — section names and rules are the KB's own language.
 * @param args - the mode, the entity, its content, the template, and the
 *   resource view (intake only).
 * @returns the prompt text.
 */
export function refinePrompt(args: {
  readonly mode: RefineMode
  readonly entityName: string
  readonly entityType: string
  readonly entityContent: string
  readonly template: string
  readonly resource?: ResourceView
  readonly siblings?: readonly string[]
}): string {
  const intake = args.mode === 'intake'
  const siblings = args.siblings === undefined || args.siblings.length === 0
    ? '（无）'
    : args.siblings.join('、')
  const opening = intake
    ? '你是个人知识库的整理助手。下面是一个实体笔记和一份资源文件。请判断这份资源与这个实体是否相关：相关则提议对实体笔记的具体修改；无关则如实判不相关。'
    : '你是个人知识库的整理助手。下面是一个实体笔记和它这一类型的正文模板。请对照模板检查区段结构，按你的理解追加新发现，并建议与其它实体的双链。'
  const blocks = [
    opening,
    '',
    `知识库里已有的其它实体（建议双链时从中选）：${siblings}`,
    '',
    `【实体：${args.entityName}（${args.entityType}）】`,
    args.entityContent.trim(),
    '',
    ...(intake && args.resource !== undefined
      ? [`【资源：${args.resource.name}】`, args.resource.content.trim(), '']
      : []),
    `【${args.entityType} 类型的正文模板】`,
    args.template.trim(),
    '',
    '请只输出一个 JSON 对象，不要输出任何其它文字：',
    '',
    '```json',
    '{',
    '  "relevant": true,',
    `  "reason": "${intake ? '一句话：为什么相关（或为什么无关）' : '一句话：这次提炼做了什么'}",`,
    '  "edits": [{ "section": "目标", "after": "该小节替换后的完整正文", "why": "为什么这样改" }],',
    '  "log": "追加到流水的一句话动态"',
    '}',
    '```',
    '',
    '规则：',
    ...(intake
      ? ['- 资源与实体是否相关，拿不准就判不相关（relevant 为 false），此时 edits 是空数组、log 是空字符串。']
      : ['- relevant 恒为 true：提炼不判相关性。']),
    '- section 写小节标题（不带 ## ）。可以用实体已有小节，也可以用模板里的小节——实体缺这个区段时，确认后会新建。',
    '- 洞见的落点：影响目标的进 `目标`，可执行的进 `下一步`，事实性的进 `状态`；area 用 `标准`/`检视`。不要发明模板之外的新小节。',
    '- 不要把 `流水` 写进 edits（它只增不改）；要记录的动态写进 log。',
    '- 不要碰 frontmatter（文件开头的 --- 块）。',
    '- after 是该小节替换后的完整正文：既有内容要保留的原样带上，新增的接在后面；与其它实体的关联直接写成 [[实体名]]。',
    '- log 是一句话，人确认后会随改动一起追加到流水。',
  ]
  return blocks.join('\n')
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

/**
 * Turn a verdict into a proposal (ADR-0029 决定 3): every edit becomes an
 * `edit-section` action carrying the section's current body as `before`, and
 * the run's log line becomes the fixed `append-log` row — ticked or not with
 * everything else, never written on its own authority.
 * @param verdict - what the model proposed.
 * @param entity - the target entity's path and name.
 * @param entityContent - the entity file's content as the model saw it (the `before` source).
 * @param title - the card's heading; the session's name.
 * @returns the proposal.
 */
export function verdictToProposal(
  verdict: RefineVerdict,
  entity: { readonly path: string; readonly name: string },
  entityContent: string,
  title: string,
): Proposal {
  const actions: ProposalAction[] = verdict.edits.map(edit => ({
    kind: 'edit-section',
    path: entity.path,
    section: edit.section,
    before: sectionBody(entityContent, `## ${edit.section}`),
    after: edit.after,
    why: edit.why,
  }))
  actions.push({
    kind: 'append-log',
    entityPath: entity.path,
    entityName: entity.name,
    text: verdict.log !== '' ? verdict.log : `提炼「${entity.name}」`,
    reason: '提炼记录',
  })
  return { title, actions }
}

/**
 * Run one refine analysis: read the entity (and resource) up front, then
 * create a session, name it 「提炼 <实体名>」, and take one waited-out turn.
 * An intake verdict of `relevant: false` ends the run with no proposal — the
 * caller toasts the reason; nothing is written, nothing is left on a card.
 * @param options - the context, the mode, the entity, the resource (intake
 *   only), the sibling entity names for `[[双链]]` suggestions, and the signal.
 * @returns the session and the verdict.
 */
export async function runRefine(options: {
  readonly ctx: Context
  readonly mode: RefineMode
  readonly entityPath: string
  readonly entityName: string
  readonly entityType: string
  readonly resource?: RefineResource
  readonly siblings?: readonly string[]
  readonly cwd?: string
  readonly signal?: AbortSignal
}): Promise<RefineRun> {
  const { ctx, mode, entityPath, entityName, entityType, cwd, signal } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw new Error('没有挂载 yantaoKb Remote 命名空间')
  // unwrapRemote rethrows the RemoteError itself, so its `code` (the binary
  // marker the resource view matches on) survives the read.
  const read = async (path: string): Promise<string> => unwrapRemote(await kb.read(path)).content

  const entityContent = await read(entityPath)
  const template = await templateBodyOf(read, entityType)
  let resource: ResourceView | undefined
  if (mode === 'intake' && options.resource !== undefined) {
    resource = {
      name: options.resource.name,
      content: await resourceViewOf(read, options.resource),
    }
  }

  const created = await session.create(cwd === undefined ? {} : { cwd })
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId
  // Domain data, not UI copy: the session's name lives in the KB's own
  // language, so it stays Chinese regardless of the workbench locale.
  const sessionName = `提炼 ${entityName}`
  const named = await session.rename({ sessionId, title: sessionName })
  if (!named.ok) throw named.error

  const verdict = await jsonRound({
    session,
    sessionId,
    prompt: refinePrompt({
      mode,
      entityName,
      entityType,
      entityContent,
      template,
      ...resource !== undefined ? { resource } : {},
      ...options.siblings !== undefined ? { siblings: options.siblings } : {},
    }),
    reask: REASK,
    parse: parseRefineVerdict,
    ...signal !== undefined ? { signal } : {},
  })

  if (mode === 'intake' && !verdict.relevant) {
    return { sessionId, title: sessionName, relevant: false, reason: verdict.reason }
  }
  return {
    sessionId,
    title: sessionName,
    relevant: true,
    reason: verdict.reason,
    proposal: verdictToProposal(verdict, { path: entityPath, name: entityName }, entityContent, sessionName),
  }
}

/**
 * One resource as the prompt sees it: text content clipped at the ADR-0028
 * line, or an explicit placeholder when the controller refuses the file as
 * binary — the model is told the content is unreadable so it judges by name
 * alone, honestly.
 * @param read - one KB file's reader.
 * @param resource - the resource's path and name.
 * @returns the content block, clipped or placeholder.
 */
async function resourceViewOf(read: (path: string) => Promise<string>, resource: RefineResource): Promise<string> {
  let text: string
  try {
    text = await read(resource.path)
  } catch (error) {
    if ((error as { code?: string }).code === 'yantao-kb/binary') {
      return '（二进制文件，内容不可读。请只凭文件名与路径判断相关性。）'
    }
    throw error
  }
  return text.length > RESOURCE_CLIP
    ? `${text.slice(0, RESOURCE_CLIP)}\n（内容过长，已截断）`
    : text
}
