/**
 * The one confirmation window every agent judgement ends with (ADR-0021
 * 决定 4): a proposal's actions, grouped by kind, each row ticked separately,
 * with 全部接受 and 全部忽略 for the whole verdict. The mail analysis's four
 * blocks render here; the validate card renders grouped by target entity,
 * prescan folded into a summary, with a free-input box for revisions.
 *
 * Nothing is written from here. The card only reports which rows the human
 * chose; the caller does the writing once, after confirmation — through
 * {@link ./proposal-apply.ts} `applyProposal`'s direct RPCs.
 */
import { useEffect, useState, type ReactElement } from 'react'
import type { Proposal, ProposalAction } from './proposal.ts'
import { allProposalActions, GROUP_KEYS } from './proposal.ts'
import { entityNameOf } from './validate.ts'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'

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
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 10,
  padding: 16,
  width: 'min(560px, 92vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 12px 32px rgba(28, 26, 22, 0.25)',
} as const

const groupTitleStyle = { margin: '12px 0 4px', fontSize: 'var(--yt-type-label)', fontWeight: 600, color: 'var(--yt-text-secondary)' } as const

const focusTitleStyle = { margin: '12px 0 4px', fontSize: 'var(--yt-type-label)', fontWeight: 700, color: 'var(--yt-error)' } as const

const focusRowStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'baseline',
  padding: '4px 6px',
  background: 'var(--yt-error-bg)',
  borderRadius: 6,
  fontSize: 'var(--yt-type-label)',
} as const

const rowStyle = { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0' } as const

const detailStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const summaryRowStyle = { display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' } as const

const summaryTextStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const toggleStyle = {
  padding: '1px 6px',
  fontSize: 'var(--yt-type-label)',
  color: 'var(--yt-text-secondary)',
  background: 'transparent',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  cursor: 'pointer',
} as const

const instructionStyle = {
  display: 'flex',
  gap: 8,
  marginTop: 12,
  paddingTop: 10,
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

const inputStyle = {
  flex: 1,
  minWidth: 0,
  padding: '4px 8px',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
} as const

const buttonStyle = { padding: '4px 10px' } as const

const footerStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginTop: 14,
  paddingTop: 10,
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

/** The kinds in the order the card lists their groups. */
const GROUP_ORDER: readonly ProposalAction['kind'][] = [
  'create-entity', 'create-project', 'add-todo', 'append-log', 'write-state', 'edit-section', 'append-section', 'create-link', 'save-resource', 'add-memory', 'delete-mails',
]

/** A person action's relation, as the row's detail names it (self is never proposed). */
const RELATION_KEYS: Partial<Record<NonNullable<Extract<ProposalAction, { kind: 'create-entity' }>['relation']>, WorkbenchLocaleKey>> = {
  superior: 'relation.superior',
  peer: 'relation.peer',
  subordinate: 'relation.subordinate',
  external: 'relation.external',
}

/** One row's main text, as the human reads it. */
function labelOf(action: ProposalAction): string {
  switch (action.kind) {
    case 'create-entity': return action.name
    case 'create-project': return action.name
    case 'add-todo': return action.due !== undefined ? `${action.title}（${action.due}）` : action.title
    case 'append-log': return action.entityName
    case 'write-state': return action.entityName
    case 'create-link': return action.link
    case 'save-resource': return action.path
    case 'edit-section': return action.section
    case 'append-section': return action.section
    case 'add-memory': return action.text
    case 'delete-mails': return action.subject
  }
}

/** One row's explanation — why the agent proposes this. */
function detailOf(action: ProposalAction, t: WorkbenchT): string {
  if (action.kind === 'edit-section') return `${action.path}：${action.why}`
  if (action.kind === 'append-section') return `${action.path}：${action.why}`
  if (action.kind === 'delete-mails') return `${action.sender}：${action.reason}`
  if (action.kind === 'create-project') {
    const areas = action.areas !== undefined && action.areas.length > 0 ? `关联领域：${action.areas.join('、')}。` : ''
    return `${areas}${action.reason}`
  }
  if (action.kind === 'create-entity' && action.relation !== undefined) {
    const key = RELATION_KEYS[action.relation]
    return key === undefined ? action.reason : `${t(key)}：${action.reason}`
  }
  return action.reason
}

/** The target a `[[…]]` link names, as written inside the brackets. */
function targetOfLink(link: string): string {
  const match = /\[\[([^\]]+)\]\]/.exec(link)
  return match?.[1] ?? link
}

/** One visual row of the validate layout: possibly several actions behind one checkbox. */
interface EntityRow {
  /** The flat action indices this row's checkbox ticks together. */
  readonly indices: readonly number[]
  readonly label: string
  readonly detail: string
  /** The group's identity: one entity, or one leftover kind. */
  readonly groupKey: string
  readonly groupTitle: string
}

/**
 * Render the proposal card.
 * @param props - the proposal, the two callbacks, and whether a confirm or a
 *   dismiss is already in flight (buttons hold still while it is). The confirm
 *   callback also receives the create-project rows' 领域勾选, keyed by action
 *   index (ADR-0034 决定 4) — the human adjusts the association before writing.
 *   `onInstruction`, when given (the validate card), adds the bottom
 *   free-input box: the human's instruction goes back to the run for a
 *   revised proposal, as many rounds as wanted.
 * @returns the card element.
 */
export function ProposalCard(props: {
  readonly proposal: Proposal
  readonly onConfirm: (ticked: readonly number[], areaPicks?: Readonly<Record<number, readonly string[]>>) => void
  readonly onDismiss: () => void
  /** The free-input continuation — present only when the run can take instructions. */
  readonly onInstruction?: (text: string) => Promise<void>
  readonly busy?: boolean
  readonly t: WorkbenchT
}): ReactElement {
  const { proposal, t } = props
  // Nothing is ticked to begin with: writing into a knowledge base is the one
  // action here that cannot be undone by looking again.
  const [ticked, setTicked] = useState<readonly number[]>([])
  // The create-project rows' area association, keyed by action index (ADR-0034
  // 决定 4). A row the human never touched keeps the model's suggestion.
  const [areaPicks, setAreaPicks] = useState<Readonly<Record<number, readonly string[]>>>({})
  // The validate card's prescan folds away: the summary line stands, the
  // detail opens on demand.
  const [prescanOpen, setPrescanOpen] = useState(false)
  // The free-input box's draft and its in-flight state.
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // A revision round produces a fresh proposal object; the tick state of the
  // previous round must not leak into it (OCR review 2026-09-30).
  useEffect(() => {
    setTicked([])
    setAreaPicks({})
    setPrescanOpen(false)
  }, [proposal])

  /** Tick or untick one row. */
  const toggle = (index: number): void => {
    setTicked(state => state.includes(index)
      ? state.filter(entry => entry !== index)
      : [...state, index].sort((left, right) => left - right))
  }

  /** Tick or untick one area of one create-project row. */
  const toggleArea = (index: number, area: string, areas: readonly string[]): void => {
    setAreaPicks((previous) => {
      const base = previous[index] ?? areas
      const on = base.includes(area)
      return { ...previous, [index]: on ? base.filter(entry => entry !== area) : [...base, area] }
    })
  }

  /** Tick or untick every index one visual row stands for. */
  const toggleRow = (indices: readonly number[]): void => {
    setTicked(state => indices.every(index => state.includes(index))
      ? state.filter(entry => !indices.includes(entry))
      : [...new Set([...state, ...indices])].sort((left, right) => left - right))
  }

  /** Send the free-input draft back to the run; the input clears once taken. */
  const sendInstruction = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || props.onInstruction === undefined) return
    setSending(true)
    try {
      await props.onInstruction(text)
      setDraft('')
    } catch {
      // 修订失败：草稿留在输入框里，人可以直接改字重试。
    } finally {
      setSending(false)
    }
  }

  /**
   * The validate layout's rows (2026-09-30 修订): grouped by the entity each
   * action lands on, the link rows in the `[A] 页 新增链接 → [[B]]` shape the
   * human reads the operation off. Two refinements ride along: suggestions
   * for the same (page, target) merge into one row with joined reasons, and
   * a mutual pair — A→B and B→A — renders once, one checkbox ticking both
   * writes.
   */
  const entityRowsOf = (actions: readonly ProposalAction[], base: number): readonly EntityRow[] => {
    const groupOf = (action: ProposalAction): { readonly key: string; readonly title: string } => {
      switch (action.kind) {
        case 'create-link':
        case 'append-log':
          return { key: action.afterCreate ?? action.entityPath, title: action.entityName }
        case 'write-state':
          return { key: action.entityPath, title: action.entityName }
        case 'edit-section':
        case 'append-section':
          return { key: action.afterCreate ?? action.path, title: action.afterCreate ?? entityNameOf(action.path) }
        default:
          return { key: `kind:${action.kind}`, title: t(GROUP_KEYS[action.kind]) }
      }
    }
    // Mutual-inverse pairing first: an A→B link whose B→A twin exists later
    // renders as one bidirectional row; the twin is consumed.
    const pairedWith = new Map<number, number>()
    actions.forEach((action, at) => {
      if (action.kind !== 'create-link' || pairedWith.has(at)) return
      const target = targetOfLink(action.link)
      const self = groupOf(action).title
      const twin = actions.findIndex((other, otherAt) => otherAt > at
        && !pairedWith.has(otherAt)
        && other.kind === 'create-link'
        && groupOf(other).title === target
        && targetOfLink(other.link) === self)
      if (twin >= 0) {
        pairedWith.set(at, twin)
        pairedWith.set(twin, at)
      }
    })
    const rows: EntityRow[] = []
    const mergeInto = (groupKey: string, find: (row: EntityRow) => boolean, row: EntityRow): void => {
      const existing = rows.find(candidate => candidate.groupKey === groupKey && find(candidate))
      if (existing === undefined) {
        rows.push(row)
        return
      }
      const merged: EntityRow = {
        ...existing,
        indices: [...existing.indices, ...row.indices],
        detail: `${existing.detail}；${row.detail}`,
      }
      rows.splice(rows.indexOf(existing), 1, merged)
    }
    actions.forEach((action, localIndex) => {
      const index = base + localIndex
      const group = groupOf(action)
      if (action.kind === 'create-link') {
        const twinAt = pairedWith.get(localIndex)
        if (twinAt !== undefined && twinAt < localIndex) return // the twin renders with its earlier half
        const target = targetOfLink(action.link)
        const twinAction = twinAt !== undefined ? actions[twinAt] : undefined
        const twin = twinAction?.kind === 'create-link' ? twinAction : undefined
        const row: EntityRow = {
          indices: twinAt === undefined ? [index] : [index, base + twinAt],
          label: twin === undefined
            ? `${group.title} 页 新增链接 → [[${target}]]`
            : `${group.title} 页 新增链接 ↔ [[${target}]]（双向互链）`,
          detail: twin === undefined ? action.reason : `${action.reason}；${twin.reason}`,
          groupKey: group.key,
          groupTitle: group.title,
        }
        // 按（页，目标）核心匹配而不是整条 label：双向行的箭头是 ↔，
        // 单向谓词会漏掉重复出现的互链对（OCR review 2026-09-30）。
        mergeInto(group.key, candidate => candidate.label.startsWith(`${group.title} 页 新增链接 `)
          && candidate.label.includes(`[[${target}]]`), row)
        return
      }
      if (action.kind === 'append-log') {
        rows.push({
          indices: [index],
          label: `${group.title} 页 追加流水：${action.text}`,
          detail: action.reason,
          groupKey: group.key,
          groupTitle: group.title,
        })
        return
      }
      rows.push({
        indices: [index],
        label: labelOf(action),
        detail: detailOf(action, t),
        groupKey: group.key,
        groupTitle: group.title,
      })
    })
    return rows
  }

  /** One entity group of the validate layout, its rows sharing one checkbox apiece. */
  const renderEntityGroups = (actions: readonly ProposalAction[], base: number, keyPrefix: string): ReactElement[] => {
    const rows = entityRowsOf(actions, base)
    const groups: { readonly key: string; readonly title: string; readonly rows: readonly EntityRow[] }[] = []
    for (const row of rows) {
      const group = groups.find(candidate => candidate.key === row.groupKey)
      if (group === undefined) groups.push({ key: row.groupKey, title: row.groupTitle, rows: [row] })
      else groups[groups.indexOf(group)] = { ...group, rows: [...group.rows, row] }
    }
    return groups.map((group, at) => (
      <div key={`${keyPrefix}group-${at}`}>
        <div style={groupTitleStyle} data-proposal-entity-group={group.title}>{group.title}</div>
        {group.rows.map((row, rowIndex) => (
          <div key={rowIndex} style={rowStyle} data-proposal-row={row.indices.at(0)}>
            <input
              type="checkbox"
              aria-label={row.label}
              checked={row.indices.every(index => ticked.includes(index))}
              onChange={() => { toggleRow(row.indices) }}
            />
            <div style={{ minWidth: 0 }}>
              <div>{row.label}</div>
              {row.detail !== '' && <div style={detailStyle}>{row.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    ))
  }

  // The canonical tick order (ADR-0036 决定 6): prescan fixes first, then
  // the model's — the same sequence applyProposal resolves against.
  const allActions = allProposalActions(proposal)
  const all = (): void => {
    setTicked(allActions.map((_, index) => index))
  }
  const none = (): void => { setTicked([]) }
  const count = ticked.length
  const nothing = allActions.length === 0

  /**
   * One block's action groups, kind by kind; `base` shifts the row's flat
   * index — the deterministic rows occupy 0..n-1, the model's follow (the
   * applier resolves ticked indices over the same concatenation).
   */
  const renderGroups = (actions: readonly ProposalAction[], base: number, keyPrefix: string): (ReactElement | null)[] =>
    GROUP_ORDER.map((kind) => {
      const rows = actions
        .map((action, index) => ({ action, index: base + index }))
        .filter(row => row.action.kind === kind)
      if (rows.length === 0) return null
      return (
        <div key={`${keyPrefix}${kind}-${base}`}>
          <div style={groupTitleStyle} data-proposal-group={kind}>{t(GROUP_KEYS[kind])}</div>
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
                {detailOf(action, t) !== '' && <div style={detailStyle}>{detailOf(action, t)}</div>}
                {/* ADR-0034 决定 4: the create-project row's 领域勾选 — the
                    human adjusts the association before it is written. */}
                {action.kind === 'create-project' && proposal.areas !== undefined && proposal.areas.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }} data-proposal-areas={index}>
                    {proposal.areas.map((area) => {
                      const current = areaPicks[index] ?? action.areas ?? []
                      const on = current.includes(area)
                      return (
                        <label key={area} style={{ display: 'flex', gap: 3, alignItems: 'center', fontSize: 'var(--yt-type-label)' }}>
                          <input
                            type="checkbox"
                            aria-label={`${action.name}·${area}`}
                            checked={on}
                            onChange={() => { toggleArea(index, area, action.areas ?? []) }}
                          />
                          {area}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )
    })

  const prescan = proposal.prescan

  return (
    <div style={panelStyle} data-proposal-card="true">
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{proposal.title}</div>
        {proposal.note !== undefined && <div style={{ ...detailStyle, marginTop: 2 }}>{proposal.note}</div>}
        {proposal.highlights !== undefined && proposal.highlights.length > 0 && (
          <div data-proposal-highlights="true">
            <div style={focusTitleStyle}>{t('proposal.highlight')}</div>
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
            <div style={groupTitleStyle}>{t('proposal.digest')}</div>
            {proposal.digest.map((entry, index) => (
              <div key={index} style={detailStyle}>
                {entry.sender}：{entry.subject} — {entry.why}
              </div>
            ))}
          </div>
        )}
        {/* The deterministic block (ADR-0036 决定 2/6): zero-token prescan
            rows and fix candidates, above everything the model said, in the
            same calm grey as any group title — no alarm colour, nothing here
            needs the human's suspicion. Folded into a one-line summary
            (2026-09-30 修订): the detail opens on demand. Hidden whole when
            empty. */}
        {prescan !== undefined && (prescan.orphans.length > 0 || prescan.findings.length > 0 || prescan.actions.length > 0) && (
          <div data-proposal-prescan="true">
            <div style={summaryRowStyle}>
              <div style={groupTitleStyle}>{t('proposal.prescanFindings')}</div>
              <span style={summaryTextStyle} data-proposal-prescan-summary="true">
                {t('proposal.prescanSummary', {
                  orphans: prescan.orphans.length,
                  broken: prescan.findings.length,
                  fixes: prescan.actions.length,
                })}
              </span>
              <button
                type="button"
                style={toggleStyle}
                data-proposal-prescan-toggle="true"
                onClick={() => { setPrescanOpen(open => !open) }}
              >
                {prescanOpen ? t('proposal.collapse') : t('proposal.expand')}
              </button>
            </div>
            {prescanOpen && (
              <div data-proposal-prescan-detail="true">
                {prescan.orphans.map((orphan, index) => (
                  <div key={`orphan-${index}`} style={detailStyle} data-proposal-orphan={orphan.name}>
                    {orphan.name}（{orphan.type}，{t('proposal.orphanIncoming', { count: orphan.incoming })}）
                  </div>
                ))}
                {prescan.findings.map((finding, index) => (
                  <div key={`finding-${index}`} style={detailStyle} data-proposal-finding={finding.kind}>
                    {finding.subject} — {finding.why}
                  </div>
                ))}
                {renderEntityGroups(prescan.actions, 0, 'prescan-')}
              </div>
            )}
          </div>
        )}
        {/* The model block: the diagnostician's semantic rows and link
            suggestions, in the findings style the card always had. */}
        {proposal.findings !== undefined && proposal.findings.length > 0 && (
          <div data-proposal-findings="true">
            <div style={groupTitleStyle}>{t('proposal.modelFindings')}</div>
            {proposal.findings.map((finding, index) => (
              <div key={index} style={detailStyle} data-proposal-finding={finding.kind}>
                {finding.subject} — {finding.why}
              </div>
            ))}
          </div>
        )}
        {nothing && <div style={{ ...detailStyle, marginTop: 10 }}>{t('proposal.empty')}</div>}
        {/* The model block's base is where its rows start in the canonical
            tick order — prescan length under the disjoint contract, derived
            from the one concatenation rather than re-derived here. The
            validate card renders its actions grouped by target entity
            (2026-09-30 修订); the other gestures keep the kind-grouped face. */}
        {prescan !== undefined
          ? (
            <>
              {proposal.actions.length > 0 && <div style={groupTitleStyle}>{t('proposal.suggestions')}</div>}
              {renderEntityGroups(proposal.actions, allActions.length - proposal.actions.length, 'model-')}
            </>
          )
          : renderGroups(proposal.actions, allActions.length - proposal.actions.length, 'model-')}
        {props.onInstruction !== undefined && (
          <div style={instructionStyle} data-validate-instruction="true">
            <input
              type="text"
              style={inputStyle}
              placeholder={t('proposal.instructionPlaceholder')}
              data-validate-instruction-input="true"
              disabled={sending || props.busy === true}
              value={draft}
              onChange={(event) => { setDraft(event.target.value) }}
              onKeyDown={(event) => {
                // IME 组合中的回车（选字确认）不是发送指令。
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') { void sendInstruction() }
              }}
            />
            <button
              type="button"
              style={buttonStyle}
              data-validate-instruction-send="true"
              disabled={sending || props.busy === true || draft.trim() === ''}
              onClick={() => { void sendInstruction() }}
            >
              {t('proposal.instructionSend')}
            </button>
          </div>
        )}
        <div style={footerStyle}>
          <button type="button" style={buttonStyle} disabled={props.busy === true || nothing} onClick={all}>
            {t('proposal.acceptAll')}
          </button>
          <button type="button" style={buttonStyle} disabled={props.busy === true} onClick={none}>
            {t('proposal.ignoreAll')}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={buttonStyle} disabled={props.busy === true} onClick={props.onDismiss}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={buttonStyle}
            disabled={props.busy === true || count === 0}
            onClick={() => { props.onConfirm(ticked, Object.keys(areaPicks).length > 0 ? areaPicks : undefined) }}
          >
            {t('proposal.confirmWrite', { count })}
          </button>
        </div>
      </div>
    </div>
  )
}
