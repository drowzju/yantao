/**
 * The behavior-memory management view (ADR-0032 批次③): every scope's rules
 * laid out — 全局 first, then the capability scopes — each entry deletable,
 * with a direct add row. The human is the author here, so the write needs no
 * proposal card: the UI is the human channel (hard rule 2), and `memoryAdd` /
 * `memoryDelete` are human-only surfaces anyway — the agent has no route into
 * them except a proposal the human approves.
 *
 * A refused add that is the host's exact-duplicate answer reads as 已记得,
 * not an error; a failed delete (a stale id — the file was edited by hand
 * meanwhile) refreshes the list rather than guessing.
 * @module @deepseek-ai/dsh-client-ui-yantao/MemoryPanel
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbMemoryGroup } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { isDuplicateMemory, remoteMessage, type MemoryAdder, type MemoryDeleter, type MemoryLister } from './remote.ts'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'

/** What the panel needs: the three memory RPCs, already bound to the context. */
export interface MemoryPanelProps {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** List the scopes and their entries. */
  readonly list: MemoryLister
  /** Remember one rule in a scope. */
  readonly add: MemoryAdder
  /** Forget one rule by id. */
  readonly remove: MemoryDeleter
}

/** The two scopes with their own names; a capability scope shows as its name. */
const SCOPE_KEYS: Record<string, WorkbenchLocaleKey> = {
  global: 'memory.scope.global',
  mail: 'memory.scope.mail',
}

/** The scopes the add row always offers, in order. */
const ADD_SCOPES: readonly string[] = ['global', 'mail']

/** One scope's display name: the translated one when it has one, else its name. */
function scopeLabel(t: WorkbenchT, scope: string): string {
  const key = SCOPE_KEYS[scope]
  return key === undefined ? scope : t(key)
}

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 6px' } as const

const mutedStyle = { color: 'var(--yt-text-muted)', fontSize: 12 } as const

const errorStyle = { color: 'var(--yt-error)', fontSize: 12 } as const

const hintStyle = { color: 'var(--yt-text-secondary)', fontSize: 12 } as const

const groupTitleStyle = { margin: '8px 0 2px', fontSize: 'var(--yt-type-label)', fontWeight: 600, color: 'var(--yt-text-secondary)' } as const

const rowStyle = { display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0, padding: '2px 0' } as const

const textStyle = { minWidth: 0 } as const

const deleteStyle = { flexShrink: 0, padding: '1px 6px', fontSize: 12 } as const

const formStyle = { display: 'flex', gap: 4, alignItems: 'center', marginTop: 6 } as const

const inputStyle = { flex: 1, minWidth: 0, padding: '3px 6px' } as const

const buttonStyle = { padding: '3px 8px', flexShrink: 0 } as const

/**
 * Render the 记忆 tab (ADR-0032 批次③): the memory management view.
 * @param props - see {@link MemoryPanelProps}.
 * @returns the panel element.
 */
export function MemoryPanel({ t, list, add, remove }: MemoryPanelProps): ReactElement {
  // Every seam is a fresh closure on each render (inject face), so the load
  // and the writes read them through a ref — the same discipline useRail uses.
  const latest = useRef({ list, add, remove })
  latest.current = { list, add, remove }

  const [groups, setGroups] = useState<readonly KbMemoryGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState('global')
  const [text, setText] = useState('')

  /** Re-read every scope; a failure is the panel's error line, not a crash. */
  const reload = useCallback(async (): Promise<void> => {
    try {
      const result = await latest.current.list()
      setGroups(result.groups)
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  /** Add one rule; the duplicate refusal is the 已记得 notice, not an error. */
  const remember = async (): Promise<void> => {
    const trimmed = text.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    try {
      await latest.current.add(scope, trimmed)
      setText('')
      setNotice(t('memory.added'))
      await reload()
    } catch (failure: unknown) {
      if (isDuplicateMemory(failure)) {
        setNotice(t('memory.known'))
      } else {
        setNotice(null)
        setError(remoteMessage(failure))
      }
    } finally {
      setBusy(false)
    }
  }

  /** Forget one rule; a stale id (hand-edited file) refreshes instead of guessing. */
  const forget = async (target: KbMemoryGroup, id: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    let failureMessage: string | null = null
    try {
      await latest.current.remove(target.scope, id)
      setError(null)
    } catch (failure: unknown) {
      // Kept aside and re-set after the reload: reload clears the error line,
      // and the human must still see why the row disappeared.
      failureMessage = remoteMessage(failure)
    } finally {
      setBusy(false)
      await reload()
      if (failureMessage !== null) setError(failureMessage)
    }
  }

  // The add row offers the two named scopes plus every capability scope the
  // listing knows — a scope the human created by hand is a scope like any other.
  const scopeOptions = [...ADD_SCOPES, ...(groups ?? []).map(group => group.scope)]
  const seen = new Set<string>()

  return (
    <div style={wrapStyle} data-memory-panel="true">
      <div style={mutedStyle}>{t('memory.description')}</div>
      <div style={formStyle} data-memory-add="true">
        <select
          style={buttonStyle}
          aria-label="scope"
          value={scope}
          disabled={busy}
          onChange={(event) => { setScope(event.target.value) }}
        >
          {scopeOptions.map((option) => {
            if (seen.has(option)) return null
            seen.add(option)
            return <option key={option} value={option}>{scopeLabel(t, option)}</option>
          })}
        </select>
        <input
          style={inputStyle}
          value={text}
          placeholder={t('memory.addPlaceholder')}
          disabled={busy}
          onChange={(event) => { setText(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { void remember() }
          }}
        />
        <button type="button" style={buttonStyle} disabled={busy || text.trim() === ''} onClick={() => { void remember() }}>
          {t('memory.addButton')}
        </button>
      </div>
      {notice !== null && <div style={hintStyle} data-memory-notice="true">{notice}</div>}
      {error !== null && <div style={errorStyle} data-memory-error="true">{error}</div>}
      {groups === null && error === null && <div style={mutedStyle}>{t('memory.loading')}</div>}
      {groups !== null && groups.length === 0 && <div style={mutedStyle} data-memory-empty="true">{t('memory.empty')}</div>}
      {groups?.map(group => (
        <div key={group.scope} data-memory-group={group.scope}>
          <div style={groupTitleStyle}>{scopeLabel(t, group.scope)}</div>
          {group.entries.map(entry => (
            <div key={entry.id} style={rowStyle} data-memory-entry={entry.id}>
              <div style={textStyle}>
                {entry.text}
                {entry.date !== undefined && <span style={mutedStyle}>{` · ${entry.date}`}</span>}
              </div>
              <button
                type="button"
                style={deleteStyle}
                disabled={busy}
                title={t('workbench.delete')}
                data-memory-delete={entry.id}
                onClick={() => { void forget(group, entry.id) }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
