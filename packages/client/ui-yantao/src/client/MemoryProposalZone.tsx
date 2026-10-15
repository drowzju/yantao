/**
 * The memory-proposal verdict zone (ADR-0044 决定 7), relocated 2026-10-15
 * from the 省得 panel into the 提议 sub-page: every in-flight proposal the
 * agent's `kb_propose_memory` queued, with its source annotation for the
 * human's judgement, sitting beside the inbox rows it resembles — one
 * surface for everything awaiting a verdict. The proposal arrives already
 * scoped by the capability whose run produced it, so the card offers no
 * scope picker — approving promotes the bare text to the proposal's own
 * scope (a duplicate refusal reads as 已记得: the memory already holds the
 * rule, the pending copy stays for an explicit discard), discarding drops
 * the line; both drain the queue through the human channel's RPCs, the same
 * seam the conversation card uses. Scope picking belongs to the 省得 panel's
 * add row, where the human is the author.
 *
 * Self-contained like MemoryPanel was: it owns its read (a light 30s poll,
 * silent on failure beyond its own error line) and reports the pending
 * count upward for the footer/子页 badges.
 * @module @deepseek-ai/dsh-client-ui-yantao/MemoryProposalZone
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { KbMemoryProposal, KbMemoryProposalGroup } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import {
  isDuplicateMemory, remoteMessage,
  type MemoryProposalApprover, type MemoryProposalDiscarder, type MemoryProposalLister,
} from './remote.ts'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'
import { toolButtonStyle } from './buttons.ts'

/** What the zone needs: the three queue RPCs, already bound to the context. */
export interface MemoryProposalZoneProps {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** List the in-flight proposals across scopes. */
  readonly list: MemoryProposalLister
  /** Promote one pending proposal to its scope. */
  readonly approve: MemoryProposalApprover
  /** Drop one pending proposal without promoting it. */
  readonly discard: MemoryProposalDiscarder
  /** Reports the pending count after every read — the badges' feed. */
  readonly onPendingChange?: (pending: number) => void
}

/** The two scopes with their own names; a capability scope shows as its name. */
const SCOPE_KEYS: Record<string, WorkbenchLocaleKey> = {
  global: 'memory.scope.global',
  mail: 'memory.scope.mail',
}

/** One scope's display name: the translated one when it has one, else its name. */
function scopeLabel(t: WorkbenchT, scope: string): string {
  const key = SCOPE_KEYS[scope]
  return key === undefined ? scope : t(key)
}

const wrapStyle = { display: 'flex', flexDirection: 'column', minWidth: 0, flexShrink: 0 } as const

const mutedStyle = { color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)' } as const

const errorStyle = { color: 'var(--yt-error)', fontSize: 'var(--yt-type-label)' } as const

const hintStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

/** The zone's heading, one step above the inbox rows' own typography. */
const zoneTitleStyle = {
  margin: 'var(--yt-space-2) 0 var(--yt-space-1)', fontSize: 'var(--yt-type-section)', fontWeight: 600, color: 'var(--yt-text-primary)',
} as const

/** Raised cards: the queue is the one zone that asks for a verdict. */
const proposalRowStyle = {
  display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-1)', minWidth: 0, padding: 'var(--yt-space-1) var(--yt-space-2)', marginTop: 'var(--yt-space-1)',
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const proposalMetaStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)', marginTop: 'var(--yt-space-1)' } as const

/** The two verdicts side by side at the card's foot. */
const proposalActionsStyle = { display: 'flex', gap: 'var(--yt-space-2)', marginTop: 'var(--yt-space-1)' } as const

const textStyle = { minWidth: 0 } as const

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
  // 元数据各自成段（2026-10-12 评审 P2-2）：DESIGN.md §7 禁止 ` · ` 尾巴——
  // 来源与日期是证据，不是一句话里的连接词，拆成可换行的独立小段。
  const metaSegments = [
    `${t('memory.proposal.scopeLabel')}：${scopeLabel(t, group.scope)}`,
    ...(entry.source !== '' ? [`${t('memory.proposal.sourceLabel')}：${entry.source}`] : []),
    ...(entry.date !== undefined ? [entry.date] : []),
  ]
  return (
    <div style={proposalRowStyle} data-memory-proposal={entry.id} data-memory-proposal-scope={group.scope}>
      <div style={textStyle}>
        {entry.text}
        <div style={{ ...proposalMetaStyle, display: 'flex', flexWrap: 'wrap', columnGap: 'var(--yt-space-2)' }}>
          {metaSegments.map((segment, at) => <span key={`${at}-${segment}`}>{segment}</span>)}
        </div>
      </div>
      <div style={proposalActionsStyle}>
        <button data-hover="true"
          type="button"
          style={toolButtonStyle}
          disabled={busy}
          data-memory-proposal-approve={entry.id}
          onClick={() => { props.onApprove(group.scope, entry.text) }}
        >
          {t('memory.proposal.approve')}
        </button>
        <button data-hover="true"
          type="button"
          style={toolButtonStyle}
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
 * Render the memory-proposal verdict zone; nothing (not even a header) while
 * the queue is empty and nothing needs saying.
 * @param props - see {@link MemoryProposalZoneProps}.
 * @returns the zone element, or null when quiet.
 */
export function MemoryProposalZone({ t, list, approve, discard, onPendingChange }: MemoryProposalZoneProps): ReactElement | null {
  // Every seam is a fresh closure on each render (inject face), so the poll
  // and the writes read them through a ref — the same discipline useRail uses.
  const latest = useRef({ list, approve, discard })
  latest.current = { list, approve, discard }

  const [groups, setGroups] = useState<readonly KbMemoryProposalGroup[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Re-read the queue; a failure is the zone's error line, not a crash.
   *  Resolves after the state settles, so a verdict's own failure message can
   *  be re-set afterwards — the reload would otherwise erase it
   *  (last-writer-wins, the same trap MemoryPanel's two-channel split avoided). */
  const reload = useCallback(async (): Promise<void> => {
    try {
      const result = await latest.current.list()
      setGroups(result.groups ?? [])
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])

  // The light poll (the IntakeRail badge's 30s cadence, relocated): an
  // agent's nomination surfaces without entering the tab, and a verdict
  // made on the conversation card drains here within the same interval.
  useEffect(() => {
    void reload()
    const timer = setInterval(() => { void reload() }, 30_000)
    return () => { clearInterval(timer) }
  }, [reload])

  const pending = groups.reduce((sum, group) => sum + group.entries.length, 0)
  const reportRef = useRef(onPendingChange)
  reportRef.current = onPendingChange
  useEffect(() => {
    reportRef.current?.(pending)
  }, [pending])

  /** Promote one proposal to its own scope. */
  const promote = async (scope: string, text: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    let failureMessage: string | null = null
    try {
      await latest.current.approve(scope, text)
      setNotice(t('memory.proposal.approved'))
    } catch (failure: unknown) {
      // The queue's duplicate refusal means the memory already holds the
      // rule — the proposal itself is now redundant, and the reload makes
      // that visible; the human discards what remains.
      setNotice(isDuplicateMemory(failure) ? t('memory.known') : null)
      if (!isDuplicateMemory(failure)) failureMessage = remoteMessage(failure)
    } finally {
      setBusy(false)
      await reload()
      if (failureMessage !== null) setError(failureMessage)
    }
  }

  /** Drop one proposal; the queue shrinks and nothing is remembered. */
  const drop = async (scope: string, text: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    let failureMessage: string | null = null
    try {
      await latest.current.discard(scope, text)
      setNotice(t('memory.proposal.discarded'))
      setError(null)
    } catch (failure: unknown) {
      setNotice(null)
      failureMessage = remoteMessage(failure)
    } finally {
      setBusy(false)
      await reload()
      if (failureMessage !== null) setError(failureMessage)
    }
  }

  if (pending === 0 && error === null && notice === null) return null
  return (
    <div style={wrapStyle} data-memory-proposals="true">
      <div style={zoneTitleStyle}>{t('memory.proposal.title')}</div>
      <div style={mutedStyle}>{t('memory.proposal.pending')}</div>
      {groups.flatMap(group => group.entries.map(entry => (
        <ProposalRow
          key={`${group.scope}|${entry.id}`}
          t={t}
          group={group}
          entry={entry}
          busy={busy}
          onApprove={(rowScope, rowText) => { void promote(rowScope, rowText) }}
          onDiscard={(rowScope, rowText) => { void drop(rowScope, rowText) }}
        />
      )))}
      {notice !== null && <div style={hintStyle} data-memory-proposal-notice="true">{notice}</div>}
      {error !== null && <div style={errorStyle} data-memory-proposal-error="true">{error}</div>}
    </div>
  )
}
