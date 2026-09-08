/**
 * The 待办 singleton (`entities/todos.md`) as an Obsidian checkbox list.
 * Pure string editing: every rewrite touches exactly one line — or appends
 * one — so the rest of the file (frontmatter included) survives byte-for-byte.
 * @module @deepseek-ai/dsh-client-ui-yantao/todo
 */

/** One checklist row, remembering the file line it came from. */
export interface TodoItem {
  /** Line index in the file — the handle every edit addresses it by. */
  readonly line: number
  /** Whether the box is checked. */
  readonly done: boolean
  /** Row text after the checkbox. */
  readonly text: string
}

/** `- [ ] text` / `- [x] text`, tolerating leading spaces and either case of x. */
const ROW = /^(\s*)- \[([ xX])\]\s?(.*)$/

/**
 * Parse the todo file into its checklist rows.
 * @param content - the file's complete content.
 * @returns one item per checkbox line, in file order.
 */
export function parseTodos(content: string): readonly TodoItem[] {
  const items: TodoItem[] = []
  content.split('\n').forEach((text, line) => {
    const match = ROW.exec(text)
    if (match === null) return
    items.push({ line, done: match[2] !== ' ', text: match[3] ?? '' })
  })
  return items
}

/**
 * Flip one row's checkbox, rewriting only that line.
 * @param content - the file's complete content.
 * @param line - line index of the row (from {@link parseTodos}).
 * @returns the new content, or the same content when the line is not a row.
 */
export function toggleTodo(content: string, line: number): string {
  const lines = content.split('\n')
  const target = lines[line]
  if (target === undefined) return content
  const match = ROW.exec(target)
  if (match === null) return content
  const text = match[3] ?? ''
  lines[line] = `${match[1]}- [${match[2] === ' ' ? 'x' : ' '}]${text === '' ? '' : ` ${text}`}`
  return lines.join('\n')
}

/**
 * Append one unchecked row.
 * @param content - the file's complete content.
 * @param text - the row's text (the checkbox is added).
 * @returns the new content with the row appended.
 */
export function appendTodo(content: string, text: string): string {
  const row = `- [ ] ${text}`
  if (content === '') return `${row}\n`
  return content.endsWith('\n') ? `${content}${row}\n` : `${content}\n${row}\n`
}
