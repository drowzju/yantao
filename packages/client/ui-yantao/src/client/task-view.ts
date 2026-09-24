/**
 * The 任务 tab's row model (ADR-0031): one row per task execution the
 * workbench itself started this session — refine gestures, mail analyses,
 * script capability runs — aggregated in the frame from the three owners of
 * run state. Pure — no React, no Remote — so the ordering and the counting
 * are pinned by unit tests instead of by a rendered tree.
 *
 * Frontend memory only: a refresh forgets every row (the KB and the named
 * sessions hold the outcomes). Agent-initiated runs never appear here — the
 * workbench never sees them; that is a documented limitation, not a gap.
 * @module @deepseek-ai/dsh-client-ui-yantao/task-view
 */

/** Which of the workbench's three task families a row belongs to. */
export type TaskKind = 'refine' | 'mail' | 'capability'

/**
 * Where a task is in its life: `running` until it pauses for the human
 * (`waiting` — a refine question dialog, a mail proposal card) or ends as
 * `done`, `cancelled` or `failed`.
 */
export type TaskStatus = 'running' | 'waiting' | 'done' | 'cancelled' | 'failed'

/** One task execution as the 任务 tab renders it. */
export interface TaskRow {
  /** Identity within this session (`task-1`, `task-2`, …). */
  readonly id: string
  readonly kind: TaskKind
  /** 「动作＋对象」— the one line the list is scanned by. */
  readonly title: string
  /** The stage the task reached, or the one-line outcome once ended. */
  readonly stage: string
  /** Finer progress detail (e.g. 已判 3/12 封), when there is any. */
  readonly detail: string | null
  readonly status: TaskStatus
  /** When the task began (epoch ms). */
  readonly startedAt: number
  /** When the task ended, or null while it has not. */
  readonly endedAt: number | null
  /**
   * The session the task ran in, when it ran in one (refine and mail analysis
   * do; script capabilities are bare subprocesses — ADR-0033). Null rows
   * render no 「详情」 entry; backfilled by the run owners as soon as the
   * session exists.
   */
  readonly sessionId: string | null
}

/**
 * The list's order: running first (oldest start on top — the queue drains in
 * the order it was fed), then the waiting, then the endings newest first.
 * @param rows - the frame's task rows in arrival order.
 * @returns the rows in display order.
 */
export function sortTaskRows(rows: readonly TaskRow[]): readonly TaskRow[] {
  const running = rows.filter(row => row.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
  const waiting = rows.filter(row => row.status === 'waiting').sort((a, b) => a.startedAt - b.startedAt)
  const ended = rows
    .filter(row => row.status !== 'running' && row.status !== 'waiting')
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return [...running, ...waiting, ...ended]
}

/** How many rows the 任务 tab's badge counts: the ones still going. */
export function runningCount(rows: readonly TaskRow[]): number {
  return rows.filter(row => row.status === 'running').length
}

/**
 * A wall-clock duration as `mm:ss` (or `h:mm:ss` past the hour) — the
 * elapsed column's whole vocabulary.
 * @param ms - the duration in milliseconds.
 * @returns the formatted duration.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
