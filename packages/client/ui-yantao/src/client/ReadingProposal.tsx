/**
 * The one confirmation window a reading flow ends with (ADR-0020): the
 * domains the agent proposes, ticked separately, plus an optional new domain
 * to create. Nothing is written from here — confirming hands the choice to
 * the second round, which lands it through the agent's kb_* tools.
 */
import { useState, type ReactElement } from 'react'
import type { ReadingProposal } from './reading-flow.ts'

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
  width: 'min(480px, 92vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 12px 32px rgba(28, 26, 22, 0.25)',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 13,
} as const

const detailStyle = { color: '#6b6455', fontSize: 12 } as const

const rowStyle = { display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' } as const

const buttonStyle = { padding: '4px 10px' } as const

const footerStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginTop: 14,
  paddingTop: 10,
  borderTop: '1px solid #efeade',
} as const

/**
 * Render the domain proposal window.
 * @param props - the proposal and the two callbacks.
 * @returns the window element.
 */
export function ReadingProposal(props: {
  readonly proposal: ReadingProposal
  readonly onConfirm: (domains: readonly string[], newDomain?: string) => void
  readonly onDismiss: () => void
}): ReactElement {
  const { proposal } = props
  // Nothing is ticked to begin with: linking is the human's call, and the
  // agent's word is a suggestion, not a decision.
  const [ticked, setTicked] = useState<readonly number[]>([])
  const [wantNew, setWantNew] = useState(false)
  const [newName, setNewName] = useState(proposal.newDomain ?? '')

  /** Tick or untick one existing domain. */
  const toggle = (index: number): void => {
    setTicked(state => state.includes(index)
      ? state.filter(entry => entry !== index)
      : [...state, index].sort((left, right) => left - right))
  }

  const domains = ticked
    .map(index => proposal.domains[index])
    .filter((name): name is string => name !== undefined)
  const confirmedNew = wantNew && newName.trim() !== '' ? newName.trim() : undefined
  const count = domains.length + (confirmedNew !== undefined ? 1 : 0)
  const nothing = proposal.domains.length === 0 && proposal.newDomain === undefined

  return (
    <div style={panelStyle} data-reading-proposal="true">
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>读完了一本书</div>
        <div style={{ ...detailStyle, marginTop: 2 }}>
          会话已保留，可以回去看它为什么这么判断。勾选这本书该挂到的领域：
        </div>
        {nothing && <div style={{ ...detailStyle, marginTop: 10 }}>它没有建议任何领域。</div>}
        {proposal.domains.map((name, index) => (
          <div key={name} style={rowStyle} data-domain-row={name}>
            <input
              type="checkbox"
              aria-label={name}
              checked={ticked.includes(index)}
              onChange={() => { toggle(index) }}
            />
            <div>{name}</div>
          </div>
        ))}
        {proposal.newDomain !== undefined && (
          <div style={rowStyle} data-domain-new="true">
            <input
              type="checkbox"
              aria-label="新建领域"
              checked={wantNew}
              onChange={() => { setWantNew(value => !value) }}
            />
            <div>
              新建领域
              <input
                type="text"
                value={newName}
                onChange={(event) => { setNewName(event.target.value) }}
                disabled={!wantNew}
                style={{ marginLeft: 6, padding: '2px 4px' }}
                aria-label="新领域名称"
              />
            </div>
          </div>
        )}
        <div style={footerStyle}>
          <button type="button" style={buttonStyle} onClick={props.onDismiss}>跳过</button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            style={buttonStyle}
            disabled={count === 0}
            onClick={() => { props.onConfirm(domains, confirmedNew) }}
          >
            确认关联（{count}）
          </button>
        </div>
      </div>
    </div>
  )
}
