/**
 * The workspace run history (ADR-0056 决定 6): one row per instruction
 * execution — cron-fired, manual, or a missed cron window — appended by the
 * controller's runtime and patched in place as steps complete. The file
 * lives at `<kbRoot>/.dsh/yantao/workspace-runs.json` and is trimmed to a
 * ring of the most recent rows; it is a log, not a queue — nothing here
 * waits for a decision.
 *
 * Writers all funnel through this module's lock, same single-process recipe
 * as the proposal inbox: the cron tick, a manual trigger, and a finishing
 * chain step can overlap, and last-writer-wins would silently drop a step
 * record.
 * @module @deepseek-ai/dsh-yantao-kb/workspace-runs
 */

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { KbError } from './types.ts'

/** One chain step's record inside a run. */
export interface WorkspaceRunStep {
  /** Zero-based position in the chain. */
  readonly index: number
  /** The prompt as fired — a snapshot, not a reference. */
  readonly promptSnapshot: string
  /** ISO timestamp the step's process started; absent before it spawns. */
  readonly startedAt?: string
  /** ISO timestamp the step ended (any ending); absent while running. */
  readonly finishedAt?: string
  /** The process exit code; null when killed or never cleanly exited. */
  readonly exitCode?: number | null
  /** The agent session this step ran in — later steps resume it (ADR-0056 决定 3). */
  readonly sessionId?: string
  /** The final result text, trimmed to an excerpt for the history card. */
  readonly resultExcerpt?: string
  /** Why the step failed, when it did. */
  readonly error?: string
}

/** One execution of one instruction. */
export interface WorkspaceRun {
  /** Stable identity, assigned at trigger time. */
  readonly id: string
  /** The owning workspace; dangling after a workspace deletion — rows are history, not references. */
  readonly workspaceId?: string
  /** The instruction that produced this run. */
  readonly instructionId: string
  /** The instruction's name at trigger time (snapshots survive renames). */
  readonly instructionName: string
  /** What pulled the trigger (`agent` = an agent session's kb_run_workspace_instruction, ADR-0063;
   *  `schedule` = a fired 调度 tab schedule, reported by the frontend scheduler). */
  readonly trigger: 'manual' | 'cron' | 'agent' | 'schedule'
  /** Lifecycle: `running` until a terminal status replaces it. */
  readonly status: 'running' | 'success' | 'failed' | 'stopped' | 'missed' | 'interrupted'
  /** ISO timestamp the run was created. */
  readonly startedAt: string
  /** ISO timestamp the run reached a terminal status; absent while running. */
  readonly finishedAt?: string
  /** Zero-based index of the step that broke the chain, when one did. */
  readonly failedStep?: number
  /** The last successful step's result text, for the history card. */
  readonly finalResult?: string
  /** Why the run failed, when the failure left no step to blame (schedule rows). */
  readonly error?: string
  /** Per-step records, in chain order. A `missed` row has none. */
  readonly steps: readonly WorkspaceRunStep[]
}

/** The store's on-disk shape. */
export interface WorkspaceRunsFile {
  readonly version: 1
  readonly runs: readonly WorkspaceRun[]
}

/** Where the store lives, relative to the KB root. */
export const WORKSPACE_RUNS_DISPLAY_PATH = '.dsh/yantao/workspace-runs.json'

/**
 * Where one run's distilled process log lives, relative to the KB root:
 * `<dir>/<runId>.log`. The KB's `sessions/` is the archive zone (「流水」区
 * 只追加) — a run's distilled process log belongs beside the archived
 * sessions, browsable in the resource tree and openable in any editor.
 */
export const WORKSPACE_RUN_LOG_DIR = 'sessions/workspace'

/** Absolute path of one run's log file. */
export function runLogPath(kbRoot: string, runId: string): string {
  return join(kbRoot, WORKSPACE_RUN_LOG_DIR, `${runId}.log`)
}

/** The ring budget (ADR-0056 决定 6): past this, the oldest finalized rows fall off. */
export const RUN_HISTORY_CAP = 100

/** Length caps on the runtime-authored text fields. The result cap is the
 * FINAL ANSWER's ceiling, not a garnish: the run history is the only place a
 * chain's output survives, so it must hold a real agent answer intact (a
 * 20-row markdown table already blows past 1000 chars). 16 KiB per field ×
 * a ≤100-row ring stays a bounded file; the panel collapses the rendering. */
const RESULT_EXCERPT_MAX = 16 * 1024
const ERROR_MAX = 500

/** Where the store sits on disk. */
function runsTarget(kbRoot: string): string {
  return join(kbRoot, '.dsh', 'yantao', 'workspace-runs.json')
}

/** A fresh run id: `run_<base36 ms>_<random>` — same recipe as the other store ids. */
export function newRunId(now: Date = new Date()): string {
  return `run_${now.getTime().toString(36)}_${randomBytes(4).toString('hex')}`
}

/** Trim a runtime-authored text to its store cap — excerpts are garnish, never the dish. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * Validate one run list in full: ids unique, statuses known, timestamps
 * paired with statuses. The runtime is the only producer and it is trusted
 * code, so step bodies are checked loosely — but a corrupt file must still
 * fail loudly rather than poison the history read.
 * @param runs - the list as stored, oldest first.
 * @returns the same list.
 */
export function normalizeWorkspaceRuns(runs: readonly unknown[]): WorkspaceRun[] {
  if (runs.length > RUN_HISTORY_CAP) {
    throw new KbError('too-many-workspace-runs', `运行历史最多保留 ${RUN_HISTORY_CAP} 条`)
  }
  const seen = new Set<string>()
  return runs.map((item, at) => {
    if (typeof item !== 'object' || item === null) {
      throw new KbError('bad-workspace-run', `第 ${at + 1} 条运行记录格式不对`)
    }
    const raw = item as Record<string, unknown>
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      throw new KbError('bad-workspace-run', `第 ${at + 1} 条运行记录缺少 id`)
    }
    const id = raw.id.trim()
    if (seen.has(id)) {
      throw new KbError('duplicate-workspace-run', `运行记录 id「${id}」重复了`)
    }
    seen.add(id)
    for (const key of ['instructionId', 'instructionName'] as const) {
      if (typeof raw[key] !== 'string' || raw[key].trim() === '') {
        throw new KbError('bad-workspace-run', `运行记录「${id}」缺少 ${key}`)
      }
    }
    if (raw.trigger !== 'manual' && raw.trigger !== 'cron' && raw.trigger !== 'agent' && raw.trigger !== 'schedule') {
      throw new KbError('bad-workspace-run', `运行记录「${id}」的触发方式不合法`)
    }
    // 调度行不属于任何工作区（workspaceId 缺席合法）；工作区行仍必备。
    if (raw.trigger !== 'schedule'
      && (typeof raw.workspaceId !== 'string' || (raw.workspaceId as string).trim() === '')) {
      throw new KbError('bad-workspace-run', `运行记录「${id}」缺少 workspaceId`)
    }
    const status = raw.status
    if (status !== 'running' && status !== 'success' && status !== 'failed'
      && status !== 'stopped' && status !== 'missed' && status !== 'interrupted') {
      throw new KbError('bad-workspace-run', `运行记录「${id}」的状态不合法`)
    }
    if (typeof raw.startedAt !== 'string' || Number.isNaN(Date.parse(raw.startedAt))) {
      throw new KbError('bad-workspace-run', `运行记录「${id}」的开始时间不是合法日期`)
    }
    if (status === 'running') {
      if (raw.finishedAt !== undefined) {
        throw new KbError('bad-workspace-run', `运行记录「${id}」还在运行，不应带有结束时间`)
      }
    } else if (typeof raw.finishedAt !== 'string' || Number.isNaN(Date.parse(raw.finishedAt))) {
      throw new KbError('bad-workspace-run', `运行记录「${id}」已结束但缺少结束时间`)
    }
    if (raw.steps !== undefined && !Array.isArray(raw.steps)) {
      throw new KbError('bad-workspace-run', `运行记录「${id}」的步骤列表不合法`)
    }
    return raw as unknown as WorkspaceRun
  })
}

/**
 * Read the whole history. An absent file is an empty log; a corrupt file is
 * a loud error — silent discard would hide whatever the agents actually did.
 * @param kbRoot - the live KB root.
 * @returns the runs, oldest first.
 */
export async function readWorkspaceRuns(kbRoot: string): Promise<WorkspaceRun[]> {
  let raw: string
  try {
    raw = await readFile(runsTarget(kbRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new KbError('bad-workspace-runs-file', '.dsh/yantao/workspace-runs.json 不是合法 JSON，请修复或删除后重试')
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { runs?: unknown }).runs)) {
    throw new KbError('bad-workspace-runs-file', '.dsh/yantao/workspace-runs.json 缺少 runs 数组')
  }
  return normalizeWorkspaceRuns((parsed as { runs: readonly unknown[] }).runs)
}

async function writeWorkspaceRuns(kbRoot: string, runs: readonly WorkspaceRun[]): Promise<void> {
  const payload = JSON.stringify({ version: 1, runs } satisfies WorkspaceRunsFile, null, 2) + '\n'
  await writeFileAtomic(runsTarget(kbRoot), payload, { mode: 0o600 })
}

// Every mutator's read→modify→write runs on this chain — same single-process
// recipe as the proposal inbox: the cron tick appending a missed row, a human
// trigger, and a chain step finishing can all overlap, and last-writer-wins
// would silently drop a record.
let runsWriteChain: Promise<unknown> = Promise.resolve()
function withRunsLock<T>(work: () => Promise<T>): Promise<T> {
  const run = runsWriteChain.then(work, work)
  runsWriteChain = run.catch(() => undefined)
  return run
}

/** Drop the oldest finalized rows until the list fits the cap; running rows are never touched. */
function trimToCap(runs: readonly WorkspaceRun[]): WorkspaceRun[] {
  if (runs.length <= RUN_HISTORY_CAP) return [...runs]
  const droppable = new Set(
    runs.filter(run => run.status !== 'running')
      .slice(0, runs.length - RUN_HISTORY_CAP)
      .map(run => run.id),
  )
  return runs.filter(run => !droppable.has(run.id))
}

/** What the runtime hands in when a run starts — the store assigns id/startedAt/status. */
export interface WorkspaceRunSeed {
  readonly workspaceId: string
  readonly instructionId: string
  readonly instructionName: string
  readonly trigger: 'manual' | 'cron' | 'agent'
  readonly steps: readonly string[]
  /**
   * Born-terminal variant: a missed cron window is recorded as one `missed`
   * row (ADR-0056 决定 5) — terminal at birth, no steps, finished at the
   * trigger moment. Absent (the default) births a `running` row.
   */
  readonly missed?: boolean
}

/**
 * Append one run row (status `running`, or `missed` for a missed cron
 * window — a missed row is born terminal). The history is a ring: past the
 * cap the oldest finalized rows fall off, running rows never.
 * @param kbRoot - the live KB root.
 * @param seed - the run's identity and initial step skeletons.
 * @param now - the trigger moment; defaults to now.
 * @returns the created row as stored.
 */
export function appendWorkspaceRun(kbRoot: string, seed: WorkspaceRunSeed, now: Date = new Date()): Promise<WorkspaceRun> {
  return withRunsLock(async () => {
    const runs = await readWorkspaceRuns(kbRoot)
    const run: WorkspaceRun = {
      id: newRunId(now),
      workspaceId: seed.workspaceId,
      instructionId: seed.instructionId,
      instructionName: seed.instructionName,
      trigger: seed.trigger,
      ...(seed.missed === true
        ? { status: 'missed' as const, finishedAt: now.toISOString(), steps: [] }
        : {
          status: 'running' as const,
          steps: seed.steps.map((prompt, index) => ({ index, promptSnapshot: prompt })),
        }),
      startedAt: now.toISOString(),
    }
    await writeWorkspaceRuns(kbRoot, trimToCap([...runs, run]))
    return run
  })
}

/** What the frontend scheduler reports when a fired schedule settles (born-terminal). */
export interface ScheduleRunSeed {
  /** The schedule definition's id (`sch_…`). */
  readonly scheduleId: string
  /** The schedule's display name at fire time. */
  readonly scheduleName: string
  /** The agent session the run lived in — the 任务 tab and kb_read_session_log anchor here. */
  readonly sessionId?: string
  /** The prompt the schedule fired with (snapshot, same discipline as workspace steps). */
  readonly prompt?: string
  /**
   * Lifecycle. `running` is the 2026-10-24 early report: the frontend
   * scheduler files the row the moment it fires, so a mid-run crash leaves a
   * body the boot healer can finalize — born-terminal rows (the other three)
   * are the classic settle-time report.
   */
  readonly status: 'running' | 'success' | 'failed' | 'stopped'
  /** ISO timestamp the session was created. */
  readonly startedAt: string
  /** ISO timestamp the run settled; absent on the early `running` report. */
  readonly finishedAt?: string
  /** The final answer's excerpt (or the failure message when the run threw). */
  readonly finalResult?: string
  /** Why the run failed, when it did. */
  readonly error?: string
}

/**
 * Append one `schedule` row (the frontend scheduler's write path). Normally
 * born-terminal — the fired session has already settled by the time the
 * report arrives — but since 2026-10-24 the scheduler also files a `running`
 * row at fire time and patches it via {@link patchWorkspaceRun} on settle, so
 * a crash between fire and settle leaves a body instead of silence.
 * @param kbRoot - the live KB root.
 * @param seed - the run's identity and outcome.
 * @returns the created row as stored.
 */
export function appendScheduleRun(kbRoot: string, seed: ScheduleRunSeed, now: Date = new Date()): Promise<WorkspaceRun> {
  return withRunsLock(async () => {
    const runs = await readWorkspaceRuns(kbRoot)
    const run: WorkspaceRun = {
      id: newRunId(now),
      instructionId: seed.scheduleId,
      instructionName: seed.scheduleName,
      trigger: 'schedule',
      status: seed.status,
      startedAt: seed.startedAt,
      ...(seed.finishedAt !== undefined ? { finishedAt: seed.finishedAt } : {}),
      ...(seed.finalResult !== undefined ? { finalResult: clamp(seed.finalResult, RESULT_EXCERPT_MAX) } : {}),
      ...(seed.error !== undefined ? { error: clamp(seed.error, ERROR_MAX) } : {}),
      steps: seed.sessionId !== undefined
        ? [{ index: 0, promptSnapshot: seed.prompt ?? '', sessionId: seed.sessionId }]
        : [],
    }
    await writeWorkspaceRuns(kbRoot, trimToCap([...runs, run]))
    return run
  })
}

/** A patch onto one run row; `undefined` leaves a field alone, `null` clears it. */
export interface WorkspaceRunPatch {
  readonly status?: WorkspaceRun['status']
  readonly finishedAt?: string | null
  readonly failedStep?: number | null
  readonly finalResult?: string | null
  readonly steps?: readonly WorkspaceRunStep[]
}

/**
 * Patch one run row in place — the chain runtime's write path as steps spawn,
 * succeed, and fail. Unknown ids refuse; a terminal status must arrive with
 * its `finishedAt` (the runtime pairs them; the store only checks the
 * resulting row).
 * @param kbRoot - the live KB root.
 * @param runId - the row to patch.
 * @param patch - the changes.
 * @returns the full list as stored after the patch.
 */
export function patchWorkspaceRun(kbRoot: string, runId: string, patch: WorkspaceRunPatch): Promise<WorkspaceRun[]> {
  return withRunsLock(async () => {
    const runs = await readWorkspaceRuns(kbRoot)
    const run = runs.find(candidate => candidate.id === runId)
    if (run === undefined) {
      throw new KbError('workspace-run-not-found', `运行记录 ${runId} 不存在`)
    }
    const steps = patch.steps === undefined ? run.steps : patch.steps.map(step => ({
      ...step,
      ...(step.resultExcerpt !== undefined ? { resultExcerpt: clamp(step.resultExcerpt, RESULT_EXCERPT_MAX) } : {}),
      ...(step.error !== undefined ? { error: clamp(step.error, ERROR_MAX) } : {}),
    }))
    const status = patch.status ?? run.status
    const finishedAt = patch.finishedAt === undefined ? run.finishedAt : patch.finishedAt
    if (status !== 'running' && (finishedAt === undefined || finishedAt === null)) {
      throw new KbError('bad-workspace-run', `运行记录「${runId}」落到终态 ${status} 却没有结束时间`)
    }
    const next = runs.map(candidate => candidate.id !== runId ? candidate : {
      ...candidate,
      status,
      ...steps !== run.steps ? { steps } : {},
      ...finishedAt !== null && finishedAt !== undefined ? { finishedAt } : {},
      ...patch.failedStep !== undefined && patch.failedStep !== null ? { failedStep: patch.failedStep } : {},
      ...patch.finalResult !== undefined && patch.finalResult !== null
        ? { finalResult: clamp(patch.finalResult, RESULT_EXCERPT_MAX) }
        : {},
    })
    await writeWorkspaceRuns(kbRoot, trimToCap(next))
    return next
  })
}

/**
 * Clear the history on the human's gesture (工作区 tab 一键清空): every
 * finalized row goes. Rows still `running` stay — a live chain's runtime
 * will patch its row as steps settle, and erasing it would make that patch
 * fail with `workspace-run-not-found` while the chain itself keeps running.
 * @param kbRoot - the live KB root.
 * @returns how many rows were dropped.
 */
export async function clearWorkspaceRuns(kbRoot: string): Promise<number> {
  return withRunsLock(async () => {
    const runs = await readWorkspaceRuns(kbRoot)
    const kept = runs.filter(run => run.status === 'running')
    if (kept.length === runs.length) return 0
    await writeWorkspaceRuns(kbRoot, kept)
    return runs.length - kept.length
  })
}

/**
 * Delete one history row on the human's gesture (2026-10-15 截图评审：每条
 * 历史记录一个独立的删除动作). A row still `running` refuses — a live
 * chain's runtime will patch its row as steps settle, and erasing it would
 * make that patch fail with `workspace-run-not-found` while the chain itself
 * keeps running; stop the run first. Unknown ids refuse loudly, same as the
 * patch path.
 * @param kbRoot - the live KB root.
 * @param runId - the row to delete.
 * @returns the full list as stored after the deletion.
 */
export function deleteWorkspaceRun(kbRoot: string, runId: string): Promise<WorkspaceRun[]> {
  return withRunsLock(async () => {
    const runs = await readWorkspaceRuns(kbRoot)
    const run = runs.find(candidate => candidate.id === runId)
    if (run === undefined) {
      throw new KbError('workspace-run-not-found', `运行记录 ${runId} 不存在`)
    }
    if (run.status === 'running') {
      throw new KbError('workspace-run-live', `运行记录 ${runId} 还在运行，先停止再删除`)
    }
    const remaining = runs.filter(candidate => candidate.id !== runId)
    await writeWorkspaceRuns(kbRoot, remaining)
    return remaining
  })
}

/**
 * Boot-time healing (ADR-0056 决定 4；2026-10-24 扩到调度行): every row still
 * marked `running` is a run whose process died with the last controller.
 * Workspace-chain rows are marked `interrupted` — nobody was watching, the
 * adjudication says stay silent. Schedule rows are unattended work: they are
 * marked `failed` with an explanatory error, so the healer's caller can
 * broadcast them and the DingTalk pipe finally hears about the crash.
 * Never catches up, never re-runs.
 * @param kbRoot - the live KB root.
 * @param now - the boot moment.
 * @returns the finalized rows, in stored order.
 */
export async function finalizeInterruptedRuns(kbRoot: string, now: Date = new Date()): Promise<WorkspaceRun[]> {
  return withRunsLock(async () => {
    const runs = await readWorkspaceRuns(kbRoot)
    const stale = runs.filter(run => run.status === 'running')
    if (stale.length === 0) return []
    const finishedAt = now.toISOString()
    // 调度行是无人值守的工作：补记落 failed 并带原因，让调用方广播出去、
    // 钉钉管道终于听得见崩溃；interrupted 的「不推」裁决只针对有人在看的
    // 工作区链（run-push.ts 的 ADR-0065 决定 3 注释）。
    const stamped = new Map(stale.map(run => [run.id, run.trigger === 'schedule'
      ? {
        ...run,
        status: 'failed' as const,
        finishedAt,
        error: clamp('运行中断：应用在执行途中退出，未能等到任务收尾（下次启动补记）', ERROR_MAX),
      }
      : {
        ...run,
        status: 'interrupted' as const,
        finishedAt,
      }]))
    await writeWorkspaceRuns(kbRoot, trimToCap(runs.map(run => stamped.get(run.id) ?? run)))
    return runs.filter(run => stamped.has(run.id)).map(run => stamped.get(run.id) as WorkspaceRun)
  })
}
