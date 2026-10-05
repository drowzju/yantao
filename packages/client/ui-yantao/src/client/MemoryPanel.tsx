/**
 * The behavior-memory management view (ADR-0032 批次③): every scope's rules
 * laid out — 全局 first, then the capability scopes — each entry deletable,
 * the add form collapsed behind a 新增记忆 button until it's needed. The
 * human is the author here, so the write needs no
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
 * annotation for the human's judgement. A proposal arrives already scoped by
 * the capability whose run produced it, so the card offers no scope picker —
 * approving promotes the bare text to the proposal's own scope, discarding
 * drops the line; both drain the queue through the human channel's RPCs, the
 * same seam the conversation card uses. Scope picking belongs to the add row
 * below, where the human is the author.
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
import { ghostButtonStyle, primaryButtonStyle } from './buttons.ts'

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

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 8px' } as const

const mutedStyle = { color: 'var(--yt-text-muted)', fontSize: 12 } as const

const errorStyle = { color: 'var(--yt-error)', fontSize: 12 } as const

const hintStyle = { color: 'var(--yt-text-secondary)', fontSize: 12 } as const

const groupTitleStyle = { margin: '8px 0 0', fontSize: 'var(--yt-type-label)', fontWeight: 600, color: 'var(--yt-text-secondary)' } as const

/** One entry row: the action pins to the first line (a baseline-aligned
 *  button sinks to mid-block beside multi-line text), and sibling spacing is
 *  each row's own marginTop — one owner per gap (design.md §4). */
const rowStyle = { display: 'flex', gap: 8, alignItems: 'flex-start', minWidth: 0 } as const

const textStyle = { minWidth: 0 } as const

/** The date on a line of its own — timestamps are the muted token's canonical 从属证据 (design.md §2.2). */
const dateStyle = { color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)', marginTop: 4 } as const

/** A per-row destructive action wears the ghost cut: no border, muted ink (design.md §7). */
const deleteStyle = {
  flexShrink: 0, padding: '0 4px', border: 'none', background: 'transparent',
  color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)', cursor: 'pointer',
} as const

/** The delete ✕ once armed: danger text on the raised surface, so the
 * second click's consequence is visible before it lands. */
const armedDeleteStyle = {
  ...deleteStyle,
  color: 'var(--yt-error)',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-strong)',
  borderRadius: 3,
  padding: '0 6px',
  whiteSpace: 'nowrap',
} as const

const buttonStyle = { padding: '4px 8px', flexShrink: 0 } as const

/** The collapsed creation affordance: one quiet button (design.md §7 —
 *  a low-frequency creation entry does not earn a resident form row). */
const addOpenStyle = { ...buttonStyle, alignSelf: 'flex-start' } as const

/** The expanded editing form: a raised card, its controls stacked so the
 *  input spans the rail's full width. */
const addFormStyle = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '8px',
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

/** The scope picker keeps its natural width inside the roomy card. */
const addScopeStyle = { padding: '4px 8px', alignSelf: 'flex-start', maxWidth: '100%' } as const

const inputStyle = { padding: '4px 8px', width: '100%', boxSizing: 'border-box' } as const

/** The form's verdict row: 保存 primary, 取消 ghost — both faces from
    ./buttons.ts (the shared cuts, 2026-10-05). */
const addActionsStyle = { display: 'flex', gap: 8 } as const

/** The 待批准 zone's heading, one step above the scope titles. */
const zoneTitleStyle = {
  margin: '8px 0 2px', fontSize: 'var(--yt-type-section)', fontWeight: 600, color: 'var(--yt-text-primary)',
} as const

/** Raised cards: the queue is the one zone that asks for a verdict. */
const proposalRowStyle = {
  display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, padding: '6px 8px', marginTop: 4,
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const proposalMetaStyle = { color: 'var(--yt-text-secondary)', fontSize: 12, marginTop: 2 } as const

/** The two verdicts side by side at the card's foot. */
const proposalActionsStyle = { display: 'flex', gap: 8, marginTop: 2 } as const

const verdictStyle = { padding: '1px 6px', fontSize: 12 } as const

/**
 * One pending proposal card (ADR-0044 决定 7): the distilled text with its
 * source annotation, and the two verdicts side by side at the card's foot.
 * The proposal's scope is the capability whose run produced it, so approving
 * promotes to that scope directly — no per-card re-judging.
 */
function ProposalRow(props: {
  readonly t: WorkbenchT
  readonly group: KbMemoryProposalGroup
  readonly entry: KbMemoryProposal
  readonly busy: boolean
  readonly onApprove: (scope: string, text: string) => void
  readonly onDiscard: (scope: string, text: string) => void
}): ReactElement {
  const { t, group, entry, busy } = props
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
      <div style={proposalActionsStyle}>
        <button
          type="button"
          style={verdictStyle}
          disabled={busy}
          data-memory-proposal-approve={entry.id}
          onClick={() => { props.onApprove(group.scope, entry.text) }}
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
  // Two error channels, not one: the two loaders race, and a shared state
  // would let the healthy read's success erase the failed read's message
  // (last-writer-wins) — the panel would then sit loading forever with the
  // failure nowhere in sight.
  const [error, setError] = useState<string | null>(null)
  const [proposalError, setProposalError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  // 删除的两击武装（2026-10-05 第三轮评审 P2#3）：✕ 首击只武装该行（变
  // 「确认删除？」），再击才执行；武装另一行或收起即解除。此前唯独这里例外。
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null)
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

  /** Re-read the proposal queues (ADR-0044 决定 7); the queue's own error channel. */
  const reloadProposals = useCallback(async (): Promise<void> => {
    try {
      const result = await latest.current.listProposals()
      setProposals(result.groups)
      setProposalError(null)
    } catch (failure: unknown) {
      setProposalError(remoteMessage(failure))
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await Promise.all([reload(), reloadProposals()])
    })()
  }, [reload, reloadProposals])

  /** Promote one proposal to its own scope; the queue's duplicate refusal reads as 已记得. */
  const promote = async (scope: string, text: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    let failureMessage: string | null = null
    try {
      await latest.current.approveProposal(scope, text)
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
      await Promise.all([reload(), reloadProposals()])
      if (failureMessage !== null) setProposalError(failureMessage)
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
      await Promise.all([reload(), reloadProposals()])
      if (failureMessage !== null) setProposalError(failureMessage)
    }
  }

  /** Add one rule; the duplicate refusal is the 已记得 notice, not an error.
   *  A successful save collapses the form; a refusal keeps it open for revision. */
  const remember = async (): Promise<void> => {
    const trimmed = text.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    try {
      await latest.current.add(scope, trimmed)
      setText('')
      setAdding(false)
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

  // The 待批准 zone flattens the queue groups to cards.
  const pending = (proposals ?? []).flatMap(group => group.entries.map(entry => ({ group, entry })))

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
              busy={busy}
              onApprove={(rowScope, rowText) => { void promote(rowScope, rowText) }}
              onDiscard={(rowScope, rowText) => { void drop(rowScope, rowText) }}
            />
          ))}
        </div>
      )}
      {adding ? (
        <div style={addFormStyle} data-memory-add="true">
          <select
            style={addScopeStyle}
            aria-label="scope"
            title={scopeLabel(t, scope)}
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
            autoFocus
            onChange={(event) => { setText(event.target.value) }}
            onKeyDown={(event) => {
              // IME composition: Enter submits the candidate, Escape cancels
              // it — neither may be mistaken for a panel gesture (same guard
              // as ui-conversation's keymap and ProposalCard).
              if (event.nativeEvent.isComposing) return
              // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
              // oxlint-disable-next-line typescript/no-deprecated
              if (event.nativeEvent.keyCode === 229) return
              if (event.key === 'Enter') { void remember() }
              if (event.key === 'Escape') { setAdding(false); setText('') }
            }}
          />
          <div style={addActionsStyle}>
            <button type="button" style={primaryButtonStyle} disabled={busy || text.trim() === ''} onClick={() => { void remember() }}>
              {t('memory.save')}
            </button>
            <button
              type="button"
              style={ghostButtonStyle}
              disabled={busy}
              data-memory-add-cancel="true"
              onClick={() => { setAdding(false); setText('') }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          style={addOpenStyle}
          disabled={busy}
          data-memory-add-open="true"
          onClick={() => { setAdding(true) }}
        >
          {t('memory.addNew')}
        </button>
      )}
      {notice !== null && <div style={hintStyle} data-memory-notice="true">{notice}</div>}
      {error !== null && <div style={errorStyle} data-memory-error="true">{error}</div>}
      {proposalError !== null && <div style={errorStyle} data-memory-proposal-error="true">{proposalError}</div>}
      {groups === null && error === null && <div style={mutedStyle}>{t('memory.loading')}</div>}
      {groups !== null && groups.length === 0 && <div style={mutedStyle} data-memory-empty="true">{t('memory.empty')}</div>}
      {groups?.map(group => (
        <div key={group.scope} data-memory-group={group.scope}>
          <div style={groupTitleStyle}>{scopeLabel(t, group.scope)}</div>
          {group.entries.map((entry, index) => (
            <div
              key={entry.id}
              style={{ ...rowStyle, marginTop: index === 0 ? 8 : 12 }}
              data-memory-entry={entry.id}
            >
              <div style={textStyle}>
                {entry.text}
                {entry.date !== undefined && <div style={dateStyle}>{entry.date}</div>}
              </div>
              <button
                type="button"
                style={armedDeleteId === entry.id ? armedDeleteStyle : deleteStyle}
                disabled={busy}
                data-armed={armedDeleteId === entry.id || undefined}
                data-memory-delete={entry.id}
                onClick={() => {
                  if (armedDeleteId !== entry.id) {
                    setArmedDeleteId(entry.id)
                    return
                  }
                  setArmedDeleteId(null)
                  void forget(group, entry.id)
                }}
              >
                {armedDeleteId === entry.id ? t('workbench.deleteArm') : '✕'}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
