/**
 * The proposal queue (ADR-0044): the holding pen between an agent's
 * experience and the behavior memory. `kb_propose_memory` is the agent's
 * ONLY memory write face, and it never touches the memory files — a
 * proposal lands here and stays inert until a human approves it (promotion
 * strips the source annotation and appends the bare text through
 * `appendMemoryEntry`) or discards it. The queue is never injected into any
 * prompt: poisoned output can at worst sit in the inbox awaiting human eyes,
 * and the injection header's promise — every line was approved by a human —
 * stays true.
 *
 * One file per scope under `<kbRoot>/.dsh/yantao/memory/proposals/`,
 * isomorphic to a memory file (line-shaped bullets, sha1 ids, date stamps)
 * plus one trailing 〔source〕 annotation per line naming where the lesson
 * came from (会话 / UI 运行摘要). The id ignores the annotation, so a
 * proposal and the memory it promotes into share one id.
 * @module @deepseek-ai/dsh-yantao-kb/proposals
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertMemoryScope,
  MEMORY_GLOBAL_SCOPE,
  memoryEntryId,
  parseMemoryFile,
  readMemoryScope,
} from './memory.ts'
import { todayStamp } from './paths.ts'
import { KbError } from './types.ts'

/**
 * Soft cap of pending proposals per scope (ADR-0044 决定 3): a full queue
 * refuses new proposals and tells the agent the human must process the inbox
 * first. Unlike the memory soft cap (which only trims injection), this one
 * bites — backlog is meant to hurt, not pile up silently.
 */
export const PROPOSAL_PENDING_SOFT_CAP = 20

/** One proposed (not yet approved) memory entry. */
export interface MemoryProposal {
  /** Stable id: `sha1("<scope>|<text>")` — identical to the id the entry carries in memory after promotion. */
  readonly id: string
  /** Proposal stamp (YYYY-MM-DD); a hand-written line may omit it. */
  readonly date?: string
  /** The distilled text, source annotation stripped. */
  readonly text: string
  /** Where the lesson came from (会话 / UI 运行摘要); `''` for a hand-written line without one. */
  readonly source: string
}

/** The parsed proposal file: the preamble above the entries plus the entries in file order. */
export interface MemoryProposalFile {
  /** Everything before the first entry line, trailing newlines folded away. */
  readonly preamble: string
  /** The pending proposals, in file order. */
  readonly entries: readonly MemoryProposal[]
}

/** One scope's proposal queue as the RPC layer reports it. */
export interface MemoryProposalScope {
  /** The scope: `global`, or the capability's skill name. */
  readonly scope: string
  /** KB-relative path of the queue's markdown file, forward slashes. */
  readonly path: string
  /** The file's exact current text — an absent file reads as `''`, never an error. */
  readonly text: string
  /** The parsed pending proposals, in file order; empty for an absent file. */
  readonly entries: readonly MemoryProposal[]
}

/** The trailing 〔source〕 annotation of a proposal line; the text itself may contain earlier brackets. */
const SOURCE_TAIL = /〔([^〕]*)〕$/

/** The scope's queue file path, KB-relative with forward slashes. */
export function proposalDisplayPath(scope: string): string {
  assertMemoryScope(scope)
  return `.dsh/yantao/memory/proposals/${scope}.md`
}

/** The absolute path of the queue's markdown file, confined to the KB root. */
function proposalTarget(kbRoot: string, scope: string): string {
  assertMemoryScope(scope)
  return join(kbRoot, '.dsh', 'yantao', 'memory', 'proposals', `${scope}.md`)
}

/** A fresh queue file: one heading, proposals appended below it. */
function proposalFileContent(scope: string): string {
  const title = scope === MEMORY_GLOBAL_SCOPE ? '记忆提案 · 全局' : `记忆提案 · ${scope}`
  return `# ${title}\n\n<!-- 行式条目：每条提案一行「- YYYY-MM-DD 建议 〔来源〕」；人批准后建议转入 ../ 记忆文件并从此处移除，丢弃即删除该行 -->\n`
}

/** `- YYYY-MM-DD text 〔source〕` — the one line shape a proposal serializes to. */
export function proposalEntryLine(proposal: Pick<MemoryProposal, 'date' | 'text' | 'source'>): string {
  const stamp = proposal.date === undefined ? '' : `${proposal.date} `
  const tail = proposal.source === '' ? '' : ` 〔${proposal.source}〕`
  return `- ${stamp}${proposal.text}${tail}`
}

/**
 * Parse a proposal file: bullets become proposals (a leading YYYY-MM-DD
 * stamp is the date, a trailing 〔…〕 group is the source), everything
 * before the first bullet is the preamble. Hand edits degrade gracefully —
 * a stray line is preamble, a bullet with nothing but the annotation is
 * skipped, never a crash. The id is computed from the bare text, so it
 * survives promotion unchanged.
 * @param scope - the scope the text belongs to (ids are scope-qualified).
 * @param text - the file's complete text; `''` parses to no entries.
 */
export function parseProposalFile(scope: string, text: string): MemoryProposalFile {
  const parsed = parseMemoryFile(scope, text)
  const entries: MemoryProposal[] = []
  for (const entry of parsed.entries) {
    const source = SOURCE_TAIL.exec(entry.text)?.[1] ?? ''
    const bare = entry.text.replace(SOURCE_TAIL, '').trim()
    if (bare === '') continue
    entries.push({ id: memoryEntryId(scope, bare), ...(entry.date !== undefined ? { date: entry.date } : {}), text: bare, source })
  }
  return { preamble: parsed.preamble, entries }
}

/**
 * Reassemble a proposal file from a preamble and entries: the canonical
 * round trip — `serializeProposalFile(parseProposalFile(scope, text))` —
 * reproduces a well-formed file byte for byte.
 */
export function serializeProposalFile(file: MemoryProposalFile): string {
  const body = file.entries.map(proposal => proposalEntryLine(proposal)).join('\n')
  if (file.preamble === '') return body === '' ? '' : `${body}\n`
  return body === '' ? `${file.preamble}\n` : `${file.preamble}\n\n${body}\n`
}

/** Read one scope's queue whole: path, exact text, parsed entries. An absent file is empty, not an error. */
export async function readProposalScope(kbRoot: string, scope: string): Promise<MemoryProposalScope> {
  assertMemoryScope(scope)
  const path = proposalDisplayPath(scope)
  let text = ''
  try {
    text = await readFile(proposalTarget(kbRoot, scope), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { scope, path, text, entries: parseProposalFile(scope, text).entries }
}

/**
 * List every scope that has pending proposals: the global scope first, then
 * the capability scopes name-sorted. The queue is a worklist, not a document
 * browser — a scope whose queue file holds no entries (never created, or
 * drained by approvals/discards) is not listed, so the answer is exactly
 * 全部在途提案. The drained file itself stays on disk with its preamble;
 * only the listing shrinks.
 */
export async function listProposalScopes(kbRoot: string): Promise<readonly MemoryProposalScope[]> {
  const proposalRoot = join(kbRoot, '.dsh', 'yantao', 'memory', 'proposals')
  const scopes: string[] = []
  if (await readFile(join(proposalRoot, 'global.md')).then(() => true, () => false)) {
    scopes.push(MEMORY_GLOBAL_SCOPE)
  }
  let files: string[] = []
  try {
    files = await readdir(proposalRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const scope = file.slice(0, -'.md'.length)
    try {
      assertMemoryScope(scope)
    } catch {
      continue
    }
    if (!scopes.includes(scope)) scopes.push(scope)
  }
  const ordered = scopes.filter(scope => scope !== MEMORY_GLOBAL_SCOPE).sort()
  if (scopes.includes(MEMORY_GLOBAL_SCOPE)) ordered.unshift(MEMORY_GLOBAL_SCOPE)
  const listed = await Promise.all(ordered.map(scope => readProposalScope(kbRoot, scope)))
  return listed.filter(scope => scope.entries.length > 0)
}

/** Any line terminator: a proposal must serialize to exactly one physical line. */
const LINE_BREAK = /\r|\n/

/**
 * One scope's queue mutations serialized in-process: append and remove are
 * read-modify-write cycles over the same file, and the agent face
 * (`kb_propose_memory`) and the human RPCs run on independent async chains —
 * interleaved cycles lose proposals or resurrect discarded lines. The chain
 * never stays rejected (a failed cycle must not poison the next one).
 */
const queueLocks = new Map<string, Promise<unknown>>()

function withQueueLock<T>(scope: string, task: () => Promise<T>): Promise<T> {
  const previous = queueLocks.get(scope) ?? Promise.resolve()
  const next = previous.then(task, task)
  queueLocks.set(scope, next.catch(() => undefined))
  return next
}

/**
 * Append one proposal to a scope's queue (creating the file with its heading
 * when absent) and return the queue as it now sits. Five refusals stand
 * between the agent and the queue (ADR-0044 决定 3/4): the text is empty,
 * the text or source embeds a line break (the queue is line-shaped — a
 * broken line would parse back as a second, unsolicited proposal and flow
 * into memory unreviewed), the text ends with a 〔…〕 group (indistinguishable
 * from a source annotation once serialized — the bare text would drift and
 * the approval card could never settle), the text is already
 * remembered in the scope (`duplicate-memory`), the same text is already
 * pending (`duplicate-proposal`), or the scope's queue is full
 * (`proposal-queue-full`) — in every case the agent learns in place instead
 * of adding noise for the human to wade through.
 * @param kbRoot - the knowledge-base root directory.
 * @param scope - `global`, or the capability's skill name.
 * @param text - the distilled proposal text.
 * @param source - optional provenance for the human's judgment (会话 /
 *   UI 运行摘要); rendered as the trailing 〔…〕 annotation.
 */
export async function appendMemoryProposal(
  kbRoot: string,
  scope: string,
  text: string,
  source = '',
): Promise<MemoryProposalScope> {
  return withQueueLock(scope, async () => {
    assertMemoryScope(scope)
    const trimmed = text.trim()
    if (trimmed === '') throw new KbError('empty-proposal-text', '提案内容不能为空')
    if (LINE_BREAK.test(trimmed)) {
      throw new KbError('multiline-proposal-text', '提案内容必须是一行文字（不得包含换行）：队列一行一条，换行会被解析成第二条未经审阅的提案')
    }
    if (LINE_BREAK.test(source)) {
      throw new KbError('multiline-proposal-source', '提案来源注记不得包含换行：队列一行一条，换行会被解析成第二条未经审阅的提案')
    }
    if (SOURCE_TAIL.test(trimmed)) {
      throw new KbError('ambiguous-proposal-tail', '提案内容不能以〔…〕结尾：那会和来源注记混淆，正文会被改形导致审批卡无法定位这条提案')
    }
    const target = proposalTarget(kbRoot, scope)
    const remembered = await readMemoryScope(kbRoot, scope)
    if (remembered.entries.some(entry => entry.text === trimmed)) {
      throw new KbError('duplicate-memory', `这条经验已经是记忆了（作用域 ${scope}）：${trimmed}`)
    }
    const current = await readProposalScope(kbRoot, scope)
    if (current.entries.some(entry => entry.text === trimmed)) {
      throw new KbError('duplicate-proposal', `同样的提案已在队列里等待批准（作用域 ${scope}）：${trimmed}`)
    }
    if (current.entries.length >= PROPOSAL_PENDING_SOFT_CAP) {
      throw new KbError('proposal-queue-full',
        `作用域 ${scope} 的提案队列已满（${PROPOSAL_PENDING_SOFT_CAP} 条），请提醒人先到记忆视图处理待批准提案`)
    }
    const parsed = parseProposalFile(scope, current.text)
    const file: MemoryProposalFile = {
      preamble: current.text === '' ? proposalFileContent(scope).trimEnd() : parsed.preamble,
      entries: [...parsed.entries, { id: memoryEntryId(scope, trimmed), date: todayStamp(), text: trimmed, source }],
    }
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, `${serializeProposalFile(file)}\n`, 'utf8')
    return readProposalScope(kbRoot, scope)
  })
}

/**
 * Remove one proposal by text — the address the conversation approval card
 * holds (the tool args are scope+text, and per-scope dedup makes text
 * unique). Serves both verdicts: discard drops the line; promotion removes
 * it after `appendMemoryEntry` has landed the bare text in the memory file.
 * A stale text (already processed, or hand-edited since) surfaces as
 * `proposal-not-found` and the caller refreshes, never guesses.
 */
export async function removeMemoryProposalByText(
  kbRoot: string,
  scope: string,
  text: string,
): Promise<MemoryProposalScope> {
  return withQueueLock(scope, async () => {
    assertMemoryScope(scope)
    const target = proposalTarget(kbRoot, scope)
    const current = await readProposalScope(kbRoot, scope)
    const index = current.entries.findIndex(entry => entry.text === text.trim())
    if (index < 0) {
      throw new KbError('proposal-not-found', `作用域 ${scope} 的队列里没有这条提案（可能已被处理）`)
    }
    const parsed = parseProposalFile(scope, current.text)
    const file: MemoryProposalFile = {
      preamble: parsed.preamble,
      entries: parsed.entries.filter((_, at) => at !== index),
    }
    await writeFile(target, `${serializeProposalFile(file)}\n`, 'utf8')
    return readProposalScope(kbRoot, scope)
  })
}
