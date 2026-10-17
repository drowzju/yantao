/**
 * The scheduled-run registry (ADR-0061 决定 1): the one trusted answer to
 * "who is calling this tool" — the frontend scheduler books each fired
 * run's session here over RPC before prompting, and the `kb_add_todo` tool
 * consults the booking to decide between a direct write (an interactive
 * conversation, where the human's request IS the approval) and a refusal
 * that steers the model to `kb_propose_actions` (a scheduled run writes
 * only through the proposal inbox — the trust anchor of ADR-0047).
 *
 * In-memory by design: bookings are per-host-lifetime ephemera, a crashed
 * host has nothing stale to leak, and the TTL is the belt to the
 * `forget` call's suspenders — a run that dies without forgetting (UI
 * closed mid-fire, crash) ages out instead of blocking that session's
 * writes forever.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/scheduled-runs
 */

/** How long a booking outlives its fire before expiring on its own. */
export const SCHEDULED_RUN_TTL_MS = 30 * 60_000

/**
 * The session-id → expiry booking for scheduled runs. Expired entries are
 * lazy-evicted on read: an expired booking reads as interactive.
 */
export class ScheduledRunRegistry {
  private readonly runs = new Map<string, number>()

  /**
   * Book one session as a scheduled run.
   * @param sessionId - the fired run's session.
   * @param ttlMs - how long the booking stays live; defaults to {@link SCHEDULED_RUN_TTL_MS}.
   */
  mark(sessionId: string, ttlMs: number = SCHEDULED_RUN_TTL_MS): void {
    this.runs.set(sessionId, Date.now() + Math.max(0, ttlMs))
  }

  /** Release one booking — the run's normal exit path (finally). @returns whether a live-or-stale booking existed. */
  forget(sessionId: string): boolean {
    return this.runs.delete(sessionId)
  }

  /**
   * Whether the session is a booked, unexpired scheduled run. A missing or
   * expired booking means interactive — the direct-write lane.
   * @param sessionId - the calling tool run's session.
   */
  isScheduled(sessionId: string): boolean {
    const expiresAt = this.runs.get(sessionId)
    if (expiresAt === undefined) return false
    if (Date.now() >= expiresAt) {
      this.runs.delete(sessionId)
      return false
    }
    return true
  }
}
