/**
 * The structured format of the 待办 singleton (`entities/todos.md`) and the
 * only implementation of it: an item line is a checkbox, then `[key::value]`
 * fields, then the title, and every following line indented by exactly two
 * spaces is markdown body. The host owns this parser because the client
 * cannot import host values (bundle purity), so the UI reaches it through
 * the yantaoKb Remote.
 *
 * Round trips are content-preserving rather than byte-preserving: a blank
 * line ends an item, so blank separators between items are dropped, and a
 * body that spans a blank line is re-emitted with a two-space blank line.
 * A canonical file — items with no blank line between them — is unchanged
 * by `serializeTodoFile(parseTodoFile(text))`.
 * @module @deepseek-ai/dsh-yantao-kb/todo
 */

import { KbError } from './types.ts'

/** One item of the todo singleton. */
export interface TodoItem {
  /** Whether the box is checked. */
  readonly done: boolean
  /** The item's title: the line's text after the checkbox and the fields. */
  readonly title: string
  /** Deadline (YYYY-MM-DD). */
  readonly due?: string
  /** Completion date (YYYY-MM-DD); set by {@link toggleTodo}, cleared when an item is unchecked. */
  readonly doneOn?: string
  /** Markdown body carried by the two-space-indented lines below the item; no trailing newline. */
  readonly body: string
  /** Unknown `[key::value]` tokens, kept as written so a round trip loses nothing. */
  readonly extra: readonly string[]
}

/** The parsed singleton file: a verbatim preamble plus the items in file order. */
export interface TodoFile {
  /** Everything before the first item line, verbatim — frontmatter and any heading. */
  readonly preamble: string
  /** The checklist items, in file order. */
  readonly items: readonly TodoItem[]
}

/** What {@link addTodo} needs for a new item: a title, and optionally a deadline and body. */
export interface TodoDraft {
  /** The item's title. */
  readonly title: string
  /** Deadline (YYYY-MM-DD); omit for none. */
  readonly due?: string
  /** Markdown body; omit for none. */
  readonly body?: string
}

/** What {@link updateTodo} may change; a field left `undefined` keeps its value and `''` clears the date. */
export interface TodoPatch {
  /** The new title. */
  readonly title?: string
  /** The new deadline (YYYY-MM-DD); `''` clears it. */
  readonly due?: string
  /** The new markdown body. */
  readonly body?: string
}

/** `- [ ] …` / `- [x] …` at the very start of a line; uppercase `X` is accepted too. */
const ITEM_LINE = /^- \[([ xX])\](.*)$/

/** One `[key::value]` token at the head of the line's remainder. */
const FIELD = /^\s*\[([^:\]\s]+)::([^\]]*)\]/

/** A date stamp, the only spelling `due` and `done` accept. */
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The indent that marks a body line. */
const BODY_INDENT = '  '

/**
 * Reject anything that is not a YYYY-MM-DD date stamp. Every path that can
 * put a date into the file runs through here, so a mistyped date is a hard
 * error instead of silent corruption of the format.
 * @param value - the date to check.
 * @param label - the field's Chinese name, used in the error message.
 * @returns the date, unchanged.
 */
function assertDate(value: string, label: string): string {
  if (!DATE.test(value)) {
    throw new KbError('invalid-todo-date', `待办${label}必须是 YYYY-MM-DD 格式的日期：${value}`)
  }
  return value
}

/**
 * The same check for a field the caller may leave out: an absent or empty
 * value means "no date" and is not an error.
 * @param value - the date to check, or undefined/empty for none.
 * @param label - the field's Chinese name, used in the error message.
 * @returns the date, or undefined when there is none.
 */
function optionalDate(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === '') return undefined
  return assertDate(value, label)
}

/** One item line, without its body: `- [ ] [due::…] [done::…] [unknown::…] 标题`. */
function renderItemLine(item: TodoItem): string {
  if (item.due !== undefined) assertDate(item.due, '截止日期')
  if (item.doneOn !== undefined) assertDate(item.doneOn, '完成日期')
  const fields = [
    ...item.due !== undefined ? [`[due::${item.due}]`] : [],
    ...item.doneOn !== undefined ? [`[done::${item.doneOn}]`] : [],
    ...item.extra,
  ]
  const head = `- [${item.done ? 'x' : ' '}]${fields.map(field => ` ${field}`).join('')}`
  return item.title === '' ? head : `${head} ${item.title}`
}

/**
 * Read one item line's fields: known keys land on their own slot and any
 * other token is kept verbatim in `extra`, in the order it was written.
 * @param row - the item line.
 * @returns the item's checkbox state, dates, extra tokens, and title.
 */
function parseItemLine(row: string): Omit<TodoItem, 'body'> {
  const match = ITEM_LINE.exec(row) as RegExpExecArray
  const done = (match[1] as string) !== ' '
  const extra: string[] = []
  let rest = match[2] as string
  let due: string | undefined
  let doneOn: string | undefined
  for (let field = FIELD.exec(rest); field !== null; field = FIELD.exec(rest)) {
    const token = field[0]
    rest = rest.slice(token.length)
    const key = field[1] as string
    const value = (field[2] as string).trim()
    if (key === 'due') due = optionalDate(value, '截止日期')
    else if (key === 'done') doneOn = optionalDate(value, '完成日期')
    else extra.push(token.trim())
  }
  return { done, title: rest.trim(), ...due !== undefined ? { due } : {}, ...doneOn !== undefined ? { doneOn } : {}, extra }
}

/**
 * Parse the todo file into its preamble and items.
 *
 * The preamble is everything before the first item line and survives
 * verbatim; after each item, every line up to the next item line belongs to
 * it (the two-space indent is stripped, and a line without one is a
 * human-written continuation folded into the same body). Trailing blank
 * lines of that block are dropped, so a blank separator between two items
 * disappears instead of being carried as an empty body line. Trailing CRs
 * are stripped, so a CRLF file parses like an LF one.
 * @param text - the file's complete content.
 * @returns the parsed file.
 */
export function parseTodoFile(text: string): TodoFile {
  const rows = text.split('\n').map(row => (row.endsWith('\r') ? row.slice(0, -1) : row))
  const first = rows.findIndex(row => ITEM_LINE.test(row))
  if (first === -1) return { preamble: rows.join('\n'), items: [] }
  const items: TodoItem[] = []
  let index = first
  while (index < rows.length) {
    const row = rows[index] as string
    if (!ITEM_LINE.test(row)) {
      index += 1
      continue
    }
    index += 1
    const block: string[] = []
    while (index < rows.length && !ITEM_LINE.test(rows[index] as string)) {
      block.push(rows[index] as string)
      index += 1
    }
    while (block.length > 0 && (block[block.length - 1] as string).trim() === '') block.pop()
    const body = block
      .map(line => (line.startsWith(BODY_INDENT) ? line.slice(BODY_INDENT.length) : line))
      .join('\n')
    items.push({ ...parseItemLine(row), body })
  }
  return { preamble: rows.slice(0, first).join('\n'), items }
}

/**
 * Render a todo file back to text. The preamble is emitted verbatim and
 * every item is its line plus its body re-indented two spaces; the file ends
 * with a newline whenever it holds at least one item, which is what makes
 * the round trip on a canonical file exact.
 * @param file - the file to render.
 * @returns the complete file content.
 */
export function serializeTodoFile(file: TodoFile): string {
  const rows = file.preamble === '' ? [] : file.preamble.split('\n')
  for (const item of file.items) {
    rows.push(renderItemLine(item))
    if (item.body === '') continue
    for (const line of item.body.split('\n')) rows.push(`${BODY_INDENT}${line}`)
  }
  if (rows.length === 0) return ''
  const text = rows.join('\n')
  return file.items.length === 0 ? text : `${text}\n`
}

/**
 * The item an index addresses.
 * @param file - the file to read.
 * @param index - the item's index in {@link TodoFile.items}.
 * @returns the item.
 */
function itemAt(file: TodoFile, index: number): TodoItem {
  const item = file.items[index]
  if (!Number.isInteger(index) || item === undefined) {
    throw new KbError('todo-index-out-of-range', `待办序号越界：${index}（共 ${file.items.length} 条待办）`)
  }
  return item
}

/**
 * Append one unchecked item at the end of the list.
 * @param file - the file to append to (left unchanged).
 * @param draft - the new item's title, and optionally its deadline and body.
 * @returns a new file carrying the appended item.
 */
export function addTodo(file: TodoFile, draft: TodoDraft): TodoFile {
  const title = draft.title.trim()
  if (title === '') throw new KbError('empty-todo-title', '待办标题不能为空')
  const due = optionalDate(draft.due, '截止日期')
  return {
    ...file,
    items: [...file.items, {
      done: false,
      title,
      body: draft.body ?? '',
      extra: [],
      ...due !== undefined ? { due } : {},
    }],
  }
}

/**
 * Patch one item's title, deadline, and body; its checkbox state and
 * completion date are {@link toggleTodo}'s business and stay as they are.
 * @param file - the file to patch (left unchanged).
 * @param index - the item's index in {@link TodoFile.items}.
 * @param patch - the fields to change; `due: ''` clears the deadline.
 * @returns a new file with the item patched.
 */
export function updateTodo(file: TodoFile, index: number, patch: TodoPatch): TodoFile {
  const current = itemAt(file, index)
  const due = patch.due === undefined ? current.due : optionalDate(patch.due, '截止日期')
  const next: TodoItem = {
    done: current.done,
    title: patch.title === undefined ? current.title : patch.title.trim(),
    body: patch.body ?? current.body,
    extra: current.extra,
    ...due !== undefined ? { due } : {},
    ...current.doneOn !== undefined ? { doneOn: current.doneOn } : {},
  }
  const items = [...file.items]
  items[index] = next
  return { ...file, items }
}

/**
 * Drop one item, body and all.
 * @param file - the file to edit (left unchanged).
 * @param index - the item's index in {@link TodoFile.items}.
 * @returns a new file without that item.
 */
export function removeTodo(file: TodoFile, index: number): TodoFile {
  itemAt(file, index)
  return { ...file, items: file.items.filter((_item, at) => at !== index) }
}

/**
 * Check or uncheck one item: checking stamps today's date into `[done::…]`,
 * unchecking removes the stamp, so the DONE panel can show when a thing was
 * finished.
 * @param file - the file to edit (left unchanged).
 * @param index - the item's index in {@link TodoFile.items}.
 * @param done - the new checkbox state.
 * @param today - the completion date to stamp (YYYY-MM-DD).
 * @returns a new file with the item toggled.
 */
export function toggleTodo(file: TodoFile, index: number, done: boolean, today: string): TodoFile {
  const current = itemAt(file, index)
  const next: TodoItem = {
    done,
    title: current.title,
    body: current.body,
    extra: current.extra,
    ...current.due !== undefined ? { due: current.due } : {},
    ...done ? { doneOn: assertDate(today, '完成日期') } : {},
  }
  const items = [...file.items]
  items[index] = next
  return { ...file, items }
}
