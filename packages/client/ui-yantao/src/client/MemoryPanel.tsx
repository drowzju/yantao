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
 *
 * Above the management view sits the 待批准 zone (ADR-0044 决定 7): every
 * in-flight proposal the agent's `kb_propose_memory` queued, with its source
 * annotation for the human's judgement. Approving promotes the bare text —
 * re-judging the target scope is allowed, defaulting to the proposal's own —
 * and discarding drops the line; both drain the queue through the human
 * channel's RPCs, the same seam the conversation card uses.
 * @module @deepseek-ai/dsh-client-ui-yantao/MemoryPanel
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbMemoryGroup, KbMemoryProposal, KbMemoryProposalGroup } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import {
  isDuplicateMemory, remoteMessage,
  type MemoryAdder, type MemoryDeleter, type MemoryLister,
  type MemoryProposalApprover, type MemoryProposalDiscarder, type MemoryProposalLister,
} from './remote.ts'
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
  /** List the in-flight proposals (ADR-0044 决定 7) — the 待批准 zone's read. */
  readonly listProposals: MemoryProposalLister
  /** Promote one pending proposal, optionally to a re-judged scope. */
  readonly approveProposal: MemoryProposalApprover
  /** Drop one pending proposal without promoting it. */
  readonly discardProposal: MemoryProposalDiscarder
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

/** The 待批准 zone's heading, one step above the scope titles. */
const zoneTitleStyle = {
  margin: '8px 0 2px', fontSize: 'var(--yt-type-section)', fontWeight: 600, color: 'var(--yt-text-primary)',
} as const

/** Raised rows: the queue is the one zone that asks for a verdict. */
const proposalRowStyle = {
  display: 'flex', gap: 6, alignItems: 'flex-start', minWidth: 0, padding: '6px 8px', marginTop: 4,
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const proposalMetaStyle = { color: 'var(--yt-text-secondary)', fontSize: 12, marginTop: 2 } as const

const verdictStyle = { flexShrink: 0, padding: '1px 6px', fontSize: 12 } as const

/**
 * One pending proposal row (ADR-0044 决定 7): the distilled text with its
 * source annotation, and the two verdicts. The target scope starts at the
 * proposal's own; the human may re-judge it before approving.
 */
function ProposalRow(props: {
  readonly t: WorkbenchT
  readonly group: KbMemoryProposalGroup
  readonly entry: KbMemoryProposal
  readonly scopeOptions: readonly string[]
  readonly busy: boolean
  readonly onApprove: (scope: string, text: string, targetScope: string) => void
  readonly onDiscard: (scope: string, text: string) => void
}): ReactElement {
  const { t, group, entry, scopeOptions, busy } = props
  const [target, setTarget] = useState(group.scope)
  const meta = [
    `${t('memory.proposal.scopeLabel')}：${scopeLabel(t, group.scope)}`,
    ...(entry.source !== '' ? [`${t('memory.proposal.sourceLabel')}：${entry.source}`] : []),
    ...(entry.date !== undefined ? [entry.date] : []),
  ].join(' · ')
  return (
    <div style={proposalRowStyle} data-memory-proposal={entry.id} data-memory-proposal-scope={group.scope}>
      <div style={textStyle}>
        {entry.text}
        <div style={proposalMetaStyle}>{meta}</div>
      </div>
      <select
        style={verdictStyle}
        aria-label={t('memory.proposalZone.targetScope')}
        value={target}
        disabled={busy}
        onChange={(event) => { setTarget(event.target.value) }}
      >
        {scopeOptions.map(option => <option key={option} value={option}>{scopeLabel(t, option)}</option>)}
      </select>
      <button
        type="button"
        style={verdictStyle}
        disabled={busy}
        data-memory-proposal-approve={entry.id}
        onClick={() => { props.onApprove(group.scope, entry.text, target) }}
      >
        {t('memory.proposal.approve')}
      </button>
      <button
        type="button"
        style={verdictStyle}
        disabled={busy}
        data-memory-proposal-discard={entry.id}
        onClick={() => { props.onDiscard(group.scope, entry.text) }}
      >
        {t('memory.proposal.discard')}
      </button>
    </div>
  )
}

/**
 * Render the 记忆 tab (ADR-0032 批次③): the memory management view.
 * @param props - see {@link MemoryPanelProps}.
 * @returns the panel element.
 */
export function MemoryPanel({ t, list, add, remove, listProposals, approveProposal, discardProposal }: MemoryPanelProps): ReactElement {
  // Every seam is a fresh closure on each render (inject face), so the load
  // and the writes read them through a ref — the same discipline useRail uses.
  const latest = useRef({ list, add, remove, listProposals, approveProposal, discardProposal })
  latest.current = { list, add, remove, listProposals, approveProposal, discardProposal }

  const [groups, setGroups] = useState<readonly KbMemoryGroup[] | null>(null)
  const [proposals, setProposals] = useState<readonly KbMemoryProposalGroup[] | null>(null)
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

  /** Re-read the proposal queues (ADR-0044 决定 7); same error line. */
  const reloadProposals = useCallback(async (): Promise<void> => {
    try {
      const result = await latest.current.listProposals()
      setProposals(result.groups)
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await reload()
      await reloadProposals()
    })()
  }, [reload, reloadProposals])

  /** Promote one proposal; a re-judged target scope overrides the source. */
  const promote = async (scope: string, text: string, targetScope: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    let failureMessage: string | null = null
    try {
      await latest.current.approveProposal(scope, text, targetScope)
      setNotice(t('memory.proposal.approved'))
    } catch (failure: unknown) {
      // The queue's duplicate refusal means the memory already holds the
      // rule — the proposal itself is now redundant, and the reload makes
      // that visible; the human discards what remains.
      if (isDuplicateMemory(failure)) {
        setNotice(t('memory.known'))
      } else {
        setNotice(null)
        failureMessage = remoteMessage(failure)
      }
    } finally {
      setBusy(false)
      await reload()
      await reloadProposals()
      if (failureMessage !== null) setError(failureMessage)
    }
  }

  /** Drop one proposal; the queue shrinks and nothing is remembered. */
  const drop = async (scope: string, text: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    let failureMessage: string | null = null
    try {
      await latest.current.discardProposal(scope, text)
      setNotice(t('memory.proposal.discarded'))
    } catch (failure: unknown) {
      setNotice(null)
      failureMessage = remoteMessage(failure)
    } finally {
      setBusy(false)
      await reload()
      await reloadProposals()
      if (failureMessage !== null) setError(failureMessage)
    }
  }

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

  // The 待批准 zone flattens the queue groups to rows; its target-scope
  // selects offer the same universe the add row does, plus every scope a
  // proposal itself names.
  const pending = (proposals ?? []).flatMap(group => group.entries.map(entry => ({ group, entry })))
  const zoneScopes: string[] = []
  for (const candidate of [...scopeOptions, ...(proposals ?? []).map(group => group.scope)]) {
    if (!zoneScopes.includes(candidate)) zoneScopes.push(candidate)
  }

  return (
    <div style={wrapStyle} data-memory-panel="true">
      <div style={mutedStyle}>{t('memory.description')}</div>
      {pending.length > 0 && (
        <div data-memory-proposals="true">
          <div style={zoneTitleStyle}>{t('memory.proposalZone.title')}</div>
          <div style={mutedStyle}>{t('memory.proposal.pending')}</div>
          {pending.map(({ group, entry }) => (
            <ProposalRow
              key={`${group.scope}|${entry.id}`}
              t={t}
              group={group}
              entry={entry}
              scopeOptions={zoneScopes}
              busy={busy}
              onApprove={(rowScope, rowText, target) => { void promote(rowScope, rowText, target) }}
              onDiscard={(rowScope, rowText) => { void drop(rowScope, rowText) }}
            />
          ))}
        </div>
      )}
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
