/**
 * The reading flow (ADR-0020): one real dsh session reads a book's extracted
 * text through `kb_read_resource` and proposes which 领域 the reading project
 * belongs to — the MailReview two-beat (ADR-0019): the agent proposes, the
 * human confirms, a second round writes.
 *
 * Like the mail analysis, the session is created, named and driven from the
 * browser, and kept (「读书-《书名》」) so the reading can be re-read later.
 * Nothing here writes to the KB: the first round only reads the book and
 * writes the project's own 状态/流水 through the agent's kb_* tools; the
 * domain links land only after the human ticks the proposal.
 * @module @deepseek-ai/dsh-client-ui-yantao/reading-flow
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionRemoteOf } from './remote.ts'

/** What the first round proposes: the domains this book belongs under. */
export interface ReadingProposal {
  /** Existing 领域 names the book fits; only these are offered for ticking. */
  readonly domains: readonly string[]
  /** A 领域 the KB does not hold yet, proposed for creation. */
  readonly newDomain?: string
}

/** An empty proposal: the model found no fitting domain at all. */
const EMPTY: ReadingProposal = { domains: [] }

/** Where one reading run has got to — the dialog turns it into a line of prose. */
export type ReadingStage = 'session' | 'prompt' | 'reading' | 'parse'

/** One progress report: the stage the run has reached. */
export interface ReadingProgress {
  readonly stage: ReadingStage
}

/** The result of the first round: the session it ran in, and the proposal. */
export interface ReadingRun {
  /** The session's id — the dialog offers it for re-reading. */
  readonly sessionId: string
  /** The session's name, 「读书-《书名》」, echoed back for the window. */
  readonly title: string
  /** What the model proposed. */
  readonly proposal: ReadingProposal
}

/** Today as a YYYY-MM-DD stamp, in the human's own timezone. */
function stamp(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const date = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

/**
 * The first-round prompt: read the book through the paged tool, write the
 * outline into the project's 状态, log the process into 流水, then answer
 * with the domain proposal as one JSON object.
 * @param bookTitle - the book's display name (without 《》).
 * @param projectPath - the reading project's KB-relative path.
 * @param resourcePath - the book file's KB-relative path under `resources/`.
 * @param knownAreas - the 领域 the KB already holds, so the model matches
 *   instead of inventing.
 * @returns the prompt text.
 */
export function readingPrompt(
  bookTitle: string,
  projectPath: string,
  resourcePath: string,
  knownAreas: readonly string[],
): string {
  const list = knownAreas.length === 0 ? '（还没有领域）' : knownAreas.join('、')
  return [
    `你在整理个人知识库。我刚创建了读书项目「读书-《${bookTitle}》」（\`${projectPath}\`），它的 frontmatter 里 \`source:\` 指向书文件 \`${resourcePath}\`。`,
    '',
    '请这样做：',
    '',
    `1. 用 \`kb_read_resource\` 读 \`${resourcePath}\`：每次返回一段文本和 \`hasMore\`，从 offset 0 开始，按返回的提示继续翻页，直到读完。书可能很长，不要跳读关键章节以外就下结论。`,
    '2. 读完（或确认无法读完）后，用 `kb_write_state` 把这本书的大纲写进读书项目的 `## 状态`：书的核心论点、章节脉络、值得记住的点。用中文写。',
    '3. 用 `kb_append_log` 在 `## 流水` 记一行今天读完了这本书。',
    `4. 判断这本书适合挂到哪些领域下面。知识库里已有的领域：${list}`,
    '',
    '最后**只输出一个 JSON 对象，不要输出任何其它文字**：',
    '',
    '```json',
    '{',
    '  "domains": ["已有领域名", …],',
    '  "newDomain": "建议新建的领域名，不需要就填 null"',
    '}',
    '```',
    '',
    '规则：',
    '- `domains` 里的每个名字必须来自上面给出的领域列表；对不上就不要写进去。',
    '- 没有合适的领域就返回空数组；确实需要新领域才填 `newDomain`，宁可少，不可错。',
  ].join('\n')
}

/**
 * The second-round prompt: land what the human confirmed. Existing domains
 * become `[[领域:名字]]` links in the project's 状态 (the backlink the other
 * way is ADR-0015's automatic work); a confirmed new domain is created first
 * through `kb_create_entity`.
 * @param projectPath - the reading project's KB-relative path.
 * @param domains - the confirmed existing-domain names.
 * @param newDomain - the confirmed new-domain name, when one was chosen.
 * @returns the prompt text.
 */
export function domainConfirmPrompt(projectPath: string, domains: readonly string[], newDomain?: string): string {
  const lines = [
    `读书项目 \`${projectPath}\` 的领域关联已经由人确认。请执行：`,
    '',
  ]
  if (newDomain !== undefined) {
    lines.push(
      `1. 先用 \`kb_create_entity\` 创建领域「${newDomain}」。`,
      `2. 再用 \`kb_write_state\` 把 \`[[领域:${newDomain}]]\` 写进该项目的 \`## 状态\`。`,
    )
  } else {
    lines.push(
      `1. 用 \`kb_write_state\` 把 ${domains.map(name => `\`[[领域:${name}]]\``).join('、')} 写进该项目的 \`## 状态\`。`,
    )
  }
  lines.push('', '写完后简单说一句做了什么即可。')
  return lines.join('\n')
}

/** One string field of a parsed JSON row, or `''` when it is not a string. */
function field(row: unknown, key: string): string {
  if (typeof row !== 'object' || row === null) return ''
  const value = (row as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Read the model's proposal. Same contract as the mail analysis: a fenced
 * JSON object is asked for and usually answered; anything unreadable is an
 * error the dialog shows — never a silent empty verdict.
 * @param text - the assistant message's text.
 * @returns the proposed domains.
 */
export function parseProposal(text: string): ReadingProposal {
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
  const domains = (Array.isArray(value.domains) ? value.domains : [])
    .map(entry => typeof entry === 'string' ? entry.trim() : '')
    .filter(entry => entry !== '')
  const newDomain = field(value, 'newDomain')
  return { domains, ...newDomain !== '' ? { newDomain } : {} }
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

/** The title a reading session carries, so it can be found again. */
export function readingSessionTitle(bookTitle: string): string {
  return `读书-《${bookTitle}》 ${stamp()}`
}

/**
 * Run the first round: create a session, name it, hand it the reading prompt,
 * and follow it until the assistant's answer lands.
 *
 * The session is created with no workspace of its own, so it inherits the
 * workbench's — which ADR-0013 keeps pointed at the KB root.
 * @param options - the context, the book, the project, and the progress callback.
 * @returns the session id and the proposal.
 */
export async function runReadingFlow(options: {
  readonly ctx: Context
  readonly bookTitle: string
  readonly projectPath: string
  readonly resourcePath: string
  readonly knownAreas: readonly string[]
  readonly onProgress?: (progress: ReadingProgress) => void
  readonly signal?: AbortSignal
}): Promise<ReadingRun> {
  const { ctx, bookTitle, projectPath, resourcePath, knownAreas, onProgress } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')

  onProgress?.({ stage: 'session' })
  const created = await session.create({})
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId

  // Named up front: the point of keeping the session is being able to find
  // it again, and an untitled session is unfindable.
  const title = readingSessionTitle(bookTitle)
  const named = await session.rename({ sessionId, title })
  if (!named.ok) throw named.error

  onProgress?.({ stage: 'prompt' })
  const prompted = await session.prompt({
    requestId: randomUUID() as SessionRequestId,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: readingPrompt(bookTitle, projectPath, resourcePath, knownAreas) }],
  }, options.signal)
  if (!prompted.ok) throw prompted.error

  // Follow until the turn's durable assistant message commits. The streaming
  // frames are for a typing indicator; the message is the answer.
  onProgress?.({ stage: 'reading' })
  for await (const frame of session.follow({ address: { kind: 'session', sessionId } }, options.signal)) {
    if (frame.type !== 'event') continue
    if (frame.event.type !== 'assistant/message') continue
    onProgress?.({ stage: 'parse' })
    return { sessionId, title, proposal: parseProposal(messageText(frame.event.data)) }
  }
  throw new Error('会话结束了却没有给出回答。')
}

/**
 * Run the second round: land the confirmed proposal in the project's 状态.
 * The session is addressed by id — the same one the first round ran in, so
 * the whole reading stays in one re-readable place.
 * @param options - the context, the session id, the project, and what was confirmed.
 * @returns when the round's answer has landed.
 */
export async function runDomainConfirm(options: {
  readonly ctx: Context
  readonly sessionId: string
  readonly projectPath: string
  readonly domains: readonly string[]
  readonly newDomain?: string
  readonly signal?: AbortSignal
}): Promise<void> {
  const { ctx, sessionId, projectPath, domains, newDomain } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')

  const prompted = await session.prompt({
    requestId: randomUUID() as SessionRequestId,
    sessionId: sessionId as SessionId,
    mode: 'queue',
    content: [{ type: 'text', text: domainConfirmPrompt(projectPath, domains, newDomain) }],
  }, options.signal)
  if (!prompted.ok) throw prompted.error

  for await (const frame of session.follow({ address: { kind: 'session', sessionId: sessionId as SessionId } }, options.signal)) {
    if (frame.type !== 'event') continue
    if (frame.event.type !== 'assistant/message') continue
    return
  }
  throw new Error('会话结束了却没有给出回答。')
}

/** Run the first round — the dialog's seam, so a test can stand in for a session. */
export type BookReader = (options: {
  readonly bookTitle: string
  readonly projectPath: string
  readonly resourcePath: string
  readonly knownAreas: readonly string[]
  readonly onProgress?: (progress: ReadingProgress) => void
}) => Promise<ReadingRun>

/** Run the second round — land the confirmed domain links. */
export type DomainConfirmer = (options: {
  readonly sessionId: string
  readonly projectPath: string
  readonly domains: readonly string[]
  readonly newDomain?: string
}) => Promise<void>
