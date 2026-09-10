/**
 * The mail analysis (ADR-0019): one real dsh session reads a batch of mails
 * and answers a JSON verdict, which the human then confirms block by block.
 *
 * The session is created, named and driven from the browser through the
 * session Remote — the first time the workbench asks the agent to work without
 * a human typing. It is kept (and named 「邮件分析 YYYY-MM-DD」) precisely so a
 * judgement can be re-read later, which is the point: these are decisions
 * about what enters a knowledge base that outlives the mail. It reports the
 * stage it has reached, because the only thing worse than a slow judgement is
 * a silent one.
 *
 * Nothing here writes to the KB. The analysis only proposes; {@link MailPanel}
 * is what applies, and only after the human has ticked the rows.
 * @module @deepseek-ai/dsh-client-ui-yantao/mail-analysis
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { sessionRemoteOf } from './remote.ts'

/** A person the analysis proposes adding to `entities/people/`. */
export interface MailPerson {
  /** The person's display name; becomes the entity file's name. */
  readonly name: string
  /** The relation the model infers — shown so the human can judge it. */
  readonly relation: string
  /** Why the model thinks this person is worth remembering. */
  readonly reason: string
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
}

/** Everything one analysis proposes; every block is confirmed separately. */
export interface MailAnalysis {
  readonly people: readonly MailPerson[]
  readonly todos: readonly MailTodo[]
  readonly projects: readonly MailProjectNote[]
  readonly resources: readonly MailResource[]
}

/** Where one analysis run has got to — the panel turns it into a line of prose. */
export type AnalysisStage = 'session' | 'prompt' | 'answer' | 'parse'

/** One progress report: the stage the run has reached. */
export interface AnalysisProgress {
  readonly stage: AnalysisStage
}

/**
 * Run one analysis over a batch — the panel's seam to the session Remote, so
 * a test can hand back a verdict without a session ever existing.
 * @param onProgress - called as the run moves between its stages.
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
  /** Existing person names. */
  readonly people: readonly string[]
}

/** An empty verdict: what a parse returns when the model found nothing. */
const EMPTY: MailAnalysis = { people: [], todos: [], projects: [], resources: [] }

/** Today as a YYYY-MM-DD stamp, in the human's own timezone. */
function stamp(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const date = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

/**
 * One mail as the model sees it: time, sender, subject, body — and nothing
 * else. No CC, no recipient list: they say nothing about importance and are
 * the largest block of PII in the message (ADR-0019).
 * @param mail - the mail to render.
 * @param index - its position in the batch, so the model can cite it.
 * @returns the rendered block.
 */
function renderMail(mail: KbMailMessage, index: number): string {
  const lines = [
    `[${index + 1}] ${mail.receivedAt} ${mail.senderName} <${mail.senderAddress}>`,
    `主题：${mail.subject || '（无主题）'}`,
    `正文：${mail.body}${mail.truncated ? '（已截断）' : ''}`,
  ]
  return lines.join('\n')
}

/**
 * The analysis prompt: the mails, what the KB already holds, and the exact
 * JSON shape to answer with.
 * @param mails - the batch to analyse.
 * @param known - existing project and person names.
 * @returns the prompt text.
 */
export function mailPrompt(mails: readonly KbMailMessage[], known: KnownEntities): string {
  const list = (values: readonly string[]): string => values.length === 0 ? '（无）' : values.join('、')
  return [
    `你是个人知识库的整理助手。下面是 ${mails.length} 封新邮件（收件时间、发件人、主题、正文；正文已截断到 3000 字）。`,
    '',
    `知识库里已有的项目/领域：${list(known.projects)}`,
    `知识库里已有的人物：${list(known.people)}`,
    '',
    '请判断这些邮件里有什么值得进入知识库。**只输出一个 JSON 对象，不要输出任何其它文字**：',
    '',
    '```json',
    '{',
    '  "people": [{ "name": "张三", "relation": "此人和我的关系（一句话）", "reason": "为什么值得记住" }],',
    '  "todos": [{ "title": "要做的事", "due": "YYYY-MM-DD 或 null", "body": "可选的补充正文" }],',
    '  "projects": [{ "name": "已存在的项目名", "note": "这封邮件对它意味着什么（一句话）" }],',
    '  "resources": [{ "name": "值得留存的材料标题", "summary": "两三句话的摘要" }]',
    '}',
    '```',
    '',
    '规则：',
    '- `projects[].name` 必须来自上面给出的项目名列表；对不上就留空数组，不要新建项目。',
    '- `todos[].due` 只在邮件里明确写了时间才填，否则填 null。',
    '- 拿不准的不要输出：宁可少，不可错。',
    '- 邮件本身默认不是资源，只有确实值得长期留存的材料才进 `resources`。',
    '',
    '邮件：',
    '',
    mails.map(renderMail).join('\n\n'),
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

  const people = rows(value.people).map((row): MailPerson | undefined => {
    const name = field(row, 'name')
    return name === '' ? undefined : { name, relation: field(row, 'relation'), reason: field(row, 'reason') }
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
    return name === '' ? undefined : { name, summary: field(row, 'summary') }
  })

  return {
    people: people.filter((row): row is MailPerson => row !== undefined),
    todos: todos.filter((row): row is MailTodo => row !== undefined),
    projects: projects.filter((row): row is MailProjectNote => row !== undefined),
    resources: resources.filter((row): row is MailResource => row !== undefined),
  }
}

/**
 * The text of one durable assistant message: the content parts' text blocks,
 * read defensively because this arrived as wire JSON.
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
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
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

/**
 * Run one analysis: create a session, name it, prompt it, and follow it until
 * the assistant's answer lands.
 *
 * The session is created with no workspace of its own, so it inherits the
 * workbench's — which ADR-0013 keeps pointed at the KB root.
 * @param options - the context, the batch, what the KB already holds, and the
 *   progress callback.
 * @returns the session id and the verdict.
 */
export async function runMailAnalysis(options: {
  readonly ctx: Context
  readonly mails: readonly KbMailMessage[]
  readonly known: KnownEntities
  readonly onProgress?: (progress: AnalysisProgress) => void
  readonly signal?: AbortSignal
}): Promise<AnalysisRun> {
  const { ctx, mails, known, onProgress } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')

  onProgress?.({ stage: 'session' })
  const created = await session.create({})
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId

  // Named up front: the point of keeping the session is being able to find
  // it again, and an untitled session is unfindable.
  const title = `邮件分析 ${stamp()}`
  const named = await session.rename({ sessionId, title })
  if (!named.ok) throw named.error

  onProgress?.({ stage: 'prompt' })
  const prompted = await session.prompt({
    requestId: randomUUID() as SessionRequestId,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: mailPrompt(mails, known) }],
  }, options.signal)
  if (!prompted.ok) throw prompted.error

  // Follow until the turn's durable assistant message commits. The streaming
  // frames are for a typing indicator; the message is the answer.
  onProgress?.({ stage: 'answer' })
  for await (const frame of session.follow({ address: { kind: 'session', sessionId } }, options.signal)) {
    if (frame.type !== 'event') continue
    if (frame.event.type !== 'assistant/message') continue
    onProgress?.({ stage: 'parse' })
    return { sessionId, title, analysis: parseAnalysis(messageText(frame.event.data)) }
  }
  throw new Error('会话结束了却没有给出回答。')
}
