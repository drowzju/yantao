/**
 * The conversation face of ADR-0044's proposal-approval pipeline (决定 5):
 * when the agent calls `kb_propose_memory`, the call renders as this light
 * approval card — the proposed text, its target scope, and the two verdict
 * buttons. Approving promotes through the human channel's
 * `memoryProposalApprove` RPC (the same seam the memory view uses; like the
 * 待批准 zone, the card promotes to the proposal's own scope — the
 * capability whose run produced it already said where the rule belongs), discarding removes the line from the queue. The card never writes
 * anything itself.
 *
 * Visual discipline follows the proposal-card family (ADR-0038): the
 * `--yt-*` vocabulary, calm surfaces, the scope as the only accent chip.
 * The card is a pure function of the durable call slice plus its own
 * verdict state: after a reload the buttons return, and a stale verdict
 * surfaces the queue's own refusal (已是记忆 / 不在队列) as prose.
 */
import { useState, type ReactElement } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { remoteMessage } from './remote.ts'
import { ghostButtonStyle, primaryButtonStyle } from './buttons.ts'
import { WORKBENCH_NS } from './locales.ts'

/** The two human-channel RPCs the verdict buttons call, injected at registration. */
export interface MemoryProposalRpc {
  /** Promote the proposal: its text lands in the scope's memory file. */
  approve: (scope: string, text: string) => Promise<unknown>
  /** Remove the proposal from the queue without promoting it. */
  discard: (scope: string, text: string) => Promise<unknown>
}

type MemoryProposalCardProps = ToolCallViewProps & PropsLocale<typeof WORKBENCH_NS> & MemoryProposalRpc

/** The call's lifecycle, derived solely from the durable block. */
type CardState = 'running' | 'ok' | 'error' | 'stopped'

/** The human's verdict on one proposal, held locally after the call settles. */
type Verdict =
  | { phase: 'idle' }
  | { phase: 'busy' }
  | { phase: 'approved' }
  | { phase: 'discarded' }
  | { phase: 'failed'; message: string }

/** The call arguments the verdict RPCs need; null while unparsable. */
interface ProposalArgs {
  scope: string
  text: string
  source?: string
}

/**
 * Parse the call's arguments. Mid-stream truncation and window-cut call
 * heads (a settled block's `call` is null) both degrade to null — the card
 * then shows what it can and offers no verdict.
 */
function parseArgs(argsRaw: string): ProposalArgs | null {
  if (argsRaw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const scope = (parsed as Record<string, unknown>).scope
  const text = (parsed as Record<string, unknown>).text
  const source = (parsed as Record<string, unknown>).source
  if (typeof scope !== 'string' || typeof text !== 'string') return null
  return {
    scope,
    text,
    ...(typeof source === 'string' && source !== '' ? { source } : {}),
  }
}

/** Flatten a settled result's content blocks to text (the SkillRow contract). */
function resultText(block: MemoryProposalCardProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/** First physical line, for the collapsed error row. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

const cardStyle = {
  margin: '4px 0',
  padding: '10px 12px',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 8,
} as const

const titleRowStyle = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const

const titleStyle = { fontSize: 'var(--yt-type-section)', fontWeight: 600, color: 'var(--yt-text-primary)' } as const

/** The target scope, the card's one accent chip (ADR-0038's capsule layer). */
const scopeChipStyle = {
  padding: '1px 8px',
  fontSize: 'var(--yt-type-label)',
  fontWeight: 600,
  color: 'var(--yt-text-secondary)',
  background: 'var(--yt-accent-bg)',
  border: '1px solid var(--yt-accent-border)',
  borderRadius: 10,
} as const

const textStyle = {
  margin: '8px 0 0',
  fontSize: 'var(--yt-type-body)',
  color: 'var(--yt-text-primary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const

const detailStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const errorRowStyle = {
  marginTop: 8,
  padding: '4px 6px',
  background: 'var(--yt-error-bg)',
  borderRadius: 6,
  fontSize: 'var(--yt-type-label)',
  color: 'var(--yt-error)',
} as const

const footerStyle = { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 } as const

/** 裁决钮面孔收敛到 ./buttons.ts：批准是这张卡的主行动（实心 accent），
    丢弃穿幽灵装——与裁决卡的决策重心语法一致（2026-10-05）。 */

/**
 * Render one `kb_propose_memory` call as the light approval card.
 * @param props - the keyed toolview payload, the workbench translate face,
 *   and the two verdict RPCs injected at registration.
 * @returns the card element.
 */
export function MemoryProposalCard(props: MemoryProposalCardProps): ReactElement {
  const { block, t } = props
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const args = parseArgs(argsRaw)
  const output = resultText(block)
  const state: CardState = !settled
    ? 'running'
    : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
  const [verdict, setVerdict] = useState<Verdict>({ phase: 'idle' })

  /** Run one verdict; the queue's own refusal lands as the failed prose. */
  const act = (verb: 'approve' | 'discard'): void => {
    if (args === null || verdict.phase === 'busy') return
    setVerdict({ phase: 'busy' })
    const call = verb === 'approve' ? props.approve : props.discard
    call(args.scope, args.text).then(
      () => { setVerdict({ phase: verb === 'approve' ? 'approved' : 'discarded' }) },
      (failure: unknown) => { setVerdict({ phase: 'failed', message: remoteMessage(failure) }) },
    )
  }

  const scopeLabel = args === null
    ? null
    : `${t('memory.proposal.scopeLabel')}：${args.scope === 'global' ? t('memory.scope.global') : args.scope}`

  // The verdict footer: buttons until a verdict lands, then its prose. The
  // pending note stands only while the proposal is still awaiting one.
  const footer = (state === 'ok' && args !== null) ? (
    <div style={footerStyle} data-memory-proposal-actions="true">
      {(verdict.phase === 'idle' || verdict.phase === 'busy' || verdict.phase === 'failed') && (
        <>
          <button
            type="button"
            style={primaryButtonStyle}
            data-memory-proposal-approve="true"
            disabled={verdict.phase === 'busy'}
            onClick={() => { act('approve') }}
          >
            {t('memory.proposal.approve')}
          </button>
          <button
            type="button"
            style={ghostButtonStyle}
            data-memory-proposal-discard="true"
            disabled={verdict.phase === 'busy'}
            onClick={() => { act('discard') }}
          >
            {t('memory.proposal.discard')}
          </button>
        </>
      )}
      {verdict.phase === 'busy' && <span style={detailStyle}>{t('memory.proposal.busy')}</span>}
      {verdict.phase === 'approved' && (
        <span style={detailStyle} data-memory-proposal-verdict="approved">{t('memory.proposal.approved')}</span>
      )}
      {verdict.phase === 'discarded' && (
        <span style={detailStyle} data-memory-proposal-verdict="discarded">{t('memory.proposal.discarded')}</span>
      )}
      <span style={{ flex: 1 }} />
      {verdict.phase !== 'approved' && verdict.phase !== 'discarded' && (
        <span style={detailStyle}>{t('memory.proposal.pending')}</span>
      )}
    </div>
  ) : null

  return (
    <div style={cardStyle} data-memory-proposal-card="true" data-memory-proposal-state={state}>
      <div style={titleRowStyle}>
        <span style={titleStyle}>{t('memory.proposal.title')}</span>
        {scopeLabel !== null && (
          <span style={scopeChipStyle} data-memory-proposal-scope={args?.scope}>{scopeLabel}</span>
        )}
      </div>
      {/* A refused call: the queue's refusal prose in the error row, no verdict. */}
      {state === 'error' && (
        <div style={errorRowStyle} data-memory-proposal-error="true">
          {output !== null ? firstLine(output) : ('kind' in block ? block.error?.name ?? 'error' : 'error')}
        </div>
      )}
      {/* Interrupted before the tool ran: nothing was queued. */}
      {state === 'stopped' && (
        <div style={{ ...detailStyle, marginTop: 8 }} data-memory-proposal-interrupted="true">
          {t('memory.proposal.interrupted')}
        </div>
      )}
      {/* Still running: the streamed text when it already parses, else just the note. */}
      {state === 'running' && (
        <>
          {args !== null && <div style={textStyle}>{args.text}</div>}
          <div style={{ ...detailStyle, marginTop: 8 }}>{t('memory.proposal.running')}</div>
        </>
      )}
      {/* Settled ok. With args the card is the verdict surface; a window cut
          that dropped the call head degrades to the result prose alone. */}
      {state === 'ok' && (args !== null
        ? (
          <>
            <div style={textStyle} data-memory-proposal-text="true">{args.text}</div>
            {args.source !== undefined && (
              <div style={{ ...detailStyle, marginTop: 6 }} data-memory-proposal-source="true">
                {t('memory.proposal.sourceLabel')}：{args.source}
              </div>
            )}
          </>
        )
        : output !== null && <div style={{ ...detailStyle, marginTop: 8 }}>{output}</div>)}
      {/* A refused verdict: the queue's own refusal prose in the error row;
          the buttons stand below for a retry — a failed verdict is not a
          verdict. */}
      {state === 'ok' && verdict.phase === 'failed' && (
        <div style={errorRowStyle} data-memory-proposal-verdict="failed">{verdict.message}</div>
      )}
      {footer}
    </div>
  )
}
