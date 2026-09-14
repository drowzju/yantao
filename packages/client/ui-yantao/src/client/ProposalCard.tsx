/**
 * The one confirmation window every agent judgement ends with (ADR-0021
 * 决定 4): a proposal's actions, grouped by kind, each row ticked separately,
 * with 全部接受 and 全部忽略 for the whole verdict. The mail analysis's four
 * blocks render here.
 *
 * Nothing is written from here. The card only reports which rows the human
 * chose; the caller does the writing once, after confirmation — through
 * {@link ./proposal-apply.ts} `applyProposal`'s direct RPCs.
 */
import { useState, type ReactElement } from 'react'
import type { Proposal, ProposalAction } from './proposal.ts'
import { GROUP_LABELS } from './proposal.ts'

const panelStyle = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(28, 26, 22, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
} as const

const cardStyle = {
  background: '#fffdf7',
  border: '1px solid #e6e2d8',
  borderRadius: 10,
  padding: 16,
  width: 'min(560px, 92vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 12px 32px rgba(28, 26, 22, 0.25)',
} as const

const groupTitleStyle = { margin: '12px 0 4px', fontSize: 12, fontWeight: 600, color: '#6b6455' } as const

const focusTitleStyle = { margin: '12px 0 4px', fontSize: 12, fontWeight: 700, color: '#b4453a' } as const

const focusRowStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'baseline',
  padding: '4px 6px',
  background: 'rgba(180, 69, 58, 0.08)',
  borderRadius: 6,
  fontSize: 12,
} as const

const rowStyle = { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0' } as const

const detailStyle = { color: '#6b6455', fontSize: 12 } as const

const buttonStyle = { padding: '4px 10px' } as const

const footerStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginTop: 14,
  paddingTop: 10,
  borderTop: '1px solid #efeade',
} as const

/** The kinds in the order the card lists their groups. */
const GROUP_ORDER: readonly ProposalAction['kind'][] = [
  'create-entity', 'add-todo', 'append-log', 'write-state', 'create-link', 'save-resource',
]

/** One row's main text, as the human reads it. */
function labelOf(action: ProposalAction): string {
  switch (action.kind) {
    case 'create-entity': return action.name
    case 'add-todo': return action.due !== undefined ? `${action.title}（${action.due}）` : action.title
    case 'append-log': return action.entityName
    case 'write-state': return action.entityName
    case 'create-link': return action.link
    case 'save-resource': return action.path
  }
}

/** One row's explanation — why the agent proposes this. */
function detailOf(action: ProposalAction): string {
  return action.reason
}

/**
 * Render the proposal card.
 * @param props - the proposal, the two callbacks, and whether a confirm or a
 *   dismiss is already in flight (buttons hold still while it is).
 * @returns the card element.
 */
export function ProposalCard(props: {
  readonly proposal: Proposal
  readonly onConfirm: (ticked: readonly number[]) => void
  readonly onDismiss: () => void
  readonly busy?: boolean
}): ReactElement {
  const { proposal } = props
  // Nothing is ticked to begin with: writing into a knowledge base is the one
  // action here that cannot be undone by looking again.
  const [ticked, setTicked] = useState<readonly number[]>([])

  /** Tick or untick one row. */
  const toggle = (index: number): void => {
    setTicked(state => state.includes(index)
      ? state.filter(entry => entry !== index)
      : [...state, index].sort((left, right) => left - right))
  }

  const all = (): void => {
    setTicked(proposal.actions.map((_action, index) => index))
  }
  const none = (): void => { setTicked([]) }
  const count = ticked.length
  const nothing = proposal.actions.length === 0

  return (
    <div style={panelStyle} data-proposal-card="true">
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{proposal.title}</div>
        {proposal.note !== undefined && <div style={{ ...detailStyle, marginTop: 2 }}>{proposal.note}</div>}
        {proposal.highlights !== undefined && proposal.highlights.length > 0 && (
          <div data-proposal-highlights="true">
            <div style={focusTitleStyle}>重点提醒</div>
            {proposal.highlights.map((entry, index) => (
              <div key={index} style={focusRowStyle}>
                <span style={{ fontWeight: 600 }}>{entry.sender}：{entry.subject}</span>
                <span style={detailStyle}>{entry.why}</span>
              </div>
            ))}
          </div>
        )}
        {proposal.digest !== undefined && proposal.digest.length > 0 && (
          <div data-proposal-digest="true">
            <div style={groupTitleStyle}>日常通知（汇总）</div>
            {proposal.digest.map((entry, index) => (
              <div key={index} style={detailStyle}>
                {entry.sender}：{entry.subject} — {entry.why}
              </div>
            ))}
          </div>
        )}
        {nothing && <div style={{ ...detailStyle, marginTop: 10 }}>这次没有发现值得进入知识库的内容。</div>}
        {GROUP_ORDER.map((kind) => {
          const rows = proposal.actions
            .map((action, index) => ({ action, index }))
            .filter(row => row.action.kind === kind)
          if (rows.length === 0) return null
          return (
            <div key={kind}>
              <div style={groupTitleStyle} data-proposal-group={kind}>{GROUP_LABELS[kind]}</div>
              {rows.map(({ action, index }) => (
                <div key={index} style={rowStyle} data-proposal-row={index}>
                  <input
                    type="checkbox"
                    aria-label={labelOf(action)}
                    checked={ticked.includes(index)}
                    onChange={() => { toggle(index) }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div>{labelOf(action)}</div>
                    {detailOf(action) !== '' && <div style={detailStyle}>{detailOf(action)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
        <div style={footerStyle}>
          <button type="button" style={buttonStyle} disabled={props.busy === true || nothing} onClick={all}>
            全部接受
          </button>
          <button type="button" style={buttonStyle} disabled={props.busy === true} onClick={none}>
            全部忽略
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={buttonStyle} disabled={props.busy === true} onClick={props.onDismiss}>
            取消
          </button>
          <button
            type="button"
            style={buttonStyle}
            disabled={props.busy === true || count === 0}
            onClick={() => { props.onConfirm(ticked) }}
          >
            确认写入（{count}）
          </button>
        </div>
      </div>
    </div>
  )
}
