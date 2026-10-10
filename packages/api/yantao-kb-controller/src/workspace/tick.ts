/**
 * The workspace tick's decision logic (ADR-0056 决定 5): a pure port of the
 * frontend scheduler's `scheduleScan`/`scheduleBaseline` semantics
 * (`ui-yantao/src/client/scheduler.ts`) onto workspace instructions. The
 * controller owns the interval (execution must survive the UI — 决定 4), so
 * the due/missed decision moved host-side; the semantics stay identical:
 *
 * - a disabled instruction or an unparseable cron waits;
 * - the baseline is the latest accounted fire — real (`lastFiredAt`) or
 *   marked-missed (`lastMissedAt`) — falling back to the creation time the
 *   instruction id embeds, so a freshly created instruction does not
 *   instantly "miss" a window that passed before it existed;
 * - the next fire after the baseline is fresh (inside the tolerance) →
 *   fire, stale → missed and never caught up (决定 5).
 *
 * Kept React-free and DOM-free so the decision is pinned by unit tests; the
 * parity with the client matcher is pinned by `tests/cron-parity.spec.ts`.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/workspace/tick
 */

import { cronNextAfter, parseCron, type WorkspaceInstruction } from '@deepseek-ai/dsh-yantao-kb'

/** The instruction slice the scan needs — the full row in practice. */
export type ScannableInstruction = Pick<
  WorkspaceInstruction,
  'id' | 'cron' | 'enabled' | 'lastFiredAt' | 'lastMissedAt'
>

/** What one tick decided for one instruction. */
export type WorkspaceTickAction =
  /** Fire now: the due time is fresh (inside the tolerance). */
  | { readonly kind: 'fire'; readonly at: Date }
  /** Mark as missed: the due time is older than the tolerance — no catch-up (ADR-0056 决定 5). */
  | { readonly kind: 'missed'; readonly at: Date }
  /** Nothing due. */
  | { readonly kind: 'wait' }

/**
 * The creation time an instruction id embeds (`ins_<base36 ms>_<random>`) —
 * the baseline for an instruction that never fired and never missed.
 * @param id - the instruction's stable id.
 * @returns the creation time, or null for a foreign id shape.
 */
export function instructionCreatedAt(id: string): Date | null {
  const match = /^ins_([0-9a-z]+)_/.exec(id)
  const stamp = match?.[1]
  if (stamp === undefined) return null
  const ms = Number.parseInt(stamp, 36)
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null
}

/**
 * The instant an instruction measures its next fire from: the latest
 * accounted fire — real or marked-missed — falling back to its creation
 * time, and finally to the epoch.
 * @param instruction - the row to baseline.
 */
export function instructionBaseline(instruction: ScannableInstruction): Date {
  const stamps = [instruction.lastFiredAt, instruction.lastMissedAt]
    .filter((stamp): stamp is string => typeof stamp === 'string')
    .map(stamp => Date.parse(stamp))
    .filter(ms => !Number.isNaN(ms))
  const created = instructionCreatedAt(instruction.id)?.getTime()
  return new Date(Math.max(0, ...stamps, ...(created === undefined ? [] : [created])))
}

/**
 * Decide one instruction's action on a tick. Same shape as the frontend's
 * `scheduleScan` (ADR-0045 决定 2) — the two decisions must stay twins.
 * @param instruction - the row to scan.
 * @param now - the tick's instant.
 * @param toleranceMs - how old a due time may be and still count as a live
 *   fire rather than a missed one; should cover the scan interval.
 */
export function workspaceTickScan(instruction: ScannableInstruction, now: Date, toleranceMs: number): WorkspaceTickAction {
  if (!instruction.enabled) return { kind: 'wait' }
  if (instruction.cron === undefined) return { kind: 'wait' }
  const parsed = parseCron(instruction.cron)
  if (parsed === null) return { kind: 'wait' }
  const next = cronNextAfter(parsed, instructionBaseline(instruction))
  if (next === null || next.getTime() > now.getTime()) return { kind: 'wait' }
  return now.getTime() - next.getTime() > toleranceMs
    ? { kind: 'missed', at: next }
    : { kind: 'fire', at: next }
}
