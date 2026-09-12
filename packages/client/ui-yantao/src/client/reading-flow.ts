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
import { sessionRemoteOf } from './remote.ts'
import { askTurn, jsonRound } from './turn-answer.ts'

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
export type ReadingStage = 'session' | 'prompt' | 'reading'

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
    '这本书的抽取文本可能长达几十万字，从头到尾翻完既做不到也没有必要。请这样做：',
    '',
    `1. 用 \`kb_read_resource\` 读 \`${resourcePath}\` 的开头（offset 0）：先看书名、目录、前言，弄清这本书讲什么、分哪些部分。`,
    '2. 再抽样读最多 6 段：按全书总字数（工具会告诉你）挑有代表性的位置，比如各部分的开头，每次读一段。',
    '3. 抽样满 6 段就停下，不要继续翻页——通读开头加抽样判断，足够整理出一份可信的大纲。',
    '4. 用 `kb_write_state` 把这本书的大纲写进读书项目的 `## 状态`：核心论点、章节脉络（目录能看出的）、抽样读到的要点，并注明哪些是通读、哪些是抽样判断。用中文写。',
    '5. 用 `kb_append_log` 在 `## 流水` 记一行今天整理了这本书（注明是抽样阅读）。',
    `6. 判断这本书适合挂到哪些领域下面。知识库里已有的领域：${list}`,
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

/** The title a reading session carries, so it can be found again. */
export function readingSessionTitle(bookTitle: string): string {
  return `读书-《${bookTitle}》 ${stamp()}`
}

/** The re-ask when the first answer is not readable JSON: JSON alone, nothing else. */
const REASK = '你上一条回答无法解析为 JSON。请只输出一个 JSON 对象（含 domains 和 newDomain 字段），不要输出任何其它文字。'

/**
 * Run the first round: create a session, name it, hand it the reading prompt,
 * and wait out the turn it starts.
 *
 * The session is created in the KB root's directory when one is given, so it
 * lands in the session list the KB-scoped views already read (an unnamed
 * directory would inherit the host process's cwd instead).
 * @param options - the context, the book, the project, and the progress callback.
 * @returns the session id and the proposal.
 */
export async function runReadingFlow(options: {
  readonly ctx: Context
  readonly bookTitle: string
  readonly projectPath: string
  readonly resourcePath: string
  readonly knownAreas: readonly string[]
  readonly cwd?: string
  readonly onProgress?: (progress: ReadingProgress) => void
  readonly signal?: AbortSignal
}): Promise<ReadingRun> {
  const { ctx, bookTitle, projectPath, resourcePath, knownAreas, cwd, onProgress } = options
  const session = sessionRemoteOf(ctx)
  if (session === undefined) throw new Error('没有挂载 session Remote 命名空间')

  onProgress?.({ stage: 'session' })
  const created = await session.create(cwd === undefined ? {} : { cwd })
  if (!created.ok) throw created.error
  const sessionId = created.value.sessionId

  // Named up front: the point of keeping the session is being able to find
  // it again, and an untitled session is unfindable.
  const title = readingSessionTitle(bookTitle)
  const named = await session.rename({ sessionId, title })
  if (!named.ok) throw named.error

  // One turn, waited out to its durable turn/end; an unreadable answer is
  // re-asked once before the failure surfaces with the model's own words.
  onProgress?.({ stage: 'prompt' })
  onProgress?.({ stage: 'reading' })
  const proposal = await jsonRound({
    session,
    sessionId,
    prompt: readingPrompt(bookTitle, projectPath, resourcePath, knownAreas),
    reask: REASK,
    parse: parseProposal,
    ...options.signal !== undefined ? { signal: options.signal } : {},
  })
  return { sessionId, title, proposal }
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

  await askTurn({
    session,
    sessionId,
    prompt: domainConfirmPrompt(projectPath, domains, newDomain),
    ...options.signal !== undefined ? { signal: options.signal } : {},
  })
}

/** Run the first round — the dialog's seam, so a test can stand in for a session. */
export type BookReader = (options: {
  readonly bookTitle: string
  readonly projectPath: string
  readonly resourcePath: string
  readonly knownAreas: readonly string[]
  readonly cwd?: string
  readonly onProgress?: (progress: ReadingProgress) => void
  readonly signal?: AbortSignal
}) => Promise<ReadingRun>

/** Run the second round — land the confirmed domain links. */
export type DomainConfirmer = (options: {
  readonly sessionId: string
  readonly projectPath: string
  readonly domains: readonly string[]
  readonly newDomain?: string
  readonly signal?: AbortSignal
}) => Promise<void>
