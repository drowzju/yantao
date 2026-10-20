/**
 * The run-scoped staging file behind `kb_propose_actions({ draft: true })`
 * (2026-10-20 分批落盘批次): a scheduled mail run's nomination is assembled
 * over several batches, and the intermediate rows must live OUTSIDE the
 * model's context — compaction is lossy, and the 10:10 run's 32-row card died
 * exactly because the raw scan (with every `entryId`) had been summarized away
 * before the card was written. The staging file is the meeting point: the
 * tool appends draft rows, the mail capability's `stage_actions.py` appends
 * rows it built from live EntryIDs, and the final `kb_propose_actions` call
 * merges both into ONE card.
 *
 * Shape: a JSON array of action objects, exactly as the model would have
 * handed them over. Fail-open by design: an unreadable or corrupt file reads
 * as empty (the cost is one more batch, never a lost card), and every write
 * is a merge — the file is re-read before the atomic replace, so two writers
 * racing (a script and the tool) cannot drop each other's rows.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/proposal-staging
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Staged rows older than this are pruned on the next write — a crashed run
 * must not leak its half-built card into tomorrow's. */
const STAGING_MAX_AGE_HOURS = 24

/**
 * The staging file of one run: `<kb>/.dsh/yantao/proposal-staging/<run>.json`.
 * Mirrors `runLedgerPathOf` (exec.ts) — same sanitizing, same one-file-per-run
 * idea — so a run's ledger and its staging live side by side.
 * @param kbRoot - the knowledge base root.
 * @param runToken - the run's key (the session id in practice).
 * @returns the absolute staging path.
 */
export function stagingPathOf(kbRoot: string, runToken: string): string {
  const safe = runToken.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'anonymous'
  return join(resolve(kbRoot), '.dsh', 'yantao', 'proposal-staging', `${safe}.json`)
}

/**
 * Read the staged rows. Fail-open: a missing, unreadable or non-array file
 * yields `[]` — a staging read must never be the reason a run cannot finish.
 * @param path - the staging path, or undefined when the caller has no run scope.
 * @returns the staged action rows, in append order.
 */
export async function readStagedActions(path: string | undefined): Promise<readonly unknown[]> {
  if (path === undefined) return []
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * One row's merge key: mail rows are keyed by their knife's EntryID (the same
 * mail may be re-staged after a repair, and only the last copy should win),
 * everything else by its full serialization — a row staged twice verbatim is
 * one row.
 */
function stagingKey(action: unknown): string {
  if (typeof action === 'object' && action !== null) {
    const bag = action as Record<string, unknown>
    if (typeof bag.kind === 'string' && typeof bag.entryId === 'string' && bag.entryId !== '') {
      return `${bag.kind}|${bag.entryId}`
    }
  }
  return `raw|${JSON.stringify(action)}`
}

/**
 * Merge new rows into the staging file and return the new total. Re-reads
 * before writing (merge, not overwrite) and replaces atomically, so a script
 * and the tool can both append without losing each other's rows. Rows with
 * the same {@link stagingKey} keep the NEWER copy (repair wins).
 * @param path - the staging path.
 * @param actions - the validated rows to append.
 * @returns how many rows the file holds after the merge.
 */
export async function appendStagedActions(path: string, actions: readonly unknown[]): Promise<number> {
  const existing = [...await readStagedActions(path)]
  const index = new Map<string, number>()
  existing.forEach((row, at) => index.set(stagingKey(row), at))
  for (const row of actions) {
    const key = stagingKey(row)
    const at = index.get(key)
    if (at === undefined) {
      index.set(key, existing.length)
      existing.push(row)
    } else {
      existing[at] = row
    }
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(existing, null, 1)}\n`, 'utf8')
  await rename(temporary, path)
  await pruneStaging(dirname(path))
  return existing.length
}

/**
 * Drop a run's staging file after its card has been enqueued (or after the
 * run decided to abandon it). Missing file is fine — clearing is idempotent.
 * @param path - the staging path, or undefined when there is no run scope.
 */
export async function clearStagedActions(path: string | undefined): Promise<void> {
  if (path === undefined) return
  await rm(path, { force: true })
}

/**
 * Delete staging files whose mtime is older than {@link STAGING_MAX_AGE_HOURS}
 * — a crashed run's half-built card must not linger. Best-effort: a directory
 * that cannot be listed is simply left alone.
 * @param directory - the staging directory.
 */
async function pruneStaging(directory: string): Promise<void> {
  try {
    const cutoff = Date.now() - STAGING_MAX_AGE_HOURS * 3600_000
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const path = join(directory, entry.name)
      const info = await stat(path)
      if (info.mtimeMs < cutoff) await rm(path, { force: true })
    }
  } catch {
    // Pruning is housekeeping; never fail a write over it.
  }
}
