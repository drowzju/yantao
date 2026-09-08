/**
 * The 待办 tab: the todo singleton rendered as an inline checklist. Toggling a
 * box or adding a row rewrites that one line through `write` — the file keeps
 * its frontmatter and every other line byte-for-byte — and 打开全文 hands the
 * same file to the centre pane's editor for anything bigger.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { FileReader, FileWriter } from './remote.ts'
import { remoteMessage } from './remote.ts'
import { appendTodo, parseTodos, toggleTodo } from './todo.ts'

/** Checklist props. */
export interface TodoListProps {
  /** KB-relative path of the todo singleton. */
  readonly path: string
  /** Read the file's content. */
  readonly read: FileReader
  /** Write the file's complete new content. */
  readonly write: FileWriter
  /** Open the whole file in an editable tab. */
  readonly onOpenFile: () => void
}

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 4 } as const

const errorStyle = { color: '#b4453a', padding: '4px 6px' } as const

const rowStyle = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  padding: '2px 6px',
  cursor: 'pointer',
} as const

const addRowStyle = { display: 'flex', gap: 4, marginTop: 4 } as const

/**
 * Render the todo singleton as an editable checklist.
 * @param props - see {@link TodoListProps}.
 * @returns the checklist element.
 */
export function TodoList({ path, read, write, onOpenFile }: TodoListProps): ReactElement {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const latest = useRef({ read, write })
  latest.current = { read, write }

  useEffect(() => {
    let stale = false
    setContent(null)
    setError(null)
    latest.current.read(path).then(
      (next) => { if (!stale) setContent(next) },
      (failure: unknown) => { if (!stale) setError(remoteMessage(failure)) },
    )
    return () => {
      stale = true
    }
  }, [path])

  /** Rewrite the file with `next`, adopting it only once the write lands. */
  const commit = (next: string): void => {
    setBusy(true)
    latest.current.write(path, next).then(
      () => {
        setContent(next)
        setError(null)
        setBusy(false)
      },
      (failure: unknown) => {
        setError(remoteMessage(failure))
        setBusy(false)
      },
    )
  }

  const items = content === null ? [] : parseTodos(content)

  return (
    <div style={wrapStyle}>
      {error !== null && <div style={errorStyle}>{error}</div>}
      {content === null && error === null && <div style={{ color: '#9a9488', padding: '4px 6px' }}>载入中…</div>}
      {items.map(item => (
        <div
          key={item.line}
          style={rowStyle}
          onClick={() => {
            if (content === null || busy) return
            commit(toggleTodo(content, item.line))
          }}
        >
          <span>{item.done ? '[x]' : '[ ]'}</span>
          <span style={item.done ? { color: '#9a9488', textDecoration: 'line-through' } : undefined}>{item.text}</span>
        </div>
      ))}
      <div style={addRowStyle}>
        <input
          value={text}
          placeholder="新待办"
          style={{ flex: 1, minWidth: 0 }}
          onChange={(event) => { setText(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setText(''); return }
            if (event.key !== 'Enter') return
            const name = text.trim()
            if (name === '' || content === null || busy) return
            const next = appendTodo(content, name)
            setText('')
            commit(next)
          }}
        />
      </div>
      <button type="button" style={{ alignSelf: 'flex-start', padding: '2px 6px' }} onClick={onOpenFile}>
        打开全文
      </button>
    </div>
  )
}
