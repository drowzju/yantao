/**
 * The 待办 tab: the todo singleton rendered as a two-pane board — TODO above,
 * DONE below (ADR-0018). It knows nothing of the `[due::…]` syntax: the host
 * parses and serializes the file, and the board sees only structured items
 * plus the exact `text` it must hand back as `expectedText` on every write.
 *
 * Editing is inline in the left rail — a row expands into a title input, a
 * date input, and a markdown body — so a todo is handled where it is read.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbTodoItem, KbWriteTodosArgs } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { TodoLoader, TodoWriter } from './remote.ts'
import { remoteMessage } from './remote.ts'

/** Board props. */
export interface TodoBoardProps {
  /** Read the singleton: its path, text, and items. */
  readonly load: TodoLoader
  /** Write the whole item list under optimistic concurrency. */
  readonly write: TodoWriter
  /** The frame's tree-generation counter: a bump reloads the board. */
  readonly refreshKey: number
  /** Open the singleton in an editable centre-pane tab. */
  readonly onOpenFile: (path: string) => void
}

/** What the board holds of the file: the items it renders and the text a write must match. */
interface Board {
  readonly path: string
  readonly text: string
  readonly items: readonly KbTodoItem[]
}

/** The three fields the inline editor edits. */
interface Draft {
  readonly title: string
  /** The deadline as the date input carries it; `''` means none. */
  readonly due: string
  readonly body: string
}

/** One item together with its index — the handle every edit addresses it by. */
interface Entry {
  readonly index: number
  readonly item: KbTodoItem
}

/** A new item before the human has typed its title. */
function blank(): KbTodoItem {
  return { done: false, title: '', body: '', extra: [] }
}

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 2 } as const

const errorStyle = { color: '#b4453a', padding: '4px 6px' } as const

const mutedStyle = { color: '#9a9488', padding: '4px 6px' } as const

const titleStyle = { margin: '8px 0 2px', fontSize: 12, fontWeight: 600, color: '#6b6455' } as const

const rowStyle = { display: 'flex', gap: 6, alignItems: 'center', padding: '2px 6px' } as const

const dueStyle = {
  fontSize: 11,
  color: '#6b6455',
  border: '1px solid #e6e2d8',
  borderRadius: 8,
  padding: '0 5px',
} as const

const overdueStyle = { ...dueStyle, color: '#b4453a', borderColor: '#e8c4bf' } as const

const doneTitleStyle = { color: '#9a9488', textDecoration: 'line-through', cursor: 'pointer', flex: 1, minWidth: 0 } as const

const titleButtonStyle = { cursor: 'pointer', flex: 1, minWidth: 0, textAlign: 'left' } as const

const editorStyle = { display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 6px 8px 26px' } as const

const fieldStyle = { width: '100%', boxSizing: 'border-box' } as const

const buttonStyle = { padding: '2px 6px' } as const

const addStyle = { ...buttonStyle, alignSelf: 'flex-start', marginTop: 2 } as const

/** Today as a YYYY-MM-DD stamp, in the human's own timezone. */
function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * One item's sort key: its deadline, or a stamp past every real date so an
 * item with no deadline sinks below the dated ones.
 * @param item - the item to rank.
 * @returns the key; plain string order is date order.
 */
function rank(item: KbTodoItem): string {
  return item.due ?? '9999-12-31'
}

/**
 * Split the file's items into the two panes.
 * @param items - the items in file order.
 * @returns the TODO entries sorted by deadline and the DONE ones in file order.
 */
function panes(items: readonly KbTodoItem[]): { todo: readonly Entry[]; done: readonly Entry[] } {
  const entries = items.map((item, index) => ({ item, index }))
  return {
    todo: entries.filter(entry => !entry.item.done).sort((a, b) => rank(a.item).localeCompare(rank(b.item))),
    done: entries.filter(entry => entry.item.done),
  }
}

/**
 * Check or uncheck one item: checking stamps today into `[done::…]`,
 * unchecking drops the stamp.
 * @param item - the item to flip.
 * @param done - the new checkbox state.
 * @returns the flipped item.
 */
function flipped(item: KbTodoItem, done: boolean): KbTodoItem {
  return {
    done,
    title: item.title,
    body: item.body,
    extra: item.extra,
    ...item.due !== undefined ? { due: item.due } : {},
    ...done ? { doneOn: today() } : {},
  }
}

/**
 * Apply the editor's draft to one item.
 * @param item - the item to patch.
 * @param draft - the edited title, deadline, and body.
 * @returns the patched item.
 */
function patched(item: KbTodoItem, draft: Draft): KbTodoItem {
  return {
    done: item.done,
    title: draft.title.trim(),
    body: draft.body,
    extra: item.extra,
    ...draft.due === '' ? {} : { due: draft.due },
    ...item.doneOn !== undefined ? { doneOn: item.doneOn } : {},
  }
}

/**
 * One collapsed row: a checkbox, the title, the deadline badge, and the
 * affordances that expand and drop it.
 * @param props - the row's item, its deadline state, and its actions.
 * @returns the row element.
 */
function TodoRow(props: {
  readonly entry: Entry
  readonly overdue: boolean
  readonly disabled: boolean
  readonly onToggle: () => void
  readonly onEdit: () => void
  readonly onRemove: () => void
}): ReactElement {
  const { item, index } = props.entry
  return (
    <div style={rowStyle} data-todo-row={index}>
      <input
        type="checkbox"
        checked={item.done}
        disabled={props.disabled}
        aria-label={item.title === '' ? '新待办' : item.title}
        onChange={props.onToggle}
      />
      <span
        style={item.done ? doneTitleStyle : titleButtonStyle}
        data-todo-title={index}
        onClick={props.onEdit}
      >
        {item.title === '' ? '（未命名）' : item.title}
      </span>
      {item.due !== undefined && (
        <span style={props.overdue ? overdueStyle : dueStyle} data-overdue={props.overdue || undefined}>
          {item.due}
        </span>
      )}
      <button type="button" style={buttonStyle} title="编辑" disabled={props.disabled} onClick={props.onEdit}>…</button>
      <button type="button" style={buttonStyle} title="删除" disabled={props.disabled} onClick={props.onRemove}>×</button>
    </div>
  )
}

/**
 * The inline editor one row expands into.
 * @param props - the draft and the actions around it.
 * @returns the editor element.
 */
function TodoEditor(props: {
  readonly draft: Draft
  readonly onDraft: (draft: Draft) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}): ReactElement {
  const { draft } = props
  return (
    <div style={editorStyle} data-todo-editor="true">
      <input
        autoFocus
        value={draft.title}
        placeholder="标题"
        aria-label="标题"
        style={fieldStyle}
        onChange={(event) => { props.onDraft({ ...draft, title: event.target.value }) }}
      />
      <input
        type="date"
        value={draft.due}
        aria-label="截止日期"
        style={fieldStyle}
        onChange={(event) => { props.onDraft({ ...draft, due: event.target.value }) }}
      />
      <textarea
        value={draft.body}
        placeholder="正文（markdown）"
        aria-label="正文"
        rows={3}
        style={fieldStyle}
        onChange={(event) => { props.onDraft({ ...draft, body: event.target.value }) }}
      />
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" style={buttonStyle} onClick={props.onSave}>保存</button>
        <button type="button" style={buttonStyle} onClick={props.onCancel}>取消</button>
      </div>
    </div>
  )
}

/**
 * Render the todo singleton as a TODO / DONE board.
 * @param props - see {@link TodoBoardProps}.
 * @returns the board element.
 */
export function TodoBoard({ load, write, refreshKey, onOpenFile }: TodoBoardProps): ReactElement {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  /** The index of an item added locally and not yet written; 取消 drops it. */
  const [adding, setAdding] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>({ title: '', due: '', body: '' })
  // Every loader is a fresh closure on each render (inject face), so the
  // effects and the write path reach them through a ref.
  const latest = useRef({ load, write })
  latest.current = { load, write }

  /**
   * Re-read the file.
   * @param keepError - leave the current error on screen when the read
   *   succeeds. A rejected write reloads to show what is really on disk, and
   *   that refresh must not read as "the write went through".
   */
  const reload = useCallback(async (keepError = false): Promise<void> => {
    try {
      const next = await latest.current.load()
      setBoard({ path: next.path, text: next.text, items: next.items })
      if (!keepError) setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])

  useEffect(() => { void reload() }, [reload, refreshKey])

  /**
   * Send the whole item list, carrying the `text` we last read. A rejection
   * means the file moved underneath us (or the item is invalid): show the
   * host's message and reload, so the board never renders a list the file
   * does not hold.
   * @param next - the item list to write.
   */
  const commit = (next: readonly KbTodoItem[]): void => {
    if (board === null) return
    setBusy(true)
    const args: KbWriteTodosArgs = { items: next, expectedText: board.text }
    latest.current.write(args).then(
      (result) => {
        setBoard({ path: result.path, text: result.text, items: next })
        setError(null)
        setBusy(false)
      },
      (failure: unknown) => {
        setError(remoteMessage(failure))
        setBusy(false)
        void reload(true)
      },
    )
  }

  /** Replace the item at `index` with `next` and write the list. */
  const replace = (index: number, next: KbTodoItem): void => {
    if (board === null) return
    commit(board.items.map((item, at) => (at === index ? next : item)))
  }

  /** Expand one row into the editor, seeded with what it holds. */
  const openEditor = (index: number): void => {
    const item = board?.items[index]
    if (item === undefined) return
    setEditing(index)
    setDraft({ title: item.title, due: item.due ?? '', body: item.body })
  }

  /** Append a blank item and open it; the host refuses it until it has a title. */
  const add = (): void => {
    if (board === null) return
    const index = board.items.length
    setBoard({ ...board, items: [...board.items, blank()] })
    setAdding(index)
    setEditing(index)
    setDraft({ title: '', due: '', body: '' })
  }

  /** Close the editor; a locally added item that was never given a title goes away. */
  const cancel = (): void => {
    setEditing(null)
    if (adding === null || board === null) return
    setBoard({ ...board, items: board.items.filter((_item, at) => at !== adding) })
    setAdding(null)
  }

  /** Write the draft into its item and close the editor. */
  const save = (): void => {
    if (board === null || editing === null) return
    const item = board.items[editing]
    if (item === undefined) return
    replace(editing, patched(item, draft))
    setEditing(null)
    setAdding(null)
  }

  const items = board?.items ?? []
  const { todo, done } = panes(items)
  const now = today()

  /** Render one pane's rows, or its editor where a row expanded. */
  const renderRow = (entry: Entry): ReactElement => (
    <div key={entry.item.done ? `done-${entry.index}` : `todo-${entry.index}`}>
      {editing !== entry.index && (
        <TodoRow
          entry={entry}
          overdue={!entry.item.done && entry.item.due !== undefined && entry.item.due < now}
          disabled={busy}
          onToggle={() => { replace(entry.index, flipped(entry.item, !entry.item.done)) }}
          onEdit={() => { openEditor(entry.index) }}
          onRemove={() => {
            if (board === null) return
            commit(board.items.filter((_item, at) => at !== entry.index))
          }}
        />
      )}
      {editing === entry.index && (
        <TodoEditor draft={draft} onDraft={setDraft} onSave={save} onCancel={cancel} />
      )}
    </div>
  )

  return (
    <div style={wrapStyle}>
      {error !== null && <div style={errorStyle}>{error}</div>}
      {board === null && error === null && <div style={mutedStyle}>载入中…</div>}
      {board !== null && (
        <>
          <div style={titleStyle} data-todo-block="todo">TODO</div>
          <div data-todo-pane="todo">
            {todo.length === 0 && <div style={mutedStyle}>（空）</div>}
            {todo.map(renderRow)}
          </div>
          <button type="button" style={addStyle} title="新增待办" disabled={busy} onClick={add}>+</button>
          <div style={titleStyle} data-todo-block="done">DONE</div>
          <div data-todo-pane="done">
            {done.length === 0 && <div style={mutedStyle}>（空）</div>}
            {done.map(renderRow)}
          </div>
          <button
            type="button"
            style={{ ...addStyle, marginTop: 6 }}
            onClick={() => { onOpenFile(board.path) }}
          >
            打开全文
          </button>
        </>
      )}
    </div>
  )
}
