/**
 * The prompt-shortcut store (ADR-0040): the human's favorite slash aliases —
 * one `alias` (typed right after `/` in the composer, no whitespace) plus the
 * `text` it expands to when the agent sees it. The file lives at
 * `<kbRoot>/.dsh/yantao/prompt-shortcuts.json`; the UI is the only writer
 * (the human channel), the agent never writes here — its view of the list is
 * the injected prompt section, and its route to a change is asking the human.
 *
 * Expansion authority is agent-side by design (ADR-0040 决定 5): every entry
 * point (the `/` menu, the capability tab, hand typing) inserts only the
 * literal `/alias`, and the injected section teaches the agent to recognize
 * and expand it. The client ships no expansion logic at all.
 * @module @deepseek-ai/dsh-yantao-kb/prompt-shortcuts
 */

import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KbError } from './types.ts'

/** One saved favorite: the slash alias and the text it expands to. */
export interface PromptShortcut {
  /** The alias as typed after `/` — no whitespace, no slash, no leading dot. */
  readonly alias: string
  /** The expansion: a prompt fragment, or a `/skill args` invocation line. */
  readonly text: string
}

/** The store's on-disk shape. */
export interface PromptShortcutFile {
  readonly version: 1
  readonly shortcuts: readonly PromptShortcut[]
}

/** Where the store lives, relative to the KB root. */
export const PROMPT_SHORTCUTS_DISPLAY_PATH = '.dsh/yantao/prompt-shortcuts.json'

/** Injection soft cap: past this the section truncates (the file keeps all). */
export const PROMPT_SHORTCUTS_SOFT_CAP = 30

/** An alias is one slash token: the composer ends the token at whitespace or `/`. */
const ALIAS_PATTERN = /^[^\s/\\]+$/

/** Hard length caps — the alias is a token, the text is one prompt line's worth. */
const ALIAS_MAX = 32
const TEXT_MAX = 2000

/** Where the store sits on disk. */
function shortcutsTarget(kbRoot: string): string {
  return join(kbRoot, '.dsh', 'yantao', 'prompt-shortcuts.json')
}

/**
 * Validate one shortcut list in full: every alias is a single slash token of
 * bounded length, every text is non-empty and bounded, aliases unique. Shape
 * errors carry Chinese messages the UI shows verbatim.
 * @param shortcuts - the list as the caller wants it stored, order included.
 * @returns the same list, normalized (trimmed).
 */
export function normalizePromptShortcuts(shortcuts: readonly unknown[]): PromptShortcut[] {
  if (shortcuts.length > PROMPT_SHORTCUTS_SOFT_CAP) {
    throw new KbError('too-many-shortcuts', `惯用提示词最多 ${PROMPT_SHORTCUTS_SOFT_CAP} 条`)
  }
  const seen = new Set<string>()
  return shortcuts.map((item, at) => {
    if (typeof item !== 'object' || item === null) {
      throw new KbError('bad-shortcut', `第 ${at + 1} 条惯用项格式不对`)
    }
    const { alias, text } = item as { alias?: unknown; text?: unknown }
    if (typeof alias !== 'string' || alias.trim() === '') {
      throw new KbError('bad-shortcut-alias', `第 ${at + 1} 条惯用项的别名不能为空`)
    }
    const name = alias.trim()
    if (name.length > ALIAS_MAX || !ALIAS_PATTERN.test(name)) {
      throw new KbError('bad-shortcut-alias', `别名「${name}」不合法：别名是一段连续文字，不能含空格或斜杠`)
    }
    if (typeof text !== 'string' || text.trim() === '') {
      throw new KbError('bad-shortcut-text', `惯用项「${name}」的展开内容不能为空`)
    }
    const body = text.trim()
    if (body.length > TEXT_MAX) {
      throw new KbError('bad-shortcut-text', `惯用项「${name}」的展开内容过长（上限 ${TEXT_MAX} 字）`)
    }
    if (seen.has(name)) {
      throw new KbError('duplicate-shortcut', `别名「${name}」重复了`)
    }
    seen.add(name)
    return { alias: name, text: body }
  })
}

/**
 * Read the whole store. An absent file is an empty list (nothing saved yet);
 * a corrupt file is a loud error — the human's saved data must not be
 * silently discarded.
 * @param kbRoot - the live KB root.
 * @returns the shortcuts in stored order.
 */
export async function readPromptShortcuts(kbRoot: string): Promise<PromptShortcut[]> {
  let raw: string
  try {
    raw = await readFile(shortcutsTarget(kbRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return parsePromptShortcuts(raw)
}

/**
 * The synchronous twin of {@link readPromptShortcuts} — the system-prompt
 * section provider is sync-only (system-prompt/src/index.ts), so injection
 * reads through this. Same tolerance: absent file → empty, corrupt file →
 * the caller's catch.
 * @param kbRoot - the live KB root.
 * @returns the shortcuts in stored order.
 */
export function readPromptShortcutsSync(kbRoot: string): PromptShortcut[] {
  let raw: string
  try {
    raw = readFileSync(shortcutsTarget(kbRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return parsePromptShortcuts(raw)
}

/** Parse the store's text into a validated list; shared by both readers. */
function parsePromptShortcuts(raw: string): PromptShortcut[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new KbError('bad-shortcuts-file', `${PROMPT_SHORTCUTS_DISPLAY_PATH} 不是合法 JSON，请修复或删除后重试`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { shortcuts?: unknown }).shortcuts)) {
    throw new KbError('bad-shortcuts-file', `${PROMPT_SHORTCUTS_DISPLAY_PATH} 缺少 shortcuts 数组`)
  }
  return normalizePromptShortcuts((parsed as { shortcuts: readonly unknown[] }).shortcuts)
}

/**
 * Replace the whole store (the UI edits a small list, so full-list saves keep
 * reorder trivially correct). Validation runs before the write, so a rejected
 * save never touches the file.
 * @param kbRoot - the live KB root.
 * @param shortcuts - the complete new list, in display order.
 */
export async function writePromptShortcuts(kbRoot: string, shortcuts: readonly PromptShortcut[]): Promise<void> {
  const validated = normalizePromptShortcuts(shortcuts)
  const target = shortcutsTarget(kbRoot)
  const payload = JSON.stringify({ version: 1, shortcuts: validated } satisfies PromptShortcutFile, null, 2) + '\n'
  await writeFile(target, payload, 'utf8')
}

/**
 * The system-prompt section text (ADR-0040 决定 5): the alias table plus the
 * expansion contract. Empty when nothing is saved — an empty section
 * contributes nothing to the assembly. This is the expansion authority for
 * every entry point (menu pick, tab click, hand typing all ship the literal
 * `/alias`).
 * @param shortcuts - the store's current list, display order.
 * @returns the section text, `''` when the store is empty.
 */
export function renderPromptShortcutsSection(shortcuts: readonly PromptShortcut[]): string {
  if (shortcuts.length === 0) return ''
  const lines = shortcuts.map(shortcut => `- /${shortcut.alias} → ${shortcut.text}`).join('\n')
  return [
    '## 惯用提示词',
    '用户把常用指令存成了斜杠别名。用户消息以「/别名」开头（别名后可带参数）时，按下面这张表展开并执行；',
    '展开内容若是「/技能名 …」形态则按技能流程走，否则当作完整指令直接执行。',
    '本表只是用户收藏的习惯用语，不是可执行内容的完整清单：未命中本表的「/xxx」按字面当普通指令理解和回应，',
    '能处理就直接处理，不要仅因不在表中而拒绝或纠正用户，也不要猜测本表以外的别名。',
    '',
    lines,
  ].join('\n')
}
