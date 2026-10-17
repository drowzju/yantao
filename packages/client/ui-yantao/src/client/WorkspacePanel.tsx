/**
 * The workspace management view (ADR-0056): every space's directory binding
 * and instruction chain laid out — each editable, runnable on demand, and
 * each running chain stoppable. Below the definitions sits the run-history
 * ring, polled while any run is live so the status flips stay visible
 * (ADR-0056 决定 7: 状态翻转 + 最终结果 + 历史).
 *
 * The human is the author here (ADR-0056 决定 1: 纯人通道), so writes go
 * straight through `workspaceSave` — creating an instruction IS the approval,
 * no proposal queue. The full-list save keeps add/edit/delete one seam, the
 * same recipe as the schedule pane; the host preserves the tick-owned stamps
 * the editor never authors.
 *
 * Ids are minted client-side (`wsp_`/`ins_<base36 ms>_<random>`): the store
 * requires them, and the instruction id's embedded creation time is the
 * controller tick's baseline fallback — a foreign id shape would make a fresh
 * cron instruction instantly "miss" a window that passed before it existed.
 * @module @deepseek-ai/dsh-client-ui-yantao/WorkspacePanel
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  KbWorkspace, KbWorkspaceInstruction, KbWorkspaceRun,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { remoteMessage, type WorkspaceLister, type WorkspaceRunner, type WorkspaceRunDeleter, type WorkspaceRunsClearer, type WorkspaceRunsLister, type WorkspaceRunStopper, type WorkspaceSaver } from './remote.ts'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'
import { ghostButtonStyle, primaryButtonStyle, toolButtonArmedStyle, toolButtonStyle } from './buttons.ts'
import { useArmedAction } from './use-armed-action.ts'
import { formatStamp } from './stamp.ts'
import { cronNextFire, parseCron } from './cron.ts'

/** What the panel needs: the five workspace RPCs, already bound to the context. */
export interface WorkspacePanelProps {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** List the workspaces. */
  readonly list: WorkspaceLister
  /** Replace the whole workspace list. */
  readonly save: WorkspaceSaver
  /** Trigger one instruction now. */
  readonly run: WorkspaceRunner
  /** Kill one running chain. */
  readonly stop: WorkspaceRunStopper
  /** Read the run-history ring. */
  readonly listRuns: WorkspaceRunsLister
  /** Clear the run history's finalized rows. */
  readonly clearRuns: WorkspaceRunsClearer
  /** Delete one history row (2026-10-15 截图评审); a still-running row refuses. */
  readonly deleteRun: WorkspaceRunDeleter
  /** Open one run's distilled process log as a read-only centre tab. */
  readonly onOpenLog: (runId: string) => void
}

/** A client-minted store id — same recipe as the kb store's (`<prefix>_<base36 ms>_<random>`). */
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`
}

/** How long between run-history polls while something is live. */
const RUNS_POLL_MS = 3000

/** How many history rows the panel shows; the store keeps ~100. */
const HISTORY_SHOWN = 20

/** Run statuses with their dictionary keys. */
const STATUS_KEYS: Record<KbWorkspaceRun['status'], WorkbenchLocaleKey> = {
  running: 'workspace.status.running',
  success: 'workspace.status.success',
  failed: 'workspace.status.failed',
  stopped: 'workspace.status.stopped',
  missed: 'workspace.status.missed',
  interrupted: 'workspace.status.interrupted',
}

/** Local wall-clock rendering of an ISO stamp; null passes through as —. */
function stamp(iso: string | undefined): string {
  if (iso === undefined) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** The run-history range's end stamp: time-only when it lands on the
    start's own day — `2026/10/12 13:00:30 → 2026/10/12 13:00:49` 把同一天
    说两遍，日期部分纯属噪音（2026-10-12 截图评审）。 */
function rangeEndStamp(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return stamp(endIso)
  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate()
  return sameDay ? end.toLocaleTimeString() : end.toLocaleString()
}

/** The 最近 column's compact stamp (`M-D HH:mm`, the shared `formatStamp`);
    run rows above keep the full `toLocaleString` on purpose — invalid ISO passes through. */
function stampShort(iso: string): string {
  return Number.isNaN(new Date(iso).getTime()) ? iso : formatStamp(iso)
}

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-2)', padding: 'var(--yt-space-1) var(--yt-space-2)' } as const

const mutedStyle = { color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)' } as const

const errorStyle = { color: 'var(--yt-error)', fontSize: 'var(--yt-type-label)' } as const

const hintStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const spaceCardStyle = {
  display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-1)', padding: 'var(--yt-space-2)',
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const spaceTitleStyle = { margin: 0, fontSize: 'var(--yt-type-label)', fontWeight: 600, color: 'var(--yt-text-primary)' } as const

const metaStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

/** The instruction table: one row per instruction, compact meta type.
    Fixed layout (2026-10-15 截图评审)：auto 布局让不折行的元数据列把名称列
    挤到三四个字符宽，词中间硬断（"ocr revi ew"）；定死后名称列独占余量。 */
const tableStyle = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 'var(--yt-type-label)' } as const

const thStyle = {
  textAlign: 'left', padding: 'var(--yt-space-1) var(--yt-space-2) var(--yt-space-1) 0', borderBottom: '1px solid var(--yt-border-subtle)',
  color: 'var(--yt-text-muted)', fontWeight: 500, whiteSpace: 'nowrap',
} as const

const tdStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2) var(--yt-space-1) 0', borderBottom: '1px solid var(--yt-border-subtle)',
  color: 'var(--yt-text-primary)', verticalAlign: 'top',
} as const

const tdMetaStyle = { ...tdStyle, color: 'var(--yt-text-secondary)', whiteSpace: 'nowrap' } as const

/** The name cell: single-line ellipsis per the DESIGN canon (列表行一律
    单行省略，全名由 title 兜底)，停用标签钉在行尾不参与挤压。 */
const tdNameStyle = { ...tdStyle, display: 'flex', alignItems: 'baseline', minWidth: 0, overflow: 'hidden' } as const

const nameTextStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } as const

const disabledTagStyle = { ...mutedStyle, flexShrink: 0, marginLeft: 'var(--yt-space-2)', fontSize: 'var(--yt-type-label)' } as const

const tdActionsStyle = { ...tdStyle, whiteSpace: 'nowrap', textAlign: 'right', width: 1 } as const

const actionsStyle = { display: 'flex', gap: 'var(--yt-space-1)', flexShrink: 0, justifyContent: 'flex-end' } as const

/** Row-action icons wear the ghost cut (DESIGN: 低频破坏性动作穿 ghost 装); the label lives in the tooltip. */
const iconButtonStyle = {
  flexShrink: 0, padding: '0 var(--yt-space-1)', border: 'none', background: 'transparent',
  color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)', cursor: 'pointer', lineHeight: 1.5,
} as const

/**
 * The − gestures wear an ink ring: bare glyphs read as stray punctuation
 * next to the table's hairlines, the circle makes them obviously clickable.
 * The ＋ gestures grew text labels instead (2026-10-15 截图评审：两个裸 ＋
 * 只能靠 tooltip 区分加的是什么) — a labelled button needs no ring.
 */
const circledIconStyle = {
  ...iconButtonStyle,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 18, height: 18, padding: 0, boxSizing: 'border-box',
  border: '1px solid var(--yt-border-strong)', borderRadius: '50%',
} as const

/** A per-row destructive action wears the ghost cut; armed, danger on the raised surface. */
const deleteStyle = {
  ...circledIconStyle,
  color: 'var(--yt-text-muted)',
} as const

const armedDeleteStyle = {
  ...deleteStyle,
  width: 'auto',
  height: 'auto',
  color: 'var(--yt-error)',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-strong)',
  borderRadius: 3,
  padding: '0 var(--yt-space-1)',
  whiteSpace: 'nowrap',
} as const

const formStyle = {
  display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-2)', padding: 'var(--yt-space-2)',
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const inputStyle = { padding: 'var(--yt-space-1) var(--yt-space-2)', width: '100%', boxSizing: 'border-box' } as const

const formActionsStyle = { display: 'flex', gap: 'var(--yt-space-2)' } as const

/** The add-openers wear text labels now (2026-10-15 截图评审：裸 ＋ 分不清
    加的是空间还是指令)；quiet tool face, pinned to the card's left edge. */
const addOpenStyle = { ...toolButtonStyle, alignSelf: 'flex-start' } as const

const stepRowStyle = { display: 'flex', gap: 'var(--yt-space-1)', alignItems: 'flex-start' } as const

const stepIndexStyle = { color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)', paddingTop: 'var(--yt-space-1)', flexShrink: 0 } as const

const zoneTitleStyle = {
  margin: 'var(--yt-space-2) 0 var(--yt-space-1)', fontSize: 'var(--yt-type-section)', fontWeight: 600, color: 'var(--yt-text-primary)',
} as const

const runRowStyle = {
  display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-1)', minWidth: 0, padding: 'var(--yt-space-1) var(--yt-space-2)', marginTop: 'var(--yt-space-1)',
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const runHeadStyle = { display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'baseline', flexWrap: 'wrap' } as const

/** The run result's markdown wrapper: agent 输出按 markdown 渲染（2026-10-12
    截图评审：此前 ** 与 | 表格语法裸奔）。颜色与字阶均由 MarkdownText 的
    compact 面决定（.compact 自带次级内容档的 token 与 13px 字阶），此处不设
    color——wrapper 只留 minWidth 防弹性溢出。 */
const resultStyle = {
  minWidth: 0,
} as const
const collapsedResultStyle = { ...resultStyle, maxHeight: 120, overflow: 'hidden' } as const

/** Longer than this, a final result gets an expand toggle instead of rendering tall. */
const RESULT_COLLAPSE_CHARS = 300

/**
 * One run's final result. The store keeps up to 16 KiB of the real answer,
 * so the panel must not silently swallow it: long text renders collapsed
 * with an explicit 展开/收起 toggle, short text renders as-is.
 */
function RunResult(props: { readonly t: WorkbenchT; readonly text: string }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const collapsible = props.text.length > RESULT_COLLAPSE_CHARS
  const labels = useMemo((): MarkdownLabels => ({
    code: { copyLabel: props.t('md.copy'), copiedLabel: props.t('md.copied') },
    footnotes: props.t('md.footnotes'),
  }), [props.t])
  return (
    <>
      <div style={collapsible && !expanded ? collapsedResultStyle : resultStyle}>
        <MarkdownText text={props.text} labels={labels} variant="compact" />
      </div>
      {collapsible && (
        <button data-hover="true" type="button" style={ghostButtonStyle}
          onClick={() => { setExpanded(value => !value) }}>
          {expanded ? props.t('workspace.collapseResult') : props.t('workspace.expandResult')}
        </button>
      )}
    </>
  )
}

/** One instruction's editor form: name, optional cron, enabled, the step chain. */
function InstructionForm(props: {
  readonly t: WorkbenchT
  readonly draft: {
    readonly id: string | null
    readonly name: string
    readonly cron: string
    readonly enabled: boolean
    readonly steps: readonly string[]
  }
  readonly busy: boolean
  readonly onChange: (patch: Partial<{ name: string; cron: string; enabled: boolean; steps: string[] }>) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
}): ReactElement {
  const { t, draft, busy, onChange, onSubmit, onCancel } = props
  // cron 即时反馈（2026-10-15 impeccable P1 修复）：此前敲错一个字段的表现
  // 是「安静地永远不跑」——解析与下次触发预览复用 ./cron.ts，与 SchedulePane
  // 同一口径；留空仍是合法的手动触发。
  const cronTrimmed = draft.cron.trim()
  const cronParsed = cronTrimmed === '' ? null : parseCron(cronTrimmed)
  const cronInvalid = cronTrimmed !== '' && cronParsed === null
  const cronNext = cronParsed === null ? null : cronNextFire(cronTrimmed, new Date())
  return (
    <div style={formStyle} data-workspace-instruction-form={draft.id ?? 'new'}>
      <input
        style={inputStyle}
        value={draft.name}
        placeholder={t('workspace.instructionName')}
        disabled={busy}
        onChange={(event) => { onChange({ name: event.target.value }) }}
      />
      <input
        style={inputStyle}
        value={draft.cron}
        placeholder={t('workspace.cronPlaceholder')}
        disabled={busy}
        aria-invalid={cronInvalid || undefined}
        onChange={(event) => { onChange({ cron: event.target.value }) }}
      />
      {cronInvalid && <div style={errorStyle} role="alert" data-workspace-cron-error="true">{t('workspace.cronInvalid')}</div>}
      {cronParsed !== null && (
        <div style={metaStyle} data-workspace-cron-next="true">
          {cronNext !== null
            ? t('workspace.nextFire', { time: formatStamp(cronNext.toISOString()) })
            : t('workspace.neverFires')}
        </div>
      )}
      <label style={{ display: 'flex', gap: 'var(--yt-space-1)', alignItems: 'center', fontSize: 'var(--yt-type-label)' }}>
        <input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => { onChange({ enabled: event.target.checked }) }} />
        {t('workspace.enabled')}
      </label>
      <div style={metaStyle}>{t('workspace.stepsLabel')}</div>
      {draft.steps.map((step, index) => (
        <div key={index} style={stepRowStyle}>
          <span style={stepIndexStyle}>#{index + 1}</span>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: 40 }}
            value={step}
            disabled={busy}
            onChange={(event) => {
              const steps = draft.steps.map((candidate, at) => at === index ? event.target.value : candidate)
              onChange({ steps })
            }}
          />
          {draft.steps.length > 1 && (
            <button data-hover="true" type="button" style={deleteStyle} disabled={busy}
              aria-label={`${t('workspace.deleteStep')} #${index + 1}`}
              title={`${t('workspace.deleteStep')} #${index + 1}`}
              onClick={() => { onChange({ steps: draft.steps.filter((_, at) => at !== index) }) }}>
              ✕
            </button>
          )}
        </div>
      ))}
      {draft.steps.length < 10 && (
        <button data-hover="true" type="button" style={ghostButtonStyle} disabled={busy}
          onClick={() => { onChange({ steps: [...draft.steps, ''] }) }}>
          {t('workspace.addStep')}
        </button>
      )}
      <div style={formActionsStyle}>
        <button type="button" style={primaryButtonStyle} data-hover="primary"
          disabled={busy || draft.name.trim() === '' || draft.steps.some(step => step.trim() === '') || cronInvalid}
          onClick={onSubmit}>
          {t('workspace.save')}
        </button>
        <button type="button" style={ghostButtonStyle} data-hover="true" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

/**
 * Render the 工作空间 tab (ADR-0056): the workspace management view.
 * @param props - see {@link WorkspacePanelProps}.
 * @returns the panel element.
 */
export function WorkspacePanel({ t, list, save, run, stop, listRuns, clearRuns, deleteRun, onOpenLog }: WorkspacePanelProps): ReactElement {
  // Every seam is a fresh closure on each render (inject face), so the loads
  // and writes read them through a ref — the same discipline MemoryPanel uses.
  const latest = useRef({ list, save, run, stop, listRuns, clearRuns, deleteRun })
  latest.current = { list, save, run, stop, listRuns, clearRuns, deleteRun }

  const [spaces, setSpaces] = useState<readonly KbWorkspace[] | null>(null)
  const [runs, setRuns] = useState<readonly KbWorkspaceRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [spaceDraft, setSpaceDraft] = useState<{ id: string | null; name: string; directory: string; model: string } | null>(null)
  const [instructionDraft, setInstructionDraft] = useState<{
    spaceId: string
    id: string | null
    name: string
    cron: string
    enabled: boolean
    steps: string[]
  } | null>(null)
  // 删除/清史的两击武装走共享 hook（2026-10-16 迁移：此前自养 state 没有
  // Esc 退路，武装后只能再击执行或转而武装他钮）；清史是单钮布尔，借
  // id 'clear' 入同一个模型，Esc 由 hook 统一解除。
  const { armedId: armedDelete, attempt: attemptDelete } = useArmedAction()
  const { armedId: armedClearId, attempt: attemptClear } = useArmedAction()
  const armedClear = armedClearId === 'clear'
  // 顶部说明默认收起（2026-10-12 截图评审：四行说明每个会话都占着首屏，
  // 老用户早已读过）；展开态会话内保持，与资源树/归档组的折叠惯例一致。
  const [aboutOpen, setAboutOpen] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    try {
      const result = await latest.current.list()
      setSpaces(result.workspaces)
      setError(null)
    } catch (failure: unknown) {
      setError(remoteMessage(failure))
    }
  }, [])

  const reloadRuns = useCallback(async (): Promise<void> => {
    try {
      const result = await latest.current.listRuns()
      setRuns(result.runs)
      setHistoryError(null)
    } catch (failure: unknown) {
      setHistoryError(remoteMessage(failure))
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await Promise.all([reload(), reloadRuns()])
    })()
  }, [reload, reloadRuns])

  // Poll the history while any run is live (ADR-0056 决定 7: status flips
  // must arrive without a manual refresh); quiet once everything settles.
  const runningCount = (runs ?? []).filter(entry => entry.status === 'running').length
  useEffect(() => {
    if (runningCount === 0) return
    const timer = setInterval(() => { void reloadRuns() }, RUNS_POLL_MS)
    return () => { clearInterval(timer) }
  }, [runningCount, reloadRuns])

  /** Persist one workspace list mutation; the host's stored list wins on return. */
  const commit = async (next: readonly KbWorkspace[]): Promise<boolean> => {
    try {
      const result = await latest.current.save({ workspaces: next })
      setSpaces(result.workspaces)
      setNotice(t('workspace.saved'))
      setError(null)
      return true
    } catch (failure: unknown) {
      setNotice(null)
      setError(remoteMessage(failure))
      return false
    }
  }

  const submitSpace = async (): Promise<void> => {
    if (spaceDraft === null || busy) return
    setBusy(true)
    const current = spaces ?? []
    const next = spaceDraft.id === null
      ? [...current, {
        id: genId('wsp'),
        name: spaceDraft.name.trim(),
        directory: spaceDraft.directory.trim(),
        agent: 'codebuddy' as const,
        ...(spaceDraft.model.trim() !== '' ? { model: spaceDraft.model.trim() } : {}),
        instructions: [],
      }]
      : current.map(space => space.id !== spaceDraft.id ? space : {
        ...space,
        name: spaceDraft.name.trim(),
        directory: spaceDraft.directory.trim(),
        ...(spaceDraft.model.trim() !== '' ? { model: spaceDraft.model.trim() } : {}),
      })
    const saved = await commit(next)
    setBusy(false)
    if (saved) setSpaceDraft(null)
  }

  const deleteSpace = async (target: KbWorkspace): Promise<void> => {
    if (busy) return
    setBusy(true)
    await commit((spaces ?? []).filter(space => space.id !== target.id))
    setBusy(false)
  }

  const submitInstruction = async (): Promise<void> => {
    if (instructionDraft === null || busy) return
    setBusy(true)
    const steps = instructionDraft.steps.map(step => step.trim()).filter(step => step !== '')
    const current = spaces ?? []
    const next = current.map((space) => {
      if (space.id !== instructionDraft.spaceId) return space
      const instruction: KbWorkspaceInstruction = {
        id: instructionDraft.id ?? genId('ins'),
        name: instructionDraft.name.trim(),
        ...(instructionDraft.cron.trim() !== '' ? { cron: instructionDraft.cron.trim() } : {}),
        enabled: instructionDraft.enabled,
        steps,
      }
      return {
        ...space,
        instructions: instructionDraft.id === null
          ? [...space.instructions, instruction]
          : space.instructions.map(row => row.id === instructionDraft.id ? instruction : row),
      }
    })
    const saved = await commit(next)
    setBusy(false)
    if (saved) setInstructionDraft(null)
  }

  const deleteInstruction = async (space: KbWorkspace, target: KbWorkspaceInstruction): Promise<void> => {
    if (busy) return
    setBusy(true)
    await commit((spaces ?? []).map(candidate => candidate.id !== space.id ? candidate : {
      ...candidate,
      instructions: candidate.instructions.filter(row => row.id !== target.id),
    }))
    setBusy(false)
  }

  const trigger = async (space: KbWorkspace, instruction: KbWorkspaceInstruction): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await latest.current.run({ workspaceId: space.id, instructionId: instruction.id })
      setNotice(t('workspace.triggered'))
      await reloadRuns()
    } catch (failure: unknown) {
      setNotice(null)
      setError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const stopRun = async (runId: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await latest.current.stop(runId)
      setNotice(t('workspace.stopped'))
      await reloadRuns()
    } catch (failure: unknown) {
      setNotice(null)
      setHistoryError(remoteMessage(failure))
      await reloadRuns()
    } finally {
      setBusy(false)
    }
  }

  /** Clear the finalized history rows; the store keeps whatever is still running. */
  const clearHistory = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await latest.current.clearRuns()
      setRuns(result.runs)
      setNotice(t('workspace.cleared', { count: result.cleared }))
      setHistoryError(null)
    } catch (failure: unknown) {
      setNotice(null)
      setHistoryError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  /** Delete one finalized history row (2026-10-15 截图评审); the store refuses a live row. */
  const deleteOneRun = async (runId: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await latest.current.deleteRun(runId)
      setRuns(result.runs)
      setHistoryError(null)
    } catch (failure: unknown) {
      setHistoryError(remoteMessage(failure))
      await reloadRuns()
    } finally {
      setBusy(false)
    }
  }

  const history = (runs ?? []).slice(0, HISTORY_SHOWN)

  return (
    <div style={wrapStyle} data-workspace-panel="true">
      <div>
        <button data-hover="true" type="button" style={toolButtonStyle}
          aria-expanded={aboutOpen}
          data-workspace-about="true"
          onClick={() => { setAboutOpen(open => !open) }}>
          {aboutOpen ? '▾' : '▸'} {t('workspace.descriptionToggle')}
        </button>
        {aboutOpen && <div style={mutedStyle}>{t('workspace.description')}</div>}
      </div>
      {(spaceDraft !== null || instructionDraft !== null) ? null : (
        <button data-hover="true" type="button" style={addOpenStyle} disabled={busy}
          title={t('workspace.addSpace')}
          data-workspace-add-space="true"
          onClick={() => { setSpaceDraft({ id: null, name: '', directory: '', model: '' }) }}>
          {t('workspace.addSpaceLabel')}
        </button>
      )}
      {spaceDraft !== null && (
        <div style={formStyle} data-workspace-space-form={spaceDraft.id ?? 'new'}>
          <input style={inputStyle} value={spaceDraft.name} placeholder={t('workspace.spaceName')}
            disabled={busy} autoFocus onChange={(event) => { setSpaceDraft({ ...spaceDraft, name: event.target.value }) }} />
          <input style={inputStyle} value={spaceDraft.directory} placeholder={t('workspace.spaceDirectory')}
            disabled={busy} onChange={(event) => { setSpaceDraft({ ...spaceDraft, directory: event.target.value }) }} />
          <input style={inputStyle} value={spaceDraft.model} placeholder={t('workspace.spaceModel')}
            disabled={busy} onChange={(event) => { setSpaceDraft({ ...spaceDraft, model: event.target.value }) }} />
          <div style={formActionsStyle}>
            <button type="button" style={primaryButtonStyle} data-hover="primary"
              disabled={busy || spaceDraft.name.trim() === '' || spaceDraft.directory.trim() === ''}
              onClick={() => { void submitSpace() }}>
              {t('workspace.save')}
            </button>
            <button type="button" style={ghostButtonStyle} data-hover="true" disabled={busy}
              data-workspace-space-cancel="true"
              onClick={() => { setSpaceDraft(null) }}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {notice !== null && <div style={hintStyle} data-workspace-notice="true">{notice}</div>}
      {error !== null && <div style={errorStyle} data-workspace-error="true">{error}</div>}
      {spaces === null && error === null && <div style={mutedStyle}>{t('workspace.loading')}</div>}
      {spaces !== null && spaces.length === 0 && <div style={mutedStyle} data-workspace-empty="true">{t('workspace.empty')}</div>}
      {spaces?.map(space => (
        <div key={space.id} style={spaceCardStyle} data-workspace-space={space.id}>
          <div style={{ display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'baseline' }}>
            <div style={{ ...spaceTitleStyle, minWidth: 0, flex: 1 }}>{space.name}</div>
            <div style={actionsStyle}>
              <button data-hover="true" type="button" style={iconButtonStyle} disabled={busy}
                title={t('workspace.edit')}
                aria-label={t('workspace.edit')}
                data-workspace-space-edit={space.id}
                onClick={() => { setSpaceDraft({ id: space.id, name: space.name, directory: space.directory, model: space.model ?? '' }) }}>
                ✎
              </button>
              <button data-hover="true" type="button"
                style={armedDelete === `w:${space.id}` ? armedDeleteStyle : deleteStyle}
                disabled={busy}
                title={armedDelete === `w:${space.id}` ? undefined : t('workspace.delete')}
                aria-label={t('workspace.delete')}
                data-armed={armedDelete === `w:${space.id}` || undefined}
                data-workspace-space-delete={space.id}
                onClick={() => { attemptDelete(`w:${space.id}`, () => { void deleteSpace(space) }) }}>
                {armedDelete === `w:${space.id}` ? t('workbench.deleteArm') : '−'}
              </button>
            </div>
          </div>
          <div style={metaStyle}>{space.directory}{space.model !== undefined ? ` · ${space.model}` : ''}</div>
          {space.instructions.length > 0 && (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('common.name')}</th>
                  <th style={{ ...thStyle, width: 40 }}>{t('workspace.colTrigger')}</th>
                  <th style={{ ...thStyle, width: 40 }}>{t('workspace.colSteps')}</th>
                  <th style={{ ...thStyle, width: 88 }}>{t('workspace.colLast')}</th>
                  <th style={{ ...thStyle, width: 72 }}>{t('workspace.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {space.instructions.map(instruction => (
                  <tr key={instruction.id} data-workspace-instruction={instruction.id}>
                    <td style={tdNameStyle} title={instruction.name}>
                      <span style={nameTextStyle}>{instruction.name}</span>
                      {!instruction.enabled && <span style={disabledTagStyle}>{t('workspace.disabledTag')}</span>}
                    </td>
                    <td style={tdMetaStyle} title={instruction.cron}>
                      {/* cron 表达式收进 tooltip（2026-10-12 截图评审）：原始
                          五段式把窄栏的名称列挤到硬折行；单元格只答「怎么触发」。 */}
                      {instruction.cron === undefined
                        ? t('workspace.triggerManual')
                        : t('workspace.triggerCron')}
                    </td>
                    <td style={tdMetaStyle}>{t('workspace.stepsCount', { count: instruction.steps.length })}</td>
                    <td style={tdMetaStyle}
                      title={[
                        instruction.lastFiredAt !== undefined ? `${t('workspace.lastFired')} ${stamp(instruction.lastFiredAt)}` : '',
                        instruction.lastMissedAt !== undefined ? `${t('workspace.lastMissed')} ${stamp(instruction.lastMissedAt)}` : '',
                      ].filter(entry => entry !== '').join('\n') || undefined}>
                      {instruction.lastFiredAt !== undefined && stampShort(instruction.lastFiredAt)}
                      {instruction.lastFiredAt !== undefined && instruction.lastMissedAt !== undefined && ' · '}
                      {instruction.lastMissedAt !== undefined && `${t('workspace.lastMissed')} ${stampShort(instruction.lastMissedAt)}`}
                      {instruction.lastFiredAt === undefined && instruction.lastMissedAt === undefined && '—'}
                    </td>
                    <td style={tdActionsStyle}>
                      <div style={actionsStyle}>
                        <button data-hover="true" type="button" style={iconButtonStyle} disabled={busy}
                          title={t('workspace.run')}
                          aria-label={t('workspace.run')}
                          data-workspace-run={instruction.id}
                          onClick={() => { void trigger(space, instruction) }}>
                          ▶
                        </button>
                        <button data-hover="true" type="button" style={iconButtonStyle} disabled={busy}
                          title={t('workspace.edit')}
                          aria-label={t('workspace.edit')}
                          data-workspace-instruction-edit={instruction.id}
                          onClick={() => {
                            setInstructionDraft({
                              spaceId: space.id, id: instruction.id, name: instruction.name,
                              cron: instruction.cron ?? '', enabled: instruction.enabled,
                              steps: [...instruction.steps],
                            })
                          }}>
                          ✎
                        </button>
                        <button data-hover="true" type="button"
                          style={armedDelete === `i:${instruction.id}` ? armedDeleteStyle : deleteStyle}
                          disabled={busy}
                          title={armedDelete === `i:${instruction.id}` ? undefined : t('workspace.delete')}
                          aria-label={t('workspace.delete')}
                          data-armed={armedDelete === `i:${instruction.id}` || undefined}
                          data-workspace-instruction-delete={instruction.id}
                          onClick={() => { attemptDelete(`i:${instruction.id}`, () => { void deleteInstruction(space, instruction) }) }}>
                          {armedDelete === `i:${instruction.id}` ? t('workbench.deleteArm') : '−'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {instructionDraft !== null && instructionDraft.spaceId === space.id && (
            <InstructionForm
              t={t}
              draft={instructionDraft}
              busy={busy}
              onChange={(patch) => { setInstructionDraft(current => current === null ? current : { ...current, ...patch }) }}
              onSubmit={() => { void submitInstruction() }}
              onCancel={() => { setInstructionDraft(null) }}
            />
          )}
          {instructionDraft === null && (
            <button data-hover="true" type="button" style={addOpenStyle} disabled={busy}
              title={t('workspace.addInstruction')}
              data-workspace-add-instruction={space.id}
              onClick={() => {
                setInstructionDraft({
                  spaceId: space.id, id: null, name: '', cron: '', enabled: true, steps: [''],
                })
              }}>
              {t('workspace.addInstructionLabel')}
            </button>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--yt-space-2)' }}>
        <div style={{ ...zoneTitleStyle, flex: 1 }}>{t('workspace.history')}</div>
        {runs !== null && runs.length > 0 && (
          <button data-hover="true" type="button"
            style={armedClear ? toolButtonArmedStyle : toolButtonStyle}
            disabled={busy}
            title={armedClear ? undefined : t('workspace.clearHistory')}
            data-armed={armedClear || undefined}
            data-workspace-clear-history="true"
            onClick={() => { attemptClear('clear', () => { void clearHistory() }) }}>
            {armedClear ? t('workspace.clearArm') : t('workspace.clearLabel')}
          </button>
        )}
      </div>
      {historyError !== null && <div style={errorStyle} data-workspace-history-error="true">{historyError}</div>}
      {runs !== null && runs.length === 0 && <div style={mutedStyle} data-workspace-history-empty="true">{t('workspace.historyEmpty')}</div>}
      {history.map((entry) => {
        const live = entry.status === 'running'
        const failed = entry.failedStep !== undefined ? entry.steps[entry.failedStep] : undefined
        return (
          <div key={entry.id} style={runRowStyle} data-workspace-run={entry.id} data-workspace-run-status={entry.status}>
            <div style={runHeadStyle}>
              <strong style={{ fontSize: 'var(--yt-type-label)' }}>{entry.instructionName}</strong>
              <span style={mutedStyle}>
                {entry.trigger === 'cron' ? t('workspace.triggerCron')
                  : entry.trigger === 'agent' ? t('workspace.triggerAgent')
                    : t('workspace.triggerManual')}
                {' · '}{t(STATUS_KEYS[entry.status])}
                {' · '}{stamp(entry.startedAt)}
                {entry.finishedAt !== undefined && ` → ${rangeEndStamp(entry.startedAt, entry.finishedAt)}`}
              </span>
              {live && (
                <button data-hover="true" type="button" style={ghostButtonStyle} disabled={busy}
                  data-workspace-run-stop={entry.id}
                  onClick={() => { void stopRun(entry.id) }}>
                  {t('workspace.stop')}
                </button>
              )}
              {/* The distilled process log — every triggered run keeps one;
                  a run still live is auto-followed by the log tab itself.
                  Missed cron runs never spawned, so no log exists to open. */}
              {entry.status !== 'missed' && (
                <button data-hover="true" type="button" style={ghostButtonStyle}
                  data-workspace-run-view={entry.id}
                  onClick={() => { onOpenLog(entry.id) }}>
                  {t('workspace.viewLog')}
                </button>
              )}
              {/* One row's own delete (2026-10-15 截图评审)：两击武装，与
                  指令行同一套 − 语法。运行中的行不给——先停止，删除才有意义。 */}
              {!live && (
                <button data-hover="true" type="button"
                  style={armedDelete === `r:${entry.id}` ? armedDeleteStyle : deleteStyle}
                  disabled={busy}
                  title={armedDelete === `r:${entry.id}` ? undefined : t('workspace.deleteRun')}
                  data-armed={armedDelete === `r:${entry.id}` || undefined}
                  data-workspace-run-delete={entry.id}
                  onClick={() => { attemptDelete(`r:${entry.id}`, () => { void deleteOneRun(entry.id) }) }}>
                  {armedDelete === `r:${entry.id}` ? t('workbench.deleteArm') : '−'}
                </button>
              )}
            </div>
            {entry.failedStep !== undefined && (
              <div style={errorStyle}>{t('workspace.failStep', { n: entry.failedStep + 1 })}</div>
            )}
            {failed?.error !== undefined && <div style={errorStyle}>{failed.error}</div>}
            {entry.finalResult !== undefined && entry.finalResult !== '' && (
              <RunResult t={t} text={entry.finalResult} />
            )}
          </div>
        )
      })}
    </div>
  )
}
