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
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Proposal, ProposalAction } from './proposal.ts'
import { allProposalActions, GROUP_KEYS } from './proposal.ts'
import { lineDiff, type DiffRow } from './diff.ts'
import { useDialogModal } from './use-dialog-modal.ts'
import { ghostButtonStyle, primaryButtonDisabledStyle, primaryButtonStyle } from './buttons.ts'
import { entityNameOf } from './validate.ts'
import { bareSubject } from './mail-threads.ts'
import { PROPOSAL_MODAL_ID, proposalVerdictSeat, type ProposalVerdictHandler } from './proposal-verdict-seat.ts'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'

const panelStyle = {
  position: 'absolute',
  inset: 0,
  // 幕布随主题取色（--yt-scrim，2026-10-09）——见 ConfigDialog 同款注释。
  background: 'var(--yt-scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
} as const

const cardStyle = {
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 10,
  padding: 'var(--yt-space-4)',
  width: 'min(560px, 92vw)',
  maxHeight: '80vh',
  // 头底固定、仅中段滚动（2026-10-09 评审 P2）：此前整卡 overflow:auto，
  // 大批量邮件会把裁决页脚卷出视野，勾完最后一行回头找不到按钮。
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: 'var(--yt-shadow-overlay)',
  // 卡自身接收初始焦点（tabIndex=-1）；轮廓交给卡内的真控件去画。
  outline: 'none',
} as const

/** The card's scrollable middle: everything between the title block and the
    verdict footer — the footer (确认写入（N）) never leaves the viewport. */
const cardScrollStyle = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  // 吃掉卡自身的左右 padding，让滚动条贴卡缘；内容再用 padding 补回。
  margin: '0 calc(-1 * var(--yt-space-4))',
  padding: '0 var(--yt-space-4)',
} as const

// 层级秩序（2026-09-30 展示修订）：片区有物理边界，组头是全卡最大的字，
// 来源分层是胶囊，行文本与其下的 detail 靠字号与颜色自然分层——父级永远
// 比子级大且深，不再倒挂。
const groupContainerStyle = {
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 8,
  padding: 'var(--yt-space-2)',
  marginTop: 'var(--yt-space-2)',
} as const

const groupTitleStyle = { margin: '0 0 var(--yt-space-2)', fontSize: 'var(--yt-type-section)', fontWeight: 600, color: 'var(--yt-text-primary)' } as const

/** A section title sitting outside any group envelope (findings, suggestions). */
const sectionTitleStyle = { ...groupTitleStyle, margin: 'var(--yt-space-3) 0 var(--yt-space-1)' } as const

/** A folded block's title inside the flex header row (digest, prescan): no margins —
    the row's own alignment decides. */
const foldTitleStyle = { ...groupTitleStyle, margin: 0 } as const

const focusTitleStyle = { margin: 'var(--yt-space-3) 0 var(--yt-space-1)', fontSize: 'var(--yt-type-section)', fontWeight: 700, color: 'var(--yt-error)' } as const

const focusRowStyle = {
  display: 'flex',
  gap: 'var(--yt-space-2)',
  alignItems: 'baseline',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  background: 'var(--yt-error-bg)',
  borderRadius: 6,
  fontSize: 'var(--yt-type-label)',
} as const

const rowStyle = { display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'flex-start', padding: 'var(--yt-space-1) 0' } as const

const detailStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const summaryRowStyle = { display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'center', padding: 'var(--yt-space-1) 0' } as const

const summaryTextStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const toggleStyle = {
  padding: '0 var(--yt-space-2)',
  fontSize: 'var(--yt-type-label)',
  color: 'var(--yt-text-secondary)',
  background: 'transparent',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  cursor: 'pointer',
} as const

/** A per-mail layer's sub-header inside a creation group (ADR-0038 决定 7) —
   a chip, so the middle layer can neither pass for the group header above
   nor for the detail lines below. The text truncates single-line: the layer
   checkbox's aria-label and the title attribute still carry the full subject. */
const subHeaderStyle = {
  display: 'inline-flex',
  gap: 'var(--yt-space-2)',
  alignItems: 'center',
  margin: 'var(--yt-space-1) 0',
  padding: '0 var(--yt-space-2)',
  maxWidth: '100%',
  fontSize: 'var(--yt-type-label)',
  fontWeight: 600,
  color: 'var(--yt-text-secondary)',
  background: 'var(--yt-accent-bg)',
  border: '1px solid var(--yt-accent-border)',
  borderRadius: 10,
} as const

/** The layer chip's subject text: one line, ellipsized. */
const subHeaderTextStyle = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
} as const

/** A creation row's swallowed supplement (ADR-0038 决定 8): the section name
   as a mini chip ahead of the text, so 决议/待办 scan as keywords instead of
   dissolving into one long 「并补充…」sentence. Same chip vocabulary as the
   mail layer header, quieter (4px radius, no 600-weight sentence). */
const supplementChipStyle = {
  display: 'inline-block',
  marginRight: 'var(--yt-space-2)',
  padding: '0 var(--yt-space-1)',
  fontWeight: 600,
  color: 'var(--yt-text-secondary)',
  background: 'var(--yt-accent-bg)',
  border: '1px solid var(--yt-accent-border)',
  borderRadius: 4,
} as const

/** A mail layer's rows indent under their chip, so the layer reads as a layer
   and not as a run of sibling rows (P1: chip and rows used to share one left edge). */
const layerRowsStyle = { paddingLeft: 'var(--yt-space-4)' } as const

const instructionStyle = {
  display: 'flex',
  gap: 'var(--yt-space-2)',
  marginTop: 'var(--yt-space-3)',
  paddingTop: 'var(--yt-space-2)',
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

const inputStyle = {
  flex: 1,
  minWidth: 0,
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
} as const

/** 主/次钮面孔与 disabled 弱化收敛到 ./buttons.ts —— 全 UI 一套（2026-10-05）。 */

const footerStyle = {
  display: 'flex',
  gap: 'var(--yt-space-2)',
  alignItems: 'center',
  flexShrink: 0,
  marginTop: 'var(--yt-space-4)',
  paddingTop: 'var(--yt-space-2)',
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

/** Esc 武装警示条（2026-10-09）：警告语义走语义色 token，不新造颜色。 */
const escArmStyle = {
  margin: 0,
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderRadius: 6,
  background: 'var(--yt-warning-bg)',
  color: 'var(--yt-warning-text)',
  fontSize: 'var(--yt-type-label)',
  flexShrink: 0,
} as const

/** The kinds in the order the card lists their groups. */
const GROUP_ORDER: readonly ProposalAction['kind'][] = [
  'create-entity', 'create-project', 'add-todo', 'append-log', 'write-state', 'edit-section', 'append-section', 'create-link', 'save-resource', 'add-memory', 'delete-mails', 'archive-mails', 'skill-rewrite',
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
    case 'archive-mails': return action.subject
    case 'skill-rewrite': return action.file
  }
}

/**
 * One row's main text, with the append-section override (ADR-0038 决定 8):
 * the label names the entity it lands in — resolved path, or the after-create
 * companion when the creation row carries it — followed by the section.
 */
function rowLabelOf(action: ProposalAction): string {
  if (action.kind !== 'append-section') return labelOf(action)
  const entityName = entityNameOf(action.path)
  const owner = entityName !== '' ? entityName : action.afterCreate ?? action.path
  return `${owner} · ${action.section}`
}

/** One row's explanation — why the agent proposes this. `hasAreasControl`
 * tells the create-project case the card renders the editable 领域勾选 grid,
 * so the detail text must not repeat the association (the two would contradict
 * each other the moment the human reticks a box). */
function detailOf(action: ProposalAction, t: WorkbenchT, hasAreasControl = false): string {
  if (action.kind === 'edit-section') return `${action.path}：${action.why}`
  // ADR-0038 决定 9: the supplement's detail is the text that would land, not
  // the why (which repeats the creation's reason); the source mail rides ahead.
  if (action.kind === 'append-section') {
    return action.mailSubject !== undefined ? `来自「${action.mailSubject}」：${action.text}` : action.text
  }
  if (action.kind === 'delete-mails') return `${action.sender}：${action.reason}`
  if (action.kind === 'archive-mails') return `${action.sender}：${action.summary || action.reason}`
  if (action.kind === 'skill-rewrite') return `${action.name}：${action.why}`
  // ADR-0059 决定 3（追认 ADR-0038 决定 9 为全体实体动作的通则）：实体落点
  // 行的 detail 是将落地的 text——批准者必须看见要写进流水/状态的字，
  // reason 收进次级；带溯源时行尾附来源（可点开的并排对照随 P2 的 diff 视图）。
  if (action.kind === 'append-log' || action.kind === 'write-state') {
    const source = action.sourcePath !== undefined && action.sourcePath !== '' ? `（来源：${action.sourcePath}）` : ''
    const why = action.reason !== '' ? `；理由：${action.reason}` : ''
    return `${action.text}${source}${why}`
  }
  if (action.kind === 'create-project') {
    if (hasAreasControl) return action.reason
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

/** The skill-rewrite diff block's styles: monospace, quietly striped. */
const diffBoxStyle = {
  margin: 'var(--yt-space-1) 0 var(--yt-space-1)',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  background: 'var(--yt-surface-secondary)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  // 2026-10-09 评审：裸 'monospace' 是全卡唯一的外来字体痕迹，回归
  // --yt-font-code（路径/ID/diff 的正典代码字体栈）。
  fontFamily: 'var(--yt-font-code)',
  fontSize: 'var(--yt-type-label)',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxWidth: '100%',
  overflowX: 'auto',
} as const

const diffDelStyle = { background: 'var(--yt-error-bg)', color: 'var(--yt-error)' } as const
const diffAddStyle = { background: 'var(--yt-accent-bg)' } as const
const diffSameStyle = { color: 'var(--yt-text-secondary)' } as const
const diffOmittedStyle = { color: 'var(--yt-text-secondary)' } as const

/** Paint for one diff row: removal red, addition accent, unchanged context grey. */
function rowStyleOf(type: DiffRow['type']): typeof diffDelStyle | typeof diffAddStyle | typeof diffSameStyle {
  if (type === 'del') return diffDelStyle
  if (type === 'add') return diffAddStyle
  return diffSameStyle
}

/** The line prefix a diff row reads with — git's vocabulary. */
function rowPrefixOf(type: DiffRow['type']): string {
  if (type === 'del') return '- '
  if (type === 'add') return '+ '
  return '  '
}

/**
 * One skill-rewrite row's folded diff (ADR-0054): closed by default — the
 * label and why suffice to judge whether to look; opening it renders the
 * plain line diff, `-` for the original's lines and `+` for the proposed
 * ones, unchanged context in grey. The toggle holds its own open state.
 */
function SkillDiffBlock(props: { readonly original: string; readonly next: string; readonly t: WorkbenchT }): ReactElement {
  const { t } = props
  const [open, setOpen] = useState(false)
  // The LCS runs only when the human actually opens the block: a folded diff
  // must cost nothing on render, however large the envelope (the kb tool caps
  // each side at 200k chars — a full DP table for that is main-thread death).
  const diff = useMemo(
    () => (open ? lineDiff(props.original, props.next) : undefined),
    [open, props.original, props.next],
  )
  return (
    <div data-proposal-diff="true">
      <button data-hover="true"
        type="button"
        style={toggleStyle}
        data-proposal-diff-toggle="true"
        onClick={() => { setOpen(o => !o) }}
      >
        {open ? t('proposal.diffHide') : t('proposal.diffView')}
      </button>
      {diff !== undefined && (
        <div style={diffBoxStyle} data-proposal-diff-body="true">
          {diff.omitted > 0 && <div style={diffOmittedStyle}>{t('proposal.diffOmitted', { count: diff.omitted })}</div>}
          {diff.rows.map((row, index) => (
            <div
              key={index}
              style={rowStyleOf(row.type)}
              data-proposal-diff-row={row.type}
            >
              {rowPrefixOf(row.type) + row.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
 *   revised proposal, as many rounds as wanted. `onDiscard`, when given (the
 *   提议收件箱 card, ADR-0047), turns the footer's 取消 into 丢弃 — in the
 *   inbox a card left without approving *is* a discard (2026-10-05 验收修正：
 *   取消即丢弃，不让人再点第二次), so the two ghosts collapse into one button
 *   and Esc takes the same verdict; without `onDiscard` the cancel keeps its
 *   close-only sense.
 * @returns the card element.
 */
export function ProposalCard(props: {
  readonly proposal: Proposal
  readonly onConfirm: (ticked: readonly number[], areaPicks?: Readonly<Record<number, readonly string[]>>) => void
  /** The close-only escape — required unless `onDiscard` replaces it (ADR-0047 验收修正). */
  readonly onDismiss?: () => void
  /** The free-input continuation — present only when the run can take instructions. */
  readonly onInstruction?: (text: string) => Promise<void>
  /** The explicit 丢弃 verdict (ADR-0047) — renders the ghost beside the primary confirm. */
  readonly onDiscard?: () => void
  /**
   * The registered capabilities' names (2026-10-10 分流提示): an add-memory
   * row scoped to one of them carries the rewrite-or-remember hint — the
   * morning accident taught that a behavior rule aimed at a capability's own
   * files usually belongs in a skill-rewrite, not in memory.
   */
  readonly capabilityScopes?: readonly string[]
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
  // The digest block folds too (ADR-0038 决定 1): routine notices summarize
  // to a count line; the rows open on demand.
  const [digestOpen, setDigestOpen] = useState(false)
  // The free-input box's draft and its in-flight state.
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // Esc 武装（2026-10-09 第四轮评审 P1）：已勾选若干行后，Esc 误触不应
  // 一键抹掉半个裁决——第一次 Esc 只亮警示条（4 秒内再按才算丢弃），
  // 空手时 Esc 保持一等逃生口的原义。
  const [escArmed, setEscArmed] = useState(false)
  // 模态语义（2026-10-05 补课，行为收进 useDialogModal）：提案卡是全 UI
  // 最高危的裁决面——读屏必须能感知它的存在（role=dialog + aria-modal），
  // Tab 必须被关在卡里，Esc 必须是一等逃生口。busy 时 Esc 不动：确认在途，
  // 半路丢弃会让「写了什么」变得不可知。
  const { cardRef, onPanelKeyDown } = useDialogModal({
    busy: props.busy === true,
    // ADR-0047 验收修正: in the inbox Esc *is* the discard — the same
    // verdict as the footer's 丢弃, never a silent non-decision.
    // 2026-10-09: with rows ticked the first Esc only arms; the second
    // one within the window takes the verdict (Riley 红旗：深夜批量裁决
    // 手滑 Esc，整卡蒸发不知丢了什么).
    onClose: () => {
      if (ticked.length > 0 && !escArmed) { setEscArmed(true); return }
      if (props.onDiscard !== undefined) props.onDiscard()
      else props.onDismiss?.()
    },
  })
  // The armed window is short on purpose: long enough to press Esc again,
  // short enough that the card never sits in a hair-trigger state.
  useEffect(() => {
    if (!escArmed) return
    const timer = window.setTimeout(() => { setEscArmed(false) }, 4000)
    return () => { window.clearTimeout(timer) }
  }, [escArmed])
  // A revision round produces a proposal with different *content*; the tick
  // state of the previous round must not leak into it (OCR review 2026-09-30).
  // Content, not object identity (2026-10-09 修正): the inbox pane re-parses
  // the same stored payload into a fresh proposal object on every render —
  // the 30s schedule scan's loadInbox wiped an open card's ticks within one
  // poll. An unchanged proposal must not reset the human's half-made verdict.
  const fingerprint = useMemo(() => JSON.stringify(proposal), [proposal])
  const settledFingerprint = useRef(fingerprint)

  // 键盘裁决路径（2026-10-12 评审 P2-1 批次一；复检 P2 转正）：J/K 移光标、
  // Space 勾选、Enter 确认写入。光标是纯导航——高亮当前行、滚进视野，从不
  // 代替人做裁决；Space/Enter 都是对卡内真控件的合成点击，勾选状态与确认
  // 闸门（count===0 / busy）仍然只有一条通路。行几何跟着折叠态走，所以每次
  // 按键都现查 [data-proposal-row]。光标存行的首个动作索引（data-proposal-row
  // 的戳），高亮由行样式三元声明（复检 P2：不再私改 row.style 与 React 抢笔）。
  const [cursor, setCursor] = useState(-1)
  const cursorRef = useRef(-1)
  const seekCursor = (stamp: number): void => { cursorRef.current = stamp; setCursor(stamp) }
  const cursorStamps = (): readonly number[] =>
    cardRef.current === null ? [] : Array.from(cardRef.current.querySelectorAll<HTMLElement>('[data-proposal-row]'))
      .map(row => Number(row.dataset.proposalRow))
  const moveCursor = (delta: 1 | -1): void => {
    const stamps = cursorStamps()
    if (stamps.length === 0) return
    const at = stamps.indexOf(cursorRef.current)
    const next = at < 0 ? (delta === 1 ? 0 : stamps.length - 1)
      : Math.min(stamps.length - 1, Math.max(0, at + delta))
    seekCursor(stamps[next] ?? -1)
  }
  // 光标挪窝后把行滚进视野；高亮本身交给重渲染的行样式三元。
  useEffect(() => {
    if (cursor < 0) return
    cardRef.current?.querySelector<HTMLElement>(`[data-proposal-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])
  const verdictHandler = useMemo<ProposalVerdictHandler>(() => ({
    moveDown: () => { moveCursor(1) },
    moveUp: () => { moveCursor(-1) },
    toggleTick: () => {
      cardRef.current
        ?.querySelector<HTMLElement>(`[data-proposal-row="${cursorRef.current}"]`)
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click()
    },
    confirmWrite: () => {
      const button = cardRef.current?.querySelector<HTMLButtonElement>('[data-proposal-confirm]')
      if (button != null && !button.disabled) button.click()
    },
  }), [])
  // 占住键盘座位：卡片活着才应答，卸载即让位（收件箱换卡、验证卡关闭）。
  useEffect(() => {
    proposalVerdictSeat.current = verdictHandler
    return () => { if (proposalVerdictSeat.current === verdictHandler) proposalVerdictSeat.current = null }
  }, [verdictHandler])

  useEffect(() => {
    if (settledFingerprint.current === fingerprint) return
    settledFingerprint.current = fingerprint
    setTicked([])
    setAreaPicks({})
    setPrescanOpen(false)
    setDigestOpen(false)
    setEscArmed(false)
    seekCursor(-1)
  }, [fingerprint])

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
          // ADR-0059 决定 3：校验布局的标签已带落地 text，detail 保持
          // reason 次级；溯源照样行尾附——两个布局看到同样的出处。
          detail: action.sourcePath !== undefined && action.sourcePath !== ''
            ? `${action.reason}（来源：${action.sourcePath}）`
            : action.reason,
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
      <div key={`${keyPrefix}group-${at}`} style={groupContainerStyle}>
        <div style={groupTitleStyle} data-proposal-entity-group={group.title}>{group.title}</div>
        {group.rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            style={row.indices.at(0) === cursor ? { ...rowStyle, background: 'var(--yt-accent-bg)' } : rowStyle}
            aria-current={row.indices.at(0) === cursor ? 'true' : undefined}
            data-proposal-row={row.indices.at(0)}
          >
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
   *
   * ADR-0038 reshapes the mail face three ways. 决定 8: an `append-section`
   * row that trails a creation merges into that creation's row — one checkbox
   * ticks both, because the create decision is what makes the supplement
   * meaningful. 决定 7: the creation groups layer per source mail, each layer
   * headed by a select-all checkbox over the subject it came from. 决定 10:
   * every group header carries a three-state select-all.
   */
  const renderGroups = (actions: readonly ProposalAction[], base: number, keyPrefix: string): (ReactElement | null)[] => {
    // 决定 8: pair each afterCreate supplement with its creation row; the
    // swallowed rows leave the 章节补充 group and render inside their create.
    const supplementsOf = new Map<number, { readonly section: string; readonly text: string; readonly index: number }[]>()
    const swallowed = new Set<number>()
    actions.forEach((action, index) => {
      if (action.kind !== 'append-section' || action.afterCreate === undefined) return
      const createAt = actions.findIndex(other =>
        (other.kind === 'create-entity' || other.kind === 'create-project') && other.name === action.afterCreate)
      if (createAt < 0) return
      swallowed.add(index)
      const lines = supplementsOf.get(createAt) ?? []
      supplementsOf.set(createAt, [...lines, { section: action.section, text: action.text, index: base + index }])
    })
    return GROUP_ORDER.map((kind) => {
      const rows = actions
        .map((action, index) => ({ action, index: base + index }))
        .filter(row => row.action.kind === kind && !swallowed.has(row.index - base))
      if (rows.length === 0) return null
      // 决定 7: creation rows layer per source mail, in first-seen order;
      // rows without provenance fall into one unheaded layer.
      const layers: { readonly subject: string | undefined; readonly rows: typeof rows }[] = []
      for (const row of rows) {
        const subject = (row.action.kind === 'create-entity' || row.action.kind === 'create-project') && row.action.mailSubject !== undefined
          ? row.action.mailSubject
          : undefined
        const layer = layers.find(candidate => candidate.subject === subject)
        if (layer === undefined) layers.push({ subject, rows: [row] })
        else layers[layers.indexOf(layer)] = { ...layer, rows: [...layer.rows, row] }
      }
      const groupIndices = rows.flatMap(row => [row.index, ...(supplementsOf.get(row.index - base) ?? []).map(line => line.index)])
      const allOn = groupIndices.every(index => ticked.includes(index))
      const someOn = groupIndices.some(index => ticked.includes(index))
      return (
        <div key={`${keyPrefix}${kind}-${base}`} style={groupContainerStyle}>
          <div style={groupTitleStyle} data-proposal-group={kind}>
            {/* 决定 10: three-state select-all over the whole group. */}
            <input
              type="checkbox"
              aria-label={t(GROUP_KEYS[kind])}
              checked={allOn}
              ref={(el) => { if (el !== null) el.indeterminate = !allOn && someOn }}
              onChange={() => { toggleRow(groupIndices) }}
            />
            {t(GROUP_KEYS[kind])}
          </div>
          {layers.map((layer, layerAt) => {
            const linesOf = (row: { readonly index: number }): readonly number[] =>
              (supplementsOf.get(row.index - base) ?? []).map(line => line.index)
            const layerIndices = layer.rows.flatMap(row => [row.index, ...linesOf(row)])
            const layerAllOn = layerIndices.every(index => ticked.includes(index))
            const layerSomeOn = layerIndices.some(index => ticked.includes(index))
            return (
              <div key={layerAt}>
                {layer.subject !== undefined && (
                  <div style={subHeaderStyle} data-proposal-mail-layer={layer.subject} title={layer.subject}>
                    <input
                      type="checkbox"
                      aria-label={layer.subject}
                      checked={layerAllOn}
                      ref={(el) => { if (el !== null) el.indeterminate = !layerAllOn && layerSomeOn }}
                      onChange={() => { toggleRow(layerIndices) }}
                    />
                    <span style={subHeaderTextStyle}>{bareSubject(layer.subject) || layer.subject}</span>
                  </div>
                )}
                <div style={layer.subject !== undefined ? layerRowsStyle : undefined}>
                  {layer.rows.map(({ action, index }) => {
                    const supplements = supplementsOf.get(index - base) ?? []
                    const rowIndices = [index, ...supplements.map(line => line.index)]
                    const label = rowLabelOf(action)
                    const areasControl = action.kind === 'create-project' && proposal.areas !== undefined && proposal.areas.length > 0
                    const detail = detailOf(action, t, areasControl)
                    return (
                      <div
                        key={index}
                        style={index === cursor ? { ...rowStyle, background: 'var(--yt-accent-bg)' } : rowStyle}
                        aria-current={index === cursor ? 'true' : undefined}
                        data-proposal-row={index}
                      >
                        <input
                          type="checkbox"
                          aria-label={label}
                          checked={rowIndices.every(entry => ticked.includes(entry))}
                          onChange={() => { toggleRow(rowIndices) }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div>{label}</div>
                          {detail !== '' && <div style={detailStyle}>{detail}</div>}
                          {/* 2026-10-10 分流提示：指向已注册能力的 add-memory 行
                            附一句改道建议——记忆是行为的兜底，能力自身文件的病
                            该由 skill-rewrite 治（当日晨间事故的教训）。 */}
                          {action.kind === 'add-memory'
                            && props.capabilityScopes?.includes(action.scope) === true && (
                            <div style={detailStyle} data-proposal-memory-hint={index}>
                              {t('proposal.memoryRewriteHint')}
                            </div>
                          )}
                          {/* ADR-0054: the skill-rewrite row's folded diff — the
                            无 diff 不成卡 envelope rendered where the human judges it. */}
                          {action.kind === 'skill-rewrite' && (
                            <SkillDiffBlock original={action.original} next={action.new} t={t} />
                          )}
                          {supplements.map((line, lineAt) => (
                            <div key={lineAt} style={detailStyle} data-proposal-supplement={line.section}>
                              <span style={supplementChipStyle}>{line.section}</span>{line.text}
                            </div>
                          ))}
                          {/* ADR-0034 决定 4: the create-project row's 领域勾选 — the
                            human adjusts the association before it is written. The
                            muted label names the control (the detail text no longer
                            repeats it); the grid keeps wrapped rows on an even mesh
                            instead of orphaning one box per line. */}
                          {areasControl && proposal.areas !== undefined && (
                            <div style={{ display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'baseline', marginTop: 'var(--yt-space-1)' }} data-proposal-areas={index}>
                              <span style={detailStyle}>{t('proposal.areas')}</span>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 'var(--yt-space-1) var(--yt-space-2)', flex: 1 }}>
                                {proposal.areas.map((area) => {
                                  const current = areaPicks[index] ?? action.areas ?? []
                                  const on = current.includes(area)
                                  return (
                                    <label key={area} style={{ display: 'flex', gap: 'var(--yt-space-1)', alignItems: 'center', fontSize: 'var(--yt-type-label)' }}>
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
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )
    })
  }

  const prescan = proposal.prescan

  return (
    <div style={panelStyle} data-proposal-card="true" onKeyDown={onPanelKeyDown}>
      <div
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-label={proposal.title}
        tabIndex={-1}
        ref={cardRef}
        // 固定键仲裁的模态身份：shortcuts 的 DOM 适配器据此把 J/K/Space/Enter
        // 记到提案卡名下（顶层模态才生效）。
        data-shortcut-modal={PROPOSAL_MODAL_ID}
      >
        {/* 键盘光标的 sr 播报：J/K 移动时向读屏器宣布位置；视觉用户靠
          aria-current 行底色，读屏用户听这里。 */}
        {cursor >= 0 && (() => {
          const stamps = cursorStamps()
          const at = stamps.indexOf(cursor)
          return at >= 0 && (
            <span
              aria-live="polite"
              style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
            >
              {t('proposal.cursorAnnounce', { position: at + 1, total: stamps.length })}
            </span>
          )
        })()}
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--yt-type-title)', fontWeight: 600 }}>{proposal.title}</div>
          {proposal.note !== undefined && <div style={{ ...detailStyle, marginTop: 'var(--yt-space-1)' }}>{proposal.note}</div>}
        </div>
        <div style={cardScrollStyle}>
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
          {/* ADR-0038 决定 1: routine notices fold to a count line — the rows
            open on demand, the same calm pattern the prescan block uses. */}
          {proposal.digest !== undefined && proposal.digest.length > 0 && (
            <div data-proposal-digest="true">
              <div style={summaryRowStyle}>
                <div style={foldTitleStyle}>{t('proposal.digest')}</div>
                <span style={summaryTextStyle} data-proposal-digest-count="true">
                  {t('proposal.digestSummary', { count: proposal.digest.length })}
                </span>
                <button data-hover="true"
                  type="button"
                  style={toggleStyle}
                  data-proposal-digest-toggle="true"
                  onClick={() => { setDigestOpen(open => !open) }}
                >
                  {digestOpen ? t('proposal.collapse') : t('proposal.expand')}
                </button>
              </div>
              {digestOpen && proposal.digest.map((entry, index) => (
                <div key={index} style={detailStyle} data-proposal-digest-row={index}>
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
                <div style={foldTitleStyle}>{t('proposal.prescanFindings')}</div>
                <span style={summaryTextStyle} data-proposal-prescan-summary="true">
                  {t('proposal.prescanSummary', {
                    orphans: prescan.orphans.length,
                    broken: prescan.findings.length,
                    fixes: prescan.actions.length,
                  })}
                </span>
                <button data-hover="true"
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
              <div style={sectionTitleStyle}>{t('proposal.modelFindings')}</div>
              {proposal.findings.map((finding, index) => (
                <div key={index} style={detailStyle} data-proposal-finding={finding.kind}>
                  {finding.subject} — {finding.why}
                </div>
              ))}
            </div>
          )}
          {nothing && <div style={{ ...detailStyle, marginTop: 'var(--yt-space-2)' }}>{t('proposal.empty')}</div>}
          {/* The model block's base is where its rows start in the canonical
            tick order — prescan length under the disjoint contract, derived
            from the one concatenation rather than re-derived here. The
            validate card renders its actions grouped by target entity
            (2026-09-30 修订); the other gestures keep the kind-grouped face. */}
          {prescan !== undefined
            ? (
              <>
                {proposal.actions.length > 0 && <div style={sectionTitleStyle}>{t('proposal.suggestions')}</div>}
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
                style={ghostButtonStyle}
                data-validate-instruction-send="true"
                data-hover="true"
                disabled={sending || props.busy === true || draft.trim() === ''}
                onClick={() => { void sendInstruction() }}
              >
                {t('proposal.instructionSend')}
              </button>
            </div>
          )}
        </div>
        {escArmed && (
          <p style={escArmStyle} role="alert" data-proposal-esc-arm="true">
            {t('proposal.escArm', { count: ticked.length })}
          </p>
        )}
        <div style={footerStyle}>
          <button type="button" style={ghostButtonStyle} data-hover="true" disabled={props.busy === true || nothing} onClick={all}>
            {t('proposal.acceptAll')}
          </button>
          <button type="button" style={ghostButtonStyle} data-hover="true" disabled={props.busy === true} onClick={none}>
            {t('proposal.ignoreAll')}
          </button>
          <span style={{ flex: 1 }} />
          {/* ADR-0047 验收修正: with onDiscard the cancel ghost *becomes* the
              丢弃 verdict — one button, one meaning; the separate discard
              ghost beside it was a second click for the same judgement. */}
          {props.onDiscard !== undefined ? (
            <button
              type="button"
              style={ghostButtonStyle}
              data-inbox-discard="true"
              data-hover="true"
              disabled={props.busy === true}
              onClick={props.onDiscard}
            >
              {t('inbox.discard')}
            </button>
          ) : (
            <button type="button" style={ghostButtonStyle} data-hover="true" disabled={props.busy === true} onClick={() => { props.onDismiss?.() }}>
              {t('common.cancel')}
            </button>
          )}
          <button
            type="button"
            data-hover="primary"
            data-proposal-confirm="true"
            style={props.busy === true || count === 0 ? primaryButtonDisabledStyle : primaryButtonStyle}
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
