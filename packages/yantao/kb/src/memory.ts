/**
 * The memory store (ADR-0032): behavior rules the workbench remembers across
 * runs, one markdown file per scope under
 * `<kbRoot>/.dsh/yantao/memory/` — `global.md` for the workbench-wide
 * preferences, `capabilities/<name>.md` for the rules bound to one
 * capability. Memory is the "how to act" layer: it shapes the agent's future
 * behavior (batch ② injects it), while knowledge about entities stays in the
 * entities themselves.
 *
 * The file is the human's document, like every other markdown in the KB: an
 * entry is one `- ` bullet, optionally stamped `YYYY-MM-DD` at its head, and
 * everything above the first bullet is the preamble (a heading the human
 * wrote stays theirs). Parsing is line-shaped, so a hand edit survives
 * the next append; the entry id is the sha1 of `scope|text`, which makes
 * delete-by-id stable across re-reads as long as the text stands.
 * @module @deepseek-ai/dsh-yantao-kb/memory
 */

import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { todayStamp } from './paths.ts'
import { KbError } from './types.ts'

/** The workbench-wide scope: one file, `global.md`. */
export const MEMORY_GLOBAL_SCOPE = 'global'

/**
 * Soft cap per scope (ADR-0032 落地注记 3): injection truncates oldest-first
 * past this many entries and says so; nothing is ever auto-deleted.
 */
export const MEMORY_SCOPE_SOFT_CAP = 50

/** A capability scope's name must be one safe path segment — the same shape a capability name has. */
const SCOPE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** One remembered behavior rule. */
export interface MemoryEntry {
  /** Stable id: `sha1("<scope>|<text>")`; delete-by-id addresses this. */
  readonly id: string
  /** Creation stamp (YYYY-MM-DD) when the line carries one; a human-edited line may not. */
  readonly date?: string
  /** The rule's text, as written after the bullet (and optional stamp). */
  readonly text: string
}

/** The parsed memory file: the preamble above the entries plus the entries in file order. */
export interface MemoryFile {
  /** Everything before the first entry line, trailing newlines folded away — typically the heading. */
  readonly preamble: string
  /** The entries, in file order. */
  readonly entries: readonly MemoryEntry[]
}

/** One scope's memory as the RPC layer reports it. */
export interface MemoryScope {
  /** The scope: `global`, or the capability's skill name. */
  readonly scope: string
  /** KB-relative path of the scope's markdown file, forward slashes. */
  readonly path: string
  /** The file's exact current text — an absent file reads as `''`, never an error. */
  readonly text: string
  /** The parsed entries, in file order; empty for an absent file. */
  readonly entries: readonly MemoryEntry[]
}

/** Validate a scope name: `global`, or one capability-name-shaped segment (no separators, no escape). */
export function assertMemoryScope(scope: string): string {
  if (scope === MEMORY_GLOBAL_SCOPE) return scope
  if (!SCOPE_NAME.test(scope)) {
    throw new KbError('invalid-memory-scope', `记忆作用域只能是 global 或能力名（安全路径段）：${scope}`)
  }
  return scope
}

/** The scope's markdown file path, KB-relative with forward slashes. */
export function memoryDisplayPath(scope: string): string {
  return scope === MEMORY_GLOBAL_SCOPE
    ? '.dsh/yantao/memory/global.md'
    : `.dsh/yantao/memory/capabilities/${scope}.md`
}

/** The absolute path of the scope's markdown file, confined to the KB root. */
function memoryTarget(kbRoot: string, scope: string): string {
  assertMemoryScope(scope)
  return join(kbRoot, '.dsh', 'yantao', 'memory', ...(scope === MEMORY_GLOBAL_SCOPE
    ? ['global.md']
    : ['capabilities', `${scope}.md`]))
}

/** A fresh scope file: one heading, entries appended below it. */
function memoryFileContent(scope: string): string {
  const title = scope === MEMORY_GLOBAL_SCOPE ? '记忆 · 全局' : `记忆 · ${scope}`
  return `# ${title}\n\n<!-- 行式条目：每条记忆一行「- YYYY-MM-DD 规则」；上方标题是人写的，保留 -->\n`
}

/** `- YYYY-MM-DD text` / `- text` — the one line shape an entry serializes to. */
export function memoryEntryLine(entry: Pick<MemoryEntry, 'date' | 'text'>): string {
  return entry.date === undefined ? `- ${entry.text}` : `- ${entry.date} ${entry.text}`
}

/** The entry's stable id: `sha1("<scope>|<text>")`. */
export function memoryEntryId(scope: string, text: string): string {
  return createHash('sha1').update(`${scope}|${text}`, 'utf8').digest('hex')
}

/** One `- ` bullet at the very start of a line. */
const BULLET = /^- (.*)$/

/** The optional creation stamp at the head of a bullet's body; a date with no text is a blank bullet. */
const STAMP = /^(\d{4}-\d{2}-\d{2})(?:\s+(.*))?$/s

/**
 * Parse a memory file: bullets become entries (a leading YYYY-MM-DD stamp is
 * the entry's date), everything before the first bullet is the preamble with
 * its trailing newlines folded away. A human's free-form edits degrade
 * gracefully — a stray line is preamble, a blank bullet is skipped, never a
 * crash.
 * @param scope - the scope the text belongs to (ids are scope-qualified).
 * @param text - the file's complete text; `''` parses to no entries.
 * @returns the preamble and the entries in file order.
 */
export function parseMemoryFile(scope: string, text: string): MemoryFile {
  const lines = text.split('\n')
  let firstEntry = lines.findIndex(line => BULLET.test(line))
  if (firstEntry < 0) firstEntry = lines.length
  const entries: MemoryEntry[] = []
  for (const line of lines.slice(firstEntry)) {
    const match = BULLET.exec(line)
    if (match === null) continue
    const body = (match[1] ?? '').trim()
    if (body === '') continue
    const stamp = STAMP.exec(body)
    const date = stamp?.[1]
    const entryText = stamp === null ? body : stamp[2] ?? ''
    if (entryText.trim() === '') continue
    entries.push({ id: memoryEntryId(scope, entryText), ...(date !== undefined ? { date } : {}), text: entryText })
  }
  const preamble = lines.slice(0, firstEntry).join('\n').replace(/\n+$/, '')
  return { preamble, entries }
}

/**
 * Reassemble a memory file from a preamble and entries: the canonical round
 * trip — `serializeMemoryFile(parseMemoryFile(scope, text))` — reproduces a
 * well-formed file byte for byte, while hand-written headings ride along.
 */
export function serializeMemoryFile(file: MemoryFile): string {
  const body = file.entries.map(entry => memoryEntryLine(entry)).join('\n')
  if (file.preamble === '') return body === '' ? '' : `${body}\n`
  return body === '' ? `${file.preamble}\n` : `${file.preamble}\n\n${body}\n`
}

/** Read one scope whole: path, exact text, parsed entries. An absent file is empty, not an error. */
export async function readMemoryScope(kbRoot: string, scope: string): Promise<MemoryScope> {
  assertMemoryScope(scope)
  const path = memoryDisplayPath(scope)
  let text = ''
  try {
    text = await readFile(memoryTarget(kbRoot, scope), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { scope, path, text, entries: parseMemoryFile(scope, text).entries }
}

/**
 * List every scope that has a file: the global scope first, then the
 * capability scopes name-sorted. Scanning the directory (rather than a
 * registry) is the point — a file the human created by hand is a scope too.
 */
export async function listMemoryScopes(kbRoot: string): Promise<readonly MemoryScope[]> {
  const memoryRoot = join(kbRoot, '.dsh', 'yantao', 'memory')
  const scopes: string[] = []
  if (await readFile(join(memoryRoot, 'global.md')).then(() => true, () => false)) {
    scopes.push(MEMORY_GLOBAL_SCOPE)
  }
  let capabilityFiles: string[] = []
  try {
    capabilityFiles = await readdir(join(memoryRoot, 'capabilities'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  for (const file of capabilityFiles) {
    if (!file.endsWith('.md')) continue
    const scope = file.slice(0, -'.md'.length)
    if (SCOPE_NAME.test(scope)) scopes.push(scope)
  }
  const ordered = scopes.filter(scope => scope !== MEMORY_GLOBAL_SCOPE).sort()
  if (scopes.includes(MEMORY_GLOBAL_SCOPE)) ordered.unshift(MEMORY_GLOBAL_SCOPE)
  return Promise.all(ordered.map(scope => readMemoryScope(kbRoot, scope)))
}

/**
 * Append one entry to a scope (creating the file with its heading when
 * absent) and return the scope as it now sits. An entry whose text already
 * exists in the scope is refused — the caller shows the human what is already
 * remembered instead of writing a duplicate (ADR-0032 落地注记 2).
 */
export async function appendMemoryEntry(kbRoot: string, scope: string, text: string): Promise<MemoryScope> {
  assertMemoryScope(scope)
  const trimmed = text.trim()
  if (trimmed === '') throw new KbError('empty-memory-text', '记忆内容不能为空')
  const target = memoryTarget(kbRoot, scope)
  const current = await readMemoryScope(kbRoot, scope)
  if (current.entries.some(entry => entry.text === trimmed)) {
    throw new KbError('duplicate-memory', `这条记忆已经存在（作用域 ${scope}）：${trimmed}`)
  }
  const parsed = parseMemoryFile(scope, current.text)
  const file: MemoryFile = {
    preamble: current.text === '' ? memoryFileContent(scope).trimEnd() : parsed.preamble,
    entries: [...parsed.entries, { id: memoryEntryId(scope, trimmed), date: todayStamp(), text: trimmed }],
  }
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, `${serializeMemoryFile(file)}\n`, 'utf8')
  return readMemoryScope(kbRoot, scope)
}

/**
 * Remove one entry by id. The id is recomputed from the file's current lines,
 * so a hand-edited text invalidates the stale id — that surfaces as
 * `memory-entry-not-found` and the caller refreshes, never guesses.
 */
export async function removeMemoryEntry(kbRoot: string, scope: string, id: string): Promise<MemoryScope> {
  assertMemoryScope(scope)
  const target = memoryTarget(kbRoot, scope)
  const current = await readMemoryScope(kbRoot, scope)
  const index = current.entries.findIndex(entry => entry.id === id)
  if (index < 0) {
    throw new KbError('memory-entry-not-found', `作用域 ${scope} 里没有这条记忆（可能已被修改或删除）`)
  }
  const parsed = parseMemoryFile(scope, current.text)
  const file: MemoryFile = {
    preamble: parsed.preamble,
    entries: parsed.entries.filter((_, at) => at !== index),
  }
  await writeFile(target, `${serializeMemoryFile(file)}\n`, 'utf8')
  return readMemoryScope(kbRoot, scope)
}

/**
 * Apply the injection-time soft cap (ADR-0032 落地注记 3): the file order is
 * chronological (append-only), so staying under the cap means keeping the
 * NEWEST entries and counting the older ones out. Nothing is ever deleted —
 * the file keeps everything, only the injection shrinks.
 */
function cappedEntries(entries: readonly MemoryEntry[]): { kept: readonly MemoryEntry[]; omitted: number } {
  if (entries.length <= MEMORY_SCOPE_SOFT_CAP) return { kept: entries, omitted: 0 }
  return { kept: entries.slice(-MEMORY_SCOPE_SOFT_CAP), omitted: entries.length - MEMORY_SCOPE_SOFT_CAP }
}

/** The bullet lines of an entry list, exactly as the file writes them. */
function entryLines(entries: readonly MemoryEntry[]): string {
  return entries.map(entry => memoryEntryLine(entry)).join('\n')
}

/**
 * The global memory's system-prompt section text (ADR-0032 决定 4): the
 * behavior rules as bullets under a two-line header. Empty when nothing is
 * remembered — an empty section contributes nothing to the assembly.
 */
export function renderGlobalMemorySection(entries: readonly MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const { kept, omitted } = cappedEntries(entries)
  const head = '## 行为记忆\n以下是人在这个工作台上批准沉淀的行为规则（历次纠正的累积），执行任务时遵守：'
  const tail = omitted > 0 ? `\n（另有 ${omitted} 条较早的记忆未列出，全文见 .dsh/yantao/memory/global.md）` : ''
  return `${head}\n${entryLines(kept)}${tail}`
}

/**
 * The capability memory's run-context block (ADR-0032 决定 4): rides the
 * `memory` field of a capability run (the `kb_run_capability` tool render
 * appends it; the human channel's `capabilityRun` result carries it for the
 * client-driven flows). Empty when the capability has no remembered rules.
 */
export function renderCapabilityMemoryBlock(scope: string, entries: readonly MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const { kept, omitted } = cappedEntries(entries)
  const head = `【行为记忆】人在以往运行中为「${scope}」沉淀的规则（历次纠正的累积），本次运行遵守：`
  const tail = omitted > 0 ? `\n（另有 ${omitted} 条较早的记忆未列出）` : ''
  return `${head}\n${entryLines(kept)}${tail}`
}

/**
 * Synchronous read of the global memory for the system-prompt section
 * provider (ADR-0022 增补的动态 section): the registry evaluates section text
 * at each assembly, so the read is sync and every turn reflects the current
 * file — the human's latest edit is honored on the next step. A missing file
 * reads as no entries, and any other read failure degrades to no section
 * rather than breaking the whole assembly.
 */
export function readGlobalMemoryEntries(kbRoot: string): readonly MemoryEntry[] {
  let text = ''
  try {
    text = readFileSync(join(kbRoot, '.dsh', 'yantao', 'memory', 'global.md'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return []
  }
  return parseMemoryFile(MEMORY_GLOBAL_SCOPE, text).entries
}
