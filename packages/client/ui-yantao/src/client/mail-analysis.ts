/**
 * The mail analysis (ADR-0019): one real dsh session reads a batch of mails
 * in small chunks and answers a JSON verdict per chunk, which the human then
 * confirms block by block.
 *
 * The session is created, named and driven from the browser through the
 * session Remote — the first time the workbench asks the agent to work without
 * a human typing. It is kept (and named 「邮件分析 YYYY-MM-DD」) precisely so a
 * judgement can be re-read later, which is the point: these are decisions
 * about what enters a knowledge base that outlives the mail. It reports the
 * stage it has reached *and*, once a chunk has been judged, each mail's
 * classification — because the only thing worse than a slow judgement is a
 * silent one.
 *
 * Nothing here writes to the KB. The analysis only proposes; {@link MailPanel}
 * is what applies, and only after the human has ticked the rows.
 * @module @deepseek-ai/dsh-client-ui-yantao/mail-analysis
 */
import type { Context } from '@deepseek-ai/cordis'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { sessionRemoteOf, type SessionRemote } from './remote.ts'
import { jsonRound } from './turn-answer.ts'

/** How many mails one analysis turn sees; the batch is walked in these chunks. */
const CHUNK_SIZE = 10

/** A person the analysis proposes adding to `entities/people/`. */
export interface MailPerson {
  /** The person's display name; becomes the entity file's name. */
  readonly name: string
  /** The relation the model infers — shown so the human can judge it. */
  readonly relation: string
  /** Why the model thinks this person is worth remembering. */
  readonly reason: string
  /** The sender's address, carried into the entity's frontmatter `email:` field. */
  readonly email?: string
}

/** A todo the analysis proposes writing into `entities/todos.md`. */
export interface MailTodo {
  /** One line of work. */
  readonly title: string
  /** Deadline, `YYYY-MM-DD`, when the mail names one. */
  readonly due?: string
  /** Optional markdown body. */
  readonly body: string
}

/** One existing project the mails touched, with the note to append to its 流水. */
export interface MailProjectNote {
  /** An existing project's name; the panel resolves it to a file. */
  readonly name: string
  /** One line about what the mail means for that project. */
  readonly note: string
}

/** A mail worth keeping as a resource. */
export interface MailResource {
  /** The resource's title; becomes `resources/<name>.md`. */
  readonly name: string
  /** A two-or-three-sentence summary. */
  readonly summary: string
  /** The mail it came from, as the 1-based number the prompt gave it. */
  readonly mail?: number
}

/** How important one mail is, as the analysis classifies it. */
export type MailImportance = 'focus' | 'digest' | 'normal'

/** One mail's classification: the per-mail progress line the panel lights up. */
export interface MailVerdict {
  /** The mail's 1-based number within the whole batch, as the prompt numbered it. */
  readonly mail: number
  /** `focus` = 重点提醒, `digest` = 汇总类（邮催、通知）, `normal` = 其余. */
  readonly importance: MailImportance
  /** One line of why — for a focus mail, why it deserves attention. */
  readonly why: string
}

/** Everything one analysis proposes; every block is confirmed separately. */
export interface MailAnalysis {
  readonly verdicts: readonly MailVerdict[]
  readonly people: readonly MailPerson[]
  readonly todos: readonly MailTodo[]
  readonly projects: readonly MailProjectNote[]
  readonly resources: readonly MailResource[]
}

/** Where one analysis run has got to — the panel turns it into a line of prose. */
export type AnalysisStage = 'session' | 'prompt' | 'answer'

/** One progress report: the stage, and — once chunks are landing — how far. */
export interface AnalysisProgress {
  readonly stage: AnalysisStage
  /** How many mails have been judged so far. */
  readonly done?: number
  /** How many mails the whole run will judge. */
  readonly total?: number
  /** The verdicts accumulated so far, for the panel's per-mail badges. */
  readonly verdicts?: readonly MailVerdict[]
}

/** One person the KB already holds, offered to the model for matching. */
export interface KnownPerson {
  /** The entity's display name. */
  readonly name: string
  /** The person's relation to the KB's owner, when declared — `superior` is 上级. */
  readonly relation?: string
  /** The person's e-mail address, when known — the strongest sender match. */
  readonly email?: string
}

/**
 * Run one analysis over a batch — the panel's seam to the session Remote, so
 * a test can hand back a verdict without a session ever existing.
 * @param onProgress - called as the run moves between its stages and chunks.
 */
export type MailAnalyser = (
  mails: readonly KbMailMessage[],
  known: KnownEntities,
  onProgress?: (progress: AnalysisProgress) => void,
) => Promise<AnalysisRun>

/** What the KB already holds, so the model matches against it instead of inventing. */
export interface KnownEntities {
  /** Existing project (and area) names. */
  readonly projects: readonly string[]
  /** Existing people, with their relations and addresses when known. */
  readonly people: readonly KnownPerson[]
}

/** An empty verdict: what a parse returns when the model found nothing. */
const EMPTY: MailAnalysis = { verdicts: [], people: [], todos: [], projects: [], resources: [] }

/** Today as a YYYY-MM-DD stamp, in the human's own timezone. */
function stamp(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const date = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

/** What one mail's `toMe` says — prompt text for the model, not UI copy. */
const TO_ME_PROMPT: Record<NonNullable<KbMailMessage['toMe']> | 'unknown', string> = {
  to: '主送我',
  cc: '抄送我',
  none: '非直接寄给我',
  unknown: '收件关系未知',
}

/**
 * One mail as the model sees it: time, sender, whether it was addressed
 * directly to the owner, subject, body — and nothing else. No recipient
 * lists: they are the largest block of PII in the message (ADR-0019); the
 * owner's own position in them is the one fact that judges importance.
 * @param mail - the mail to render.
 * @param index - its 1-based number within the whole batch, so the model can cite it.
 * @returns the rendered block.
 */
function renderMail(mail: KbMailMessage, index: number): string {
  const lines = [
    `[${index}] ${mail.receivedAt} ${mail.senderName} <${mail.senderAddress}>`,
    `寄给我：${TO_ME_PROMPT[mail.toMe ?? 'unknown']}`,
    `主题：${mail.subject || '（无主题）'}`,
    `正文：${mail.body}${mail.truncated ? '（已截断）' : ''}`,
  ]
  return lines.join('\n')
}

/** One known person as the prompt lists them: name, relation, address. */
function renderPerson(person: KnownPerson): string {
  const extras = [
    person.relation !== undefined && person.relation !== '' ? person.relation : '',
    person.email !== undefined && person.email !== '' ? `<${person.email}>` : '',
  ].filter(entry => entry !== '')
  return extras.length === 0 ? person.name : `${person.name}（${extras.join('，')}）`
}

/**
 * The analysis prompt: the mails of one chunk, what the KB already holds, and
 * the exact JSON shape to answer with.
 * @param mails - the chunk to analyse.
 * @param known - existing projects, and people with their relations.
 * @param offset - how many mails precede this chunk, so numbers stay global.
 * @returns the prompt text.
 */
export function mailPrompt(mails: readonly KbMailMessage[], known: KnownEntities, offset = 0): string {
  const list = (values: readonly string[]): string => values.length === 0 ? '（无）' : values.join('、')
  return [
    `你是个人知识库的整理助手。下面是 ${mails.length} 封新邮件（编号 ${offset + 1} 到 ${offset + mails.length}；收件时间、发件人、是否主送、主题、正文；正文已截断到 12000 字）。`,
    '',
    `知识库里已有的项目/领域：${list(known.projects)}`,
    `知识库里已有的人物（名字（关系）（<邮箱>））：${known.people.map(renderPerson).join('、') || '（无）'}`,
    '',
    '请对每封邮件判断重要程度，并找出值得进入知识库的内容。**只输出一个 JSON 对象，不要输出任何其它文字**：',
    '',
    '```json',
    '{',
    '  "verdicts": [{ "mail": 1, "importance": "focus | digest | normal", "why": "一句话理由" }],',
    '  "people": [{ "name": "张三", "relation": "此人和我的关系（一句话）", "reason": "为什么值得记住", "email": "发件人邮箱或 null" }],',
    '  "todos": [{ "title": "要做的事", "due": "YYYY-MM-DD 或 null", "body": "可选的补充正文" }],',
    '  "projects": [{ "name": "已存在的项目名", "note": "这封邮件对它意味着什么（一句话）" }],',
    '  "resources": [{ "name": "值得留存的材料标题", "summary": "两三句话的摘要", "mail": 来自哪封邮件的编号或 null }]',
    '}',
    '```',
    '',
    '重要程度（verdicts[].importance）的判断规则，每封邮件都必须给出一个：',
    '- `focus`（重点提醒）：主送我、且内容严重或有风险——涉及我的上级、明确的截止时限、需要我行动或追责的事项。上级的判定以知识库里关系为 superior 的人物为准。',
    '- `digest`（汇总类）：系统自动发送的邮催/催办、日常通知、例行通告。它们合并汇总即可，不值得逐封提醒。',
    '- `normal`（普通）：其余邮件。',
    '- 拿不准就往低判：宁可漏掉一个重点，也不要把通知抬成重点。',
    '',
    '规则：',
    '- `verdicts[].mail` 用邮件方括号里的编号；每封邮件恰好一条。',
    '- `projects[].name` 必须来自上面给出的项目名列表；对不上就留空数组，不要新建项目。',
    '- `todos[].due` 只在邮件里明确写了时间才填，否则填 null。',
    '- `people[].email` 只在这批邮件里能拿到该人地址时填，否则填 null。',
    '- 拿不准的不要输出：宁可少，不可错。',
    '- 邮件本身默认不是资源，只有确实值得长期留存的材料才进 `resources`，并注明来自哪封邮件。',
    '',
    '邮件：',
    '',
    mails.map((mail, index) => renderMail(mail, offset + index + 1)).join('\n\n'),
  ].join('\n')
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
 * A `YYYY-MM-DD` stamp, or undefined for anything else — a model that guesses
 * a date in another shape gets no deadline rather than a corrupt one.
 * @param value - the raw field.
 * @returns the stamp when it is a real date string.
 */
function date(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

/**
 * A mail number, or undefined for anything else — the model cites the numbers
 * the prompt gave, and anything else is no citation at all.
 * @param value - the raw field.
 * @returns the 1-based number when it is a positive integer.
 */
function mailNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** The importance words the prompt offers, anything else reading as `normal`. */
const IMPORTANCES: readonly MailImportance[] = ['focus', 'digest', 'normal']

/**
 * Read the model's answer. It is asked for a fenced JSON object and usually
 * answers with one; a model that answers prose-then-JSON is still readable, so
 * the outermost braces win. Anything unreadable is an error the panel shows —
 * never a silent empty verdict, which would look like "nothing to do".
 * @param text - the assistant message's text.
 * @returns the proposed verdict.
 */
export function parseAnalysis(text: string): MailAnalysis {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const source = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('模型没有返回可解析的 JSON，请到该会话里查看它的原话。')
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY
  const value = parsed as Record<string, unknown>

  const verdicts = rows(value.verdicts).map((row): MailVerdict | undefined => {
    const mail = mailNumber((row as Record<string, unknown> | null)?.mail)
    if (mail === undefined) return undefined
    const raw = field(row, 'importance')
    const importance = IMPORTANCES.find(entry => entry === raw) ?? 'normal'
    return { mail, importance, why: field(row, 'why') }
  })
  const people = rows(value.people).map((row): MailPerson | undefined => {
    const name = field(row, 'name')
    if (name === '') return undefined
    const email = field(row, 'email')
    return {
      name,
      relation: field(row, 'relation'),
      reason: field(row, 'reason'),
      ...email !== '' ? { email } : {},
    }
  })
  const todos = rows(value.todos).map((row): MailTodo | undefined => {
    const title = field(row, 'title')
    if (title === '') return undefined
    const due = date((row as Record<string, unknown> | null)?.due)
    return { title, body: field(row, 'body'), ...due !== undefined ? { due } : {} }
  })
  const projects = rows(value.projects).map((row): MailProjectNote | undefined => {
    const name = field(row, 'name')
    return name === '' ? undefined : { name, note: field(row, 'note') }
  })
  const resources = rows(value.resources).map((row): MailResource | undefined => {
    const name = field(row, 'name')
    if (name === '') return undefined
    const mail = mailNumber((row as Record<string, unknown> | null)?.mail)
    return { name, summary: field(row, 'summary'), ...mail !== undefined ? { mail } : {} }
  })

  return {
    verdicts: verdicts.filter((row): row is MailVerdict => row !== undefined),
    people: people.filter((row): row is MailPerson => row !== undefined),
    todos: todos.filter((row): row is MailTodo => row !== undefined),
    projects: projects.filter((row): row is MailProjectNote => row !== undefined),
    resources: resources.filter((row): row is MailResource => row !== undefined),
  }
}

/** The result of one analysis run: the session it happened in, and the verdict. */
export interface AnalysisRun {
  /** The session's id — the panel offers it for re-reading. */
  readonly sessionId: string
  /** The session's name, 「邮件分析 YYYY-MM-DD」, echoed back for the window. */
  readonly title: string
  /** What the model proposed. */
  readonly analysis: MailAnalysis
}

/** The re-ask when the first answer is not readable JSON: JSON alone, nothing else. */
const REASK = '你上一条回答无法解析为 JSON。请只输出一个 JSON 对象（含 verdicts/people/todos/projects/resources 字段），不要输出任何其它文字。'

/**
 * One chunk of the batch through the already-created session, waited out to
 * its durable turn/end; an unreadable answer is re-asked once before the
 * failure surfaces with the model's own words.
 * @param options - the session, the chunk, its offset, what the KB holds, and the signal.
 * @returns the chunk's verdict.
 */
async function analyseChunk(options: {
  readonly session: SessionRemote
  readonly sessionId: string
  readonly mails: readonly KbMailMessage[]
  readonly known: KnownEntities
  readonly offset: number
  readonly signal?: AbortSignal
}): Promise<MailAnalysis> {
  return jsonRound({
    session: options.session,
    sessionId: options.sessionId,
    prompt: mailPrompt(options.mails, options.known, options.offset),
    reask: REASK,
    parse: parseAnalysis,
    ...options.signal !== undefined ? { signal: options.signal } : {},
  })
}

/**
 * Run one analysis: create a session, name it, and walk the batch in chunks
 * of {@link CHUNK_SIZE}, one waited-out turn per chunk. Each chunk's verdicts
 * are reported as they land, so the panel lights up mail by mail instead of
 * after one long silence.
 *
 * The session is created in the KB root's directory when one is given, so it
 * lands in the session list the KB-scoped views already read (an unnamed
 * directory would inherit the host process's cwd instead).
 * @param options - the context, the batch, what the KB already holds, and the
 *   progress callback.
 * @returns the session id and the merged verdict.
 */
export async function runMailAnalysis(options: {
  readonly ctx: Context
  readonly mails: readonly KbMailMessage[]
  readonly known: KnownEntities
  readonly cwd?: string
  readonly onProgress?: (progress: AnalysisProgress) => void
  readonly signal?: AbortSignal
}): Promise<AnalysisRun> {
  const { ctx, mails, known, cwd, onProgress } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')

  onProgress?.({ stage: 'session' })
  const created = await session.create(cwd === undefined ? {} : { cwd })
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId

  // Named up front: the point of keeping the session is being able to find
  // it again, and an untitled session is unfindable.
  // Domain data, not UI copy: the session's name lives in the KB's own
  // language, so it stays Chinese regardless of the workbench locale.
  const sessionName = `邮件分析 ${stamp()}`
  const named = await session.rename({ sessionId, title: sessionName })
  if (!named.ok) throw named.error

  onProgress?.({ stage: 'prompt' })
  const verdicts: MailVerdict[] = []
  const people: MailPerson[] = []
  const todos: MailTodo[] = []
  const projects: MailProjectNote[] = []
  const resources: MailResource[] = []
  for (let start = 0; start < mails.length; start += CHUNK_SIZE) {
    const chunk = mails.slice(start, start + CHUNK_SIZE)
    const analysis = await analyseChunk({
      session,
      sessionId,
      mails: chunk,
      known,
      offset: start,
      ...options.signal !== undefined ? { signal: options.signal } : {},
    })
    verdicts.push(...analysis.verdicts)
    people.push(...analysis.people)
    todos.push(...analysis.todos)
    projects.push(...analysis.projects)
    resources.push(...analysis.resources)
    onProgress?.({
      stage: 'answer',
      done: Math.min(start + CHUNK_SIZE, mails.length),
      total: mails.length,
      verdicts: [...verdicts],
    })
  }
  return { sessionId, title: sessionName, analysis: { verdicts, people, todos, projects, resources } }
}
