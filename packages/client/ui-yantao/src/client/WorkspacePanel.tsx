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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  KbWorkspace, KbWorkspaceInstruction, KbWorkspaceRun,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { remoteMessage, type WorkspaceLister, type WorkspaceRunner, type WorkspaceRunsLister, type WorkspaceRunStopper, type WorkspaceSaver } from './remote.ts'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'
import { ghostButtonStyle, primaryButtonStyle } from './buttons.ts'

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

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 8px' } as const

const mutedStyle = { color: 'var(--yt-text-muted)', fontSize: 12 } as const

const errorStyle = { color: 'var(--yt-error)', fontSize: 12 } as const

const hintStyle = { color: 'var(--yt-text-secondary)', fontSize: 12 } as const

const spaceCardStyle = {
  display: 'flex', flexDirection: 'column', gap: 6, padding: '8px',
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const spaceTitleStyle = { margin: 0, fontSize: 'var(--yt-type-label)', fontWeight: 600, color: 'var(--yt-text-primary)' } as const

const metaStyle = { color: 'var(--yt-text-secondary)', fontSize: 12 } as const

const instructionRowStyle = { display: 'flex', gap: 8, alignItems: 'flex-start', minWidth: 0 } as const

const textStyle = { minWidth: 0 } as const

const actionsStyle = { display: 'flex', gap: 8, flexShrink: 0 } as const

const buttonStyle = { padding: '1px 8px', fontSize: 12 } as const

/** A per-row destructive action wears the ghost cut; armed, danger on the raised surface. */
const deleteStyle = {
  flexShrink: 0, padding: '0 4px', border: 'none', background: 'transparent',
  color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)', cursor: 'pointer',
} as const

const armedDeleteStyle = {
  ...deleteStyle,
  color: 'var(--yt-error)',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-strong)',
  borderRadius: 3,
  padding: '0 6px',
  whiteSpace: 'nowrap',
} as const

const formStyle = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '8px',
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const inputStyle = { padding: '4px 8px', width: '100%', boxSizing: 'border-box' } as const

const formActionsStyle = { display: 'flex', gap: 8 } as const

const addOpenStyle = { ...buttonStyle, alignSelf: 'flex-start', padding: '4px 8px' } as const

const stepRowStyle = { display: 'flex', gap: 6, alignItems: 'flex-start' } as const

const stepIndexStyle = { color: 'var(--yt-text-muted)', fontSize: 12, paddingTop: 6, flexShrink: 0 } as const

const zoneTitleStyle = {
  margin: '8px 0 2px', fontSize: 'var(--yt-type-section)', fontWeight: 600, color: 'var(--yt-text-primary)',
} as const

const runRowStyle = {
  display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, padding: '6px 8px', marginTop: 4,
  background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)', borderRadius: 8,
} as const

const runHeadStyle = { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } as const

const resultStyle = {
  color: 'var(--yt-text-secondary)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
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
  return (
    <>
      <div style={collapsible && !expanded ? collapsedResultStyle : resultStyle}>{props.text}</div>
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
        onChange={(event) => { onChange({ cron: event.target.value }) }}
      />
      <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
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
          disabled={busy || draft.name.trim() === '' || draft.steps.some(step => step.trim() === '')}
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
 * Render the 工作区 tab (ADR-0056): the workspace management view.
 * @param props - see {@link WorkspacePanelProps}.
 * @returns the panel element.
 */
export function WorkspacePanel({ t, list, save, run, stop, listRuns }: WorkspacePanelProps): ReactElement {
  // Every seam is a fresh closure on each render (inject face), so the loads
  // and writes read them through a ref — the same discipline MemoryPanel uses.
  const latest = useRef({ list, save, run, stop, listRuns })
  latest.current = { list, save, run, stop, listRuns }

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
  const [armedDelete, setArmedDelete] = useState<string | null>(null)

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

  const history = (runs ?? []).slice(0, HISTORY_SHOWN)

  return (
    <div style={wrapStyle} data-workspace-panel="true">
      <div style={mutedStyle}>{t('workspace.description')}</div>
      {(spaceDraft !== null || instructionDraft !== null) ? null : (
        <button data-hover="true" type="button" style={addOpenStyle} disabled={busy}
          data-workspace-add-space="true"
          onClick={() => { setSpaceDraft({ id: null, name: '', directory: '', model: '' }) }}>
          {t('workspace.addSpace')}
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <div style={{ ...spaceTitleStyle, minWidth: 0, flex: 1 }}>{space.name}</div>
            <div style={actionsStyle}>
              <button data-hover="true" type="button" style={buttonStyle} disabled={busy}
                data-workspace-space-edit={space.id}
                onClick={() => { setSpaceDraft({ id: space.id, name: space.name, directory: space.directory, model: space.model ?? '' }) }}>
                {t('workspace.edit')}
              </button>
              <button data-hover="true" type="button"
                style={armedDelete === `w:${space.id}` ? armedDeleteStyle : deleteStyle}
                disabled={busy}
                data-armed={armedDelete === `w:${space.id}` || undefined}
                data-workspace-space-delete={space.id}
                onClick={() => {
                  if (armedDelete !== `w:${space.id}`) {
                    setArmedDelete(`w:${space.id}`)
                    return
                  }
                  setArmedDelete(null)
                  void deleteSpace(space)
                }}>
                {armedDelete === `w:${space.id}` ? t('workbench.deleteArm') : t('workspace.delete')}
              </button>
            </div>
          </div>
          <div style={metaStyle}>{space.directory}{space.model !== undefined ? ` · ${space.model}` : ''}</div>
          {space.instructions.map((instruction, index) => {
            const editing = instructionDraft !== null && instructionDraft.id === instruction.id
            return (
              <div key={instruction.id} style={{ ...instructionRowStyle, marginTop: index === 0 ? 2 : 8 }}
                data-workspace-instruction={instruction.id}>
                {editing ? (
                  <InstructionForm
                    t={t}
                    draft={instructionDraft}
                    busy={busy}
                    onChange={(patch) => { setInstructionDraft(current => current === null ? current : { ...current, ...patch }) }}
                    onSubmit={() => { void submitInstruction() }}
                    onCancel={() => { setInstructionDraft(null) }}
                  />
                ) : (
                  <>
                    <div style={textStyle}>
                      <div>
                        {instruction.name}
                        {!instruction.enabled && <span style={mutedStyle}> · {t('workspace.disabledTag')}</span>}
                      </div>
                      <div style={metaStyle}>
                        {instruction.cron === undefined
                          ? t('workspace.triggerManual')
                          : `${t('workspace.triggerCron')}：${instruction.cron}`}
                        {' · '}
                        {t('workspace.stepsCount', { count: instruction.steps.length })}
                        {instruction.lastFiredAt !== undefined && ` · ${t('workspace.lastFired')} ${stamp(instruction.lastFiredAt)}`}
                        {instruction.lastMissedAt !== undefined && ` · ${t('workspace.lastMissed')} ${stamp(instruction.lastMissedAt)}`}
                      </div>
                    </div>
                    <div style={actionsStyle}>
                      <button data-hover="true" type="button" style={buttonStyle} disabled={busy}
                        data-workspace-run={instruction.id}
                        onClick={() => { void trigger(space, instruction) }}>
                        {t('workspace.run')}
                      </button>
                      <button data-hover="true" type="button" style={buttonStyle} disabled={busy}
                        data-workspace-instruction-edit={instruction.id}
                        onClick={() => {
                          setInstructionDraft({
                            spaceId: space.id, id: instruction.id, name: instruction.name,
                            cron: instruction.cron ?? '', enabled: instruction.enabled,
                            steps: [...instruction.steps],
                          })
                        }}>
                        {t('workspace.edit')}
                      </button>
                      <button data-hover="true" type="button"
                        style={armedDelete === `i:${instruction.id}` ? armedDeleteStyle : deleteStyle}
                        disabled={busy}
                        data-armed={armedDelete === `i:${instruction.id}` || undefined}
                        data-workspace-instruction-delete={instruction.id}
                        onClick={() => {
                          if (armedDelete !== `i:${instruction.id}`) {
                            setArmedDelete(`i:${instruction.id}`)
                            return
                          }
                          setArmedDelete(null)
                          void deleteInstruction(space, instruction)
                        }}>
                        {armedDelete === `i:${instruction.id}` ? t('workbench.deleteArm') : t('workspace.delete')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {instructionDraft !== null && instructionDraft.spaceId === space.id && instructionDraft.id === null && (
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
              data-workspace-add-instruction={space.id}
              onClick={() => {
                setInstructionDraft({
                  spaceId: space.id, id: null, name: '', cron: '', enabled: true, steps: [''],
                })
              }}>
              {t('workspace.addInstruction')}
            </button>
          )}
        </div>
      ))}
      <div style={zoneTitleStyle}>{t('workspace.history')}</div>
      {historyError !== null && <div style={errorStyle} data-workspace-history-error="true">{historyError}</div>}
      {runs !== null && runs.length === 0 && <div style={mutedStyle} data-workspace-history-empty="true">{t('workspace.historyEmpty')}</div>}
      {history.map((entry) => {
        const live = entry.status === 'running'
        const failed = entry.failedStep !== undefined ? entry.steps[entry.failedStep] : undefined
        return (
          <div key={entry.id} style={runRowStyle} data-workspace-run={entry.id} data-workspace-run-status={entry.status}>
            <div style={runHeadStyle}>
              <strong style={{ fontSize: 12 }}>{entry.instructionName}</strong>
              <span style={mutedStyle}>
                {entry.trigger === 'cron' ? t('workspace.triggerCron') : t('workspace.triggerManual')}
                {' · '}{t(STATUS_KEYS[entry.status])}
                {' · '}{stamp(entry.startedAt)}
                {entry.finishedAt !== undefined && ` → ${stamp(entry.finishedAt)}`}
              </span>
              {live && (
                <button data-hover="true" type="button" style={buttonStyle} disabled={busy}
                  data-workspace-run-stop={entry.id}
                  onClick={() => { void stopRun(entry.id) }}>
                  {t('workspace.stop')}
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
