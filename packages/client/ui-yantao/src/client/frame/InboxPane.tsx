/**
 * The 提议 tab's pane (ADR-0047): the inbox's rows — pending first, decided
 * after — with the shared ProposalCard opening over a clicked pending row.
 * The card is the one decision surface (零新面孔，样式统一裁决直接适用):
 * 批准 ticks rows and writes through the frame's human-channel seams, and
 * leaving the card any other way — 丢弃钮、取消、Esc — is the discard verdict
 * (2026-10-05 验收修正：取消即丢弃，卡一关必有裁决，行不留悬而未决的第三态).
 * Both verdicts close the card; the row's chip tells what happened.
 *
 * Like SchedulePane this pane speaks plain Chinese (the panes skip i18n);
 * colors and metrics ride the `--yt-*` tokens. Pure presentation: the rows
 * and the two verdicts arrive as props.
 */
import { useState, type ReactElement } from 'react'
import type { KbQueuedProposal } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { proposalOfPayload } from '../capability-match.ts'
import type { WorkbenchT } from '../locales.ts'
import { ProposalCard } from '../ProposalCard.tsx'

/** The pane's props: the inbox's rows, the in-flight decision, the two verdicts. */
export interface InboxPaneProps {
  /** The store's entries in enqueue order — pending and decided alike. */
  readonly entries: readonly KbQueuedProposal[]
  /** The entry id with a decision in flight; its buttons hold still. */
  readonly busyId: string | null
  /** Apply the ticked rows of one pending entry, then settle it approved. */
  readonly onConfirm: (entry: KbQueuedProposal, ticked: readonly number[]) => void
  /** Drop one pending entry without writing anything. */
  readonly onDiscard: (entry: KbQueuedProposal) => void
  /** The workbench dictionary's bound translator — the shared card's tongue. */
  readonly t: WorkbenchT
}

const FONT = 'var(--yt-font-ui)'

const paneStyle = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  position: 'relative',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
} as const

const listStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
} as const

const emptyStyle = {
  padding: 16,
  color: 'var(--yt-text-muted)',
} as const

const rowStyle = {
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  background: 'var(--yt-surface-primary)',
} as const

const rowMainStyle = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  cursor: 'pointer',
} as const

const titleStyle = {
  fontWeight: 600,
  color: 'var(--yt-text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const noteStyle = {
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-label)',
} as const

const metaStyle = {
  color: 'var(--yt-text-muted)',
  fontSize: 'var(--yt-type-label)',
} as const

/** The decided row's status chip: quiet, so pending rows own the urgency. */
const chipApprovedStyle = {
  display: 'inline-block',
  padding: '0 6px',
  borderRadius: 8,
  fontSize: 'var(--yt-type-label)',
  lineHeight: '16px',
  background: 'var(--yt-success-bg, var(--yt-surface-raised))',
  color: 'var(--yt-text-secondary)',
} as const

const chipDiscardedStyle = {
  ...chipApprovedStyle,
  color: 'var(--yt-text-muted)',
} as const

const discardButtonStyle = {
  padding: '2px 8px',
  background: 'transparent',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  color: 'var(--yt-text-secondary)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-label)',
} as const

/** The degraded card for a payload the client can no longer parse. */
const plainCardStyle = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(28, 26, 22, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
} as const

const plainInnerStyle = {
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 10,
  padding: 16,
  width: 'min(480px, 92vw)',
  boxShadow: '0 12px 32px rgba(28, 26, 22, 0.25)',
} as const

/** Format one ISO stamp for the rows' metadata lines (SchedulePane's recipe). */
function formatStamp(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getMonth() + 1}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Display order: pending rows first, newest first within each group. */
function ordered(entries: readonly KbQueuedProposal[]): readonly KbQueuedProposal[] {
  const pending = entries.filter(entry => entry.status === 'pending').reverse()
  const decided = entries.filter(entry => entry.status !== 'pending').reverse()
  return [...pending, ...decided]
}

/**
 * Render the 提议 tab's inbox list and its decision card.
 * @param props - see {@link InboxPaneProps}.
 * @returns the pane element.
 */
export function InboxPane({ entries, busyId, onConfirm, onDiscard, t }: InboxPaneProps): ReactElement {
  // The open card's entry id; either verdict closes it — the row's chip
  // carries the outcome (取消即丢弃，ADR-0047 验收修正).
  const [openId, setOpenId] = useState<string | null>(null)
  const openEntry = openId === null ? undefined : entries.find(entry => entry.id === openId)
  const openProposal = openEntry === undefined ? null : proposalOfPayload(openEntry.proposal)
  return (
    <div style={paneStyle} data-inbox-pane="true">
      {entries.length === 0 ? (
        <div style={emptyStyle}>还没有提议。调度任务产生了待决策的提议时，会出现在这里。</div>
      ) : (
        <div style={listStyle}>
          {ordered(entries).map((entry) => {
            const pending = entry.status === 'pending'
            return (
              <div key={entry.id} style={rowStyle} data-inbox-entry={entry.id} data-inbox-status={entry.status}>
                <div
                  style={pending ? rowMainStyle : { ...rowMainStyle, cursor: 'default' }}
                  role={pending ? 'button' : undefined}
                  tabIndex={pending ? 0 : undefined}
                  onClick={() => { if (pending) setOpenId(entry.id) }}
                  onKeyDown={(event) => {
                    if (!pending) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      // Space's native action on a role="button" is scrolling
                      // — swallow it so activating the row doesn't scroll the
                      // list beneath the card that just opened.
                      event.preventDefault()
                      setOpenId(entry.id)
                    }
                  }}
                >
                  <span style={titleStyle}>{entry.title}</span>
                  {entry.note !== undefined && <span style={noteStyle}>{entry.note}</span>}
                  <span style={metaStyle}>
                    {entry.sourceName} · 入队 {formatStamp(entry.createdAt)}
                    {entry.status === 'approved' && entry.decidedAt !== undefined && (
                      <> · <span style={chipApprovedStyle}>已批准 {formatStamp(entry.decidedAt)}</span></>
                    )}
                    {entry.status === 'discarded' && entry.decidedAt !== undefined && (
                      <> · <span style={chipDiscardedStyle}>已丢弃 {formatStamp(entry.decidedAt)}</span></>
                    )}
                  </span>
                </div>
                {pending && (
                  <button
                    type="button"
                    style={discardButtonStyle}
                    data-inbox-row-discard="true"
                    disabled={busyId === entry.id}
                    onClick={() => { onDiscard(entry) }}
                  >
                    丢弃
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {openEntry !== undefined && openProposal !== null && (
        <ProposalCard
          proposal={openProposal}
          onConfirm={(ticked) => { setOpenId(null); onConfirm(openEntry, ticked) }}
          onDiscard={() => { setOpenId(null); onDiscard(openEntry) }}
          busy={busyId === openEntry.id}
          t={t}
        />
      )}
      {openEntry !== undefined && openProposal === null && (
        <div style={plainCardStyle} data-inbox-unparsable="true">
          <div style={plainInnerStyle}>
            <div style={titleStyle}>{openEntry.title}</div>
            <div style={{ ...noteStyle, margin: '8px 0 12px' }}>
              这条提议的内容无法在本工作台解析（可能来自旧版本），只能丢弃。
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={discardButtonStyle} onClick={() => { setOpenId(null) }}>
                关闭
              </button>
              <button
                type="button"
                style={discardButtonStyle}
                disabled={busyId === openEntry.id}
                onClick={() => { onDiscard(openEntry) }}
              >
                丢弃
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
