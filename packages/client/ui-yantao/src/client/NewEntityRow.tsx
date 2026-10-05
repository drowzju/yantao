/**
 * The inline 「+ 新建」 row: a button that becomes a text input, Enter
 * submits, 取消 or Escape cancels. Presentational — the caller owns what
 * "create" means for its tab (which entity kind, which tree to refresh).
 */
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { WorkbenchT } from './locales.ts'

/** One option of the row's optional picker — the person's relation. */
export interface NewEntityChoice {
  /** The value `onChange` reports; the caller names what it means. */
  readonly value: string
  /** What the human reads. */
  readonly label: string
}

/** Inline creation row props. */
export interface NewEntityRowProps {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** The button's label. */
  readonly label: string
  /** Input placeholder while editing. */
  readonly placeholder: string
  /** Create the entity; a rejection surfaces as the row's error. */
  readonly submit: (name: string) => Promise<void>
  /**
   * A second thing to choose beside the name — the 人物 tab's relation. The
   * caller owns the value, so the row stays presentational.
   */
  readonly choice?: {
    readonly options: readonly NewEntityChoice[]
    readonly value: string
    readonly onChange: (value: string) => void
  } | undefined
  /**
   * An action riding immediately beside the 新建 button (or beside the edit
   * row) — the 校验 button (design.md: actions of one group hug each other,
   * they never split to opposite ends of the row).
   */
  readonly trailing?: ReactNode
}

const rowStyle = { display: 'flex', gap: 4, margin: '4px 0' } as const

// 错误行（2026-10-05 第三轮评审 P2#6）：正文字号 + role=alert，读屏必播报。
const errorStyle = { color: 'var(--yt-error)', padding: '0 6px', fontSize: 'var(--yt-type-body)' } as const

/**
 * Render the inline creation row.
 * @param props - see {@link NewEntityRowProps}.
 * @returns the row element.
 */
export function NewEntityRow({ t, label, placeholder, submit, choice, trailing }: NewEntityRowProps): ReactElement {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Reset to the button after a submit or a cancel. */
  const close = useCallback((): void => {
    setEditing(false)
    setName('')
    setBusy(false)
    setError(null)
  }, [])

  // Escape cancels even when the input no longer holds the focus — the row
  // must never trap the human in edit mode with no way back. (The input's own
  // handler below answers Enter; this listener is the one that answers Escape,
  // wherever the focus has gone.)
  useEffect(() => {
    if (!editing || busy) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [editing, busy, close])

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
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
                if (event.key !== 'Enter') return
                const trimmed = name.trim()
                if (trimmed === '') {
                  close()
                  return
                }
                setBusy(true)
                submit(trimmed).then(
                  () => {
                    close()
                  },
                  (failure: unknown) => {
                    setError(failure instanceof Error ? failure.message : String(failure))
                    setBusy(false)
                  },
                )
              }}
            />
            {choice !== undefined && (
              <select
                aria-label={t('relation.label')}
                value={choice.value}
                disabled={busy}
                onChange={(event) => { choice.onChange(event.target.value) }}
              >
                {choice.options.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
            <button type="button" style={{ padding: '2px 6px' }} disabled={busy} onClick={close}>{t('common.cancel')}</button>
          </div>
        )}
        {error !== null && <div style={errorStyle} role="alert">{error}</div>}
      </div>
      {trailing}
    </div>
  )
}
