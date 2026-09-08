/**
 * The inline 「+ 新建」 row: a button that becomes a text input, Enter
 * submits, Escape cancels. Presentational — the caller owns what "create"
 * means for its tab (which entity kind, which tree to refresh).
 */
import { useState, type ReactElement } from 'react'

/** Inline creation row props. */
export interface NewEntityRowProps {
  /** The button's label. */
  readonly label: string
  /** Input placeholder while editing. */
  readonly placeholder?: string
  /** Create the entity; a rejection surfaces as the row's error. */
  readonly submit: (name: string) => Promise<void>
}

const rowStyle = { display: 'flex', gap: 4, margin: '4px 0' } as const

const errorStyle = { color: '#b4453a', padding: '0 6px' } as const

/**
 * Render the inline creation row.
 * @param props - see {@link NewEntityRowProps}.
 * @returns the row element.
 */
export function NewEntityRow({ label, placeholder = '名称', submit }: NewEntityRowProps): ReactElement {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Reset to the button after a submit or a cancel. */
  const close = (): void => {
    setEditing(false)
    setName('')
    setBusy(false)
  }

  return (
    <div>
      {!editing && (
        <button type="button" style={{ padding: '2px 6px' }} onClick={() => { setEditing(true) }} disabled={busy}>
          {label}
        </button>
      )}
      {editing && (
        <div style={rowStyle}>
          <input
            autoFocus
            value={name}
            placeholder={placeholder}
            disabled={busy}
            style={{ flex: 1, minWidth: 0 }}
            onChange={(event) => { setName(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setError(null)
                close()
                return
              }
              if (event.key !== 'Enter') return
              const trimmed = name.trim()
              if (trimmed === '') {
                setError(null)
                close()
                return
              }
              setBusy(true)
              submit(trimmed).then(
                () => {
                  setError(null)
                  close()
                },
                (failure: unknown) => {
                  setError(failure instanceof Error ? failure.message : String(failure))
                  setBusy(false)
                },
              )
            }}
          />
        </div>
      )}
      {error !== null && <div style={errorStyle}>{error}</div>}
    </div>
  )
}
