/**
 * The workspace runtime (ADR-0056 决定 4): the controller-side executor that
 * spawns the bound agent for one instruction's prompt chain. The controller
 * owns the child processes, so a run survives the UI hiding, refreshing, or
 * dying — the renderer never spawns anything.
 *
 * Per step the runtime spawns `codebuddy -p -y --output-format json` with
 * `cwd` pinned to the workspace's directory, the prompt delivered on stdin
 * (keeps argv free of user text — no shell-quoting surface on any platform),
 * and reads the single-result JSON back for `session_id` and `result`. Step
 * N+1 resumes step N's session (`--resume`), the 会话延续链 of ADR-0056
 * 决定 3. Any step that exits non-zero, fails to spawn, or answers
 * unparseable output BREAKS the chain (决定 3: no tolerance — the later
 * steps depend on the earlier steps' output); the run row records which
 * step broke it.
 *
 * Deliberately absent (ADR-0056 决定 4, 用户裁决): no timeout, no global
 * concurrency cap. The one guard is re-entry: a cron whose previous fire is
 * still running does not stack a second chain — the window is consumed
 * (marked fired) and nothing spawns. Stop is `taskkill /T /F` on Windows,
 * a detached-group SIGKILL on POSIX — the exec bridge's recipe (ADR-0043).
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/workspace/runtime
 */

import { spawn as nodeSpawn } from 'node:child_process'
import {
  appendWorkspaceRun,
  finalizeInterruptedRuns,
  patchWorkspaceRun,
  type WorkspaceDef,
  type WorkspaceInstruction,
  type WorkspaceRun,
  type WorkspaceRunStep,
} from '@deepseek-ai/dsh-yantao-kb'

/** How much of one step's stdout is kept before truncation is marked. */
const MAX_STEP_STDOUT_BYTES = 1024 * 1024

/** How much of one step's stderr feeds a failure message. */
const MAX_STEP_STDERR_BYTES = 64 * 1024

/** One live chain's in-process handle — what a stop gesture reaches. */
interface LiveRun {
  readonly runId: string
  readonly instructionId: string
  /** Set synchronously by {@link stop}; the chain checks it after every await. */
  stopped: boolean
  /** Kills the currently running step's process tree, when one is running. */
  kill: (() => void) | undefined
}

/** What one spawned step answered. */
interface StepOutcome {
  readonly exitCode: number | null
  /** The single-result JSON's `result` text, when the step succeeded parseably. */
  readonly result?: string
  /** The agent session the step ran in, when the JSON carried one. */
  readonly sessionId?: string
  /** A fatal, non-exit-code failure (spawn error, unparseable output). */
  readonly error?: string
  /** The tail of stderr, riding along on a non-zero exit for the run row. */
  readonly stderrHint?: string
}

/** Options of {@link WorkspaceRuntime}. */
export interface WorkspaceRuntimeOptions {
  /** The live KB root accessor — the stores live beside it. */
  readonly kbRoot: () => string
}

/**
 * Runs workspace instructions: appends the run row, walks the prompt chain
 * step by step, patches the row as steps spawn and settle, and breaks the
 * chain on the first failure. The controller holds one instance; the RPCs
 * and the cron tick both trigger through it.
 */
export class WorkspaceRuntime {
  private readonly options: WorkspaceRuntimeOptions
  private readonly live = new Map<string, LiveRun>()

  /**
   * The spawn to use; tests swap this on the instance before triggering so
   * no CLI is ever touched. The kill path (`taskkill` on Windows) routes
   * through the same injectable, so a fake can script both.
   */
  spawnImpl: typeof nodeSpawn

  constructor(options: WorkspaceRuntimeOptions) {
    this.options = options
    this.spawnImpl = nodeSpawn
  }

  /** Whether this instruction has a chain still running in this process. */
  hasRunning(instructionId: string): boolean {
    for (const run of this.live.values()) {
      if (run.instructionId === instructionId) return true
    }
    return false
  }

  /**
   * Trigger one instruction (manual or cron): append the `running` row, then
   * walk the chain in the background. Resolves with the run id as soon as
   * the row exists — the chain itself is nobody's await.
   * @param space - the owning workspace (directory/model binding).
   * @param instruction - the instruction to run.
   * @param trigger - what pulled the trigger.
   * @returns the new run's id.
   */
  async trigger(space: WorkspaceDef, instruction: WorkspaceInstruction, trigger: 'manual' | 'cron'): Promise<string> {
    const kbRoot = this.options.kbRoot()
    const run = await appendWorkspaceRun(kbRoot, {
      workspaceId: space.id,
      instructionId: instruction.id,
      instructionName: instruction.name,
      trigger,
      steps: instruction.steps,
    })
    const live: LiveRun = { runId: run.id, instructionId: instruction.id, stopped: false, kill: undefined }
    this.live.set(run.id, live)
    void this.executeChain(kbRoot, run, space, live)
      .catch((error: unknown) => {
        // The chain's own patches are individually guarded; reaching here
        // means the bookkeeping itself blew up — leave the loudest trace.
        console.warn(`workspace chain for run ${run.id} crashed:`, error)
      })
      .finally(() => { this.live.delete(run.id) })
    return run.id
  }

  /**
   * Stop one running chain: kill the current step's process tree and mark
   * the row `stopped`. The chain observes the flag after its pending await
   * and quits without further patches.
   * @param runId - the run to stop.
   * @returns false when the run is not live in this process (already
   *   settled, or inherited from a previous controller).
   */
  stop(runId: string): boolean {
    const live = this.live.get(runId)
    if (live === undefined) return false
    live.stopped = true
    live.kill?.()
    const finishedAt = new Date().toISOString()
    void patchWorkspaceRun(this.options.kbRoot(), runId, { status: 'stopped', finishedAt })
      .catch((error: unknown) => { console.warn(`stop-patch for run ${runId} failed:`, error) })
    return true
  }

  /**
   * Boot-time healing (ADR-0056 决定 4): rows still `running` belong to a
   * dead controller — mark them `interrupted`. Never re-runs.
   * @returns how many rows were finalized.
   */
  healOnBoot(): Promise<number> {
    return finalizeInterruptedRuns(this.options.kbRoot())
  }

  /** Release everything on controller teardown: kill the live trees, mark the rows interrupted. */
  dispose(): void {
    for (const live of this.live.values()) {
      live.stopped = true
      live.kill?.()
      const finishedAt = new Date().toISOString()
      void patchWorkspaceRun(this.options.kbRoot(), live.runId, { status: 'interrupted', finishedAt })
        .catch(() => undefined)
    }
    this.live.clear()
  }

  /** Walk the prompt chain, patching the row as it goes; any failure breaks. */
  private async executeChain(kbRoot: string, run: WorkspaceRun, space: WorkspaceDef, live: LiveRun): Promise<void> {
    // The working copy of the step list: every patch rebuilds it so the next
    // patch carries the previous ones too (patches replace the whole list).
    let steps = [...run.steps]
    let resumedSessionId: string | undefined
    let lastResult: string | undefined
    for (const step of run.steps) {
      if (live.stopped) return
      steps = withStepEnd(steps, step.index, { startedAt: new Date().toISOString() })
      await patchWorkspaceRun(kbRoot, run.id, { steps })
      let outcome: StepOutcome
      try {
        outcome = await this.runStep(space, step, resumedSessionId, live)
      } catch (error: unknown) {
        outcome = { exitCode: null, error: (error as Error).message }
      }
      if (live.stopped) return // stopRun already patched the row; do not overwrite it
      if (outcome.error !== undefined || outcome.exitCode !== 0) {
        const failedAt = new Date().toISOString()
        const errorText = outcome.error ?? `退出码 ${outcome.exitCode ?? '未知'}${outcome.stderrHint === undefined ? '' : `：${outcome.stderrHint}`}`
        await patchWorkspaceRun(kbRoot, run.id, {
          status: 'failed',
          finishedAt: failedAt,
          failedStep: step.index,
          finalResult: lastResult ?? null,
          steps: withStepEnd(steps, step.index, { finishedAt: failedAt, exitCode: outcome.exitCode, error: errorText }),
        })
        return
      }
      resumedSessionId = outcome.sessionId
      lastResult = outcome.result
      steps = withStepEnd(steps, step.index, {
        finishedAt: new Date().toISOString(),
        exitCode: outcome.exitCode,
        ...(outcome.sessionId !== undefined ? { sessionId: outcome.sessionId } : {}),
        ...(outcome.result !== undefined ? { resultExcerpt: outcome.result } : {}),
      })
      await patchWorkspaceRun(kbRoot, run.id, { steps })
    }
    await patchWorkspaceRun(kbRoot, run.id, {
      status: 'success',
      finishedAt: new Date().toISOString(),
      finalResult: lastResult ?? null,
    })
  }

  /**
   * Spawn one chain step: `codebuddy -p -y --output-format json` with the
   * prompt on stdin, `cwd` pinned to the workspace directory, optional
   * `--model` / `--resume`. Resolves when the process settles; the outcome
   * is reported, never thrown (except bookkeeping bugs).
   */
  private runStep(space: WorkspaceDef, step: WorkspaceRunStep, resumeSessionId: string | undefined, live: LiveRun): Promise<StepOutcome> {
    const args = ['-p', '-y', '--output-format', 'json']
    if (space.model !== undefined) args.push('--model', space.model)
    if (resumeSessionId !== undefined) args.push('--resume', resumeSessionId)
    const child = this.spawnImpl('codebuddy', args, {
      cwd: space.directory,
      shell: true, // Windows: the npm shim is a .cmd; every token here is shell-safe (the prompt rides stdin)
      windowsHide: true,
      // POSIX only: the process becomes a group leader so stop can reap the tree with one signal.
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return new Promise<StepOutcome>((resolveStep) => {
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0

      /** Kill the whole tree — the exec bridge's recipe (ADR-0043 决定 2). */
      const killTree = (): void => {
        const pid = child.pid
        if (pid === undefined || pid <= 0) {
          child.kill()
          return
        }
        if (process.platform === 'win32') {
          const killer = this.spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
          killer.once('error', () => { child.kill() })
        } else {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
        }
      }
      live.kill = killTree

      const settle = (outcome: StepOutcome): void => {
        live.kill = undefined
        resolveStep(outcome)
      }

      child.stdin.on('error', () => {
        // A CLI that exits before reading stdin breaks the pipe; the close
        // handler reports the real outcome.
      })
      child.stdin.end(step.promptSnapshot, 'utf8')

      child.stdout.on('data', (chunk: Buffer | string) => {
        if (stdoutBytes > MAX_STEP_STDOUT_BYTES) return
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
        stdoutChunks.push(bytes)
        stdoutBytes += bytes.length
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        if (stderrBytes > MAX_STEP_STDERR_BYTES) return
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
        stderrChunks.push(bytes)
        stderrBytes += bytes.length
      })
      child.on('error', (error: Error) => {
        settle({ exitCode: null, error: `无法启动 codebuddy：${error.message}` })
      })
      child.on('close', (code: number | null) => {
        const stderrText = Buffer.concat(stderrChunks).toString('utf8')
        if (code !== 0) {
          settle({
            exitCode: code,
            ...(stderrText.trim() !== '' ? { stderrHint: stderrText.trim().slice(-MAX_STEP_STDERR_BYTES) } : {}),
          })
          return
        }
        // `--output-format json` is the SINGLE-result contract: stdout is one
        // JSON object carrying `result` and `session_id`.
        const raw = Buffer.concat(stdoutChunks).toString('utf8')
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          const clipped = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
          settle({ exitCode: code, error: `codebuddy 输出不是合法 JSON：${clipped}` })
          return
        }
        const record = parsed as { result?: unknown; session_id?: unknown }
        const result = typeof record.result === 'string' ? record.result : undefined
        if (result === undefined) {
          settle({ exitCode: code, error: 'codebuddy 输出缺少 result 字段' })
          return
        }
        settle({
          exitCode: code,
          result,
          ...(typeof record.session_id === 'string' && record.session_id !== '' ? { sessionId: record.session_id } : {}),
        })
      })
    })
  }
}

/** Copy of the step list with one step's fields merged in (whole-record patch). */
function withStepEnd(
  steps: readonly WorkspaceRunStep[],
  index: number,
  patch: Partial<Omit<WorkspaceRunStep, 'index' | 'promptSnapshot'>>,
): WorkspaceRunStep[] {
  return steps.map(step => step.index !== index ? step : { ...step, ...patch })
}
