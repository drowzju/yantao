/**
 * Age-based sweep of the capability scratch directory (`resources/temp/`).
 *
 * The capability environment note has told every capability, since 2026-10-09,
 * that `resources/temp/` is scratch — "用完即弃，无人清理". The second half was
 * literally true: nothing cleaned it, and the directory had grown to 23MB of
 * weekly-run working files by 2026-10-25. This is the missing half.
 *
 * Scope is deliberately narrow. It removes only entries directly under
 * `resources/temp/` whose mtime is older than the cutoff, and it never touches
 * anything else under `resources/` — a capability's real output lands beside
 * temp, not in it, and deleting user-visible output is not this module's job.
 * @module @deepseek-ai/dsh-yantao-kb-controller/temp-sweep
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * How old a temp entry must be before the sweep removes it.
 *
 * A week is far longer than any single run (the longest scheduled chain is an
 * evening's worth of steps), so a live run can never lose its own scratch
 * directory to this. It is short enough that the directory stops growing.
 */
export const TEMP_SWEEP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** What one sweep did — returned rather than logged so callers own the reporting. */
export interface TempSweepResult {
  /** Entry names removed, relative to the temp root. */
  readonly removed: readonly string[]
  /** Entry names kept because they were young enough, unreadable, or racing. */
  readonly kept: readonly string[]
}

/**
 * Remove stale entries from one temp root.
 *
 * Best-effort by design: a sweep that cannot read the directory, or that loses
 * a race against a run recreating an entry, reports what it managed and moves
 * on. Failing the controller's boot over scratch cleanup would be the wrong
 * trade — the caller wraps this in a catch anyway.
 * @param tempRoot - absolute path to `<kbRoot>/resources/temp`.
 * @param maxAgeMs - age past which an entry is removed.
 * @param now - epoch milliseconds treated as "now" (injected for tests).
 * @returns the entries removed and kept.
 */
export async function sweepTempDir(
  tempRoot: string,
  maxAgeMs: number = TEMP_SWEEP_MAX_AGE_MS,
  now: number = Date.now(),
): Promise<TempSweepResult> {
  let names: string[]
  try {
    names = await readdir(tempRoot)
  } catch {
    return { removed: [], kept: [] }
  }

  const removed: string[] = []
  const kept: string[] = []
  for (const name of names) {
    const target = join(tempRoot, name)
    try {
      const info = await stat(target)
      if (now - info.mtimeMs < maxAgeMs) {
        kept.push(name)
        continue
      }
      await rm(target, { recursive: true, force: true })
      removed.push(name)
    } catch {
      kept.push(name)
    }
  }
  return { removed, kept }
}
