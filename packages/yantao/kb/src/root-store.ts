/**
 * The capability state store: one JSON file per KB at
 * `<kbRoot>/.dsh/yantao/state.json` holding
 * `{ "capabilities": { "<name>": { "state": …, "lastRunAt": … } } }`.
 * It carries each capability's machine state (ADR-0021: the generalized form
 * of ADR-0019's mail watermark), because a cursor belongs to the knowledge
 * base it was read for, and not to the KB itself — that is markdown for
 * humans, not a place for machine state. ADR-0024 puts the file *inside* the
 * KB (backup = copy the directory), under the KB's single `.dsh/` bookkeeping
 * directory (2026-09-17 revision: `.yantao/` was folded into `.dsh/yantao/`);
 * the KB pointer itself moved to the settings plane, and the retired
 * `~/.dsh/yantao-kb.json` is read once by {@link importLegacyRootState} and
 * never written again.
 * @module @deepseek-ai/dsh-yantao-kb/root-store
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** One capability's persisted machine state (ADR-0021). */
interface CapabilityState {
  /** The capability's own state; its shape is the capability's business. */
  state?: unknown
  /** ISO 8601 timestamp of the most recent completed run. */
  lastRunAt?: string
}

/** The whole persisted state: the capabilities bound to one KB root. */
interface CapabilityStateFile {
  /** Per-capability machine state; never mirrored into the KB's markdown. */
  capabilities?: Record<string, CapabilityState>
}

/** The state file's path: `<kbRoot>/.dsh/yantao/state.json`.
 * @param kbRoot - the knowledge-base root directory.
 * @returns the absolute path of the capability state file inside that KB.
 */
export function capabilityStatePath(kbRoot: string): string {
  return join(kbRoot, '.dsh', 'yantao', 'state.json')
}

/** Parse the state file's content; anything without a usable shape yields `undefined`. */
function parseCapabilityStateFile(raw: string): CapabilityStateFile | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    // The state is carried through as parsed, so keys a newer yantao added
    // survive a read-modify-write by this version.
    return parsed
  } catch {
    return undefined
  }
}

/** Read the whole state file for one KB, synchronously. */
function readCapabilityStateFile(kbRoot: string): CapabilityStateFile | undefined {
  const path = capabilityStatePath(kbRoot)
  try {
    if (!existsSync(path)) return undefined
    return parseCapabilityStateFile(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Write the whole state file for one KB, creating `<kbRoot>/.dsh/yantao` when it
 * is absent. A failing write surfaces as a rejected promise and leaves any
 * previous state untouched.
 */
async function writeCapabilityStateFile(kbRoot: string, state: CapabilityStateFile): Promise<void> {
  const path = capabilityStatePath(kbRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * Read one capability's persisted state (ADR-0021). Synchronous, like every
 * other read here — the runner asks for it while assembling a run.
 * @param kbRoot - the knowledge-base root directory.
 * @param name - the capability's kebab-case name.
 * @returns the state as the capability last left it, or `undefined` when it has never run.
 */
export function readCapabilityState(kbRoot: string, name: string): unknown {
  return readCapabilityStateFile(kbRoot)?.capabilities?.[name]?.state
}

/**
 * Persist one capability's state (ADR-0021), stamping the run that produced
 * it and leaving every other capability as it is.
 * @param kbRoot - the knowledge-base root directory.
 * @param name - the capability's kebab-case name.
 * @param state - the state to remember; it replaces the previous value whole.
 */
export async function writeCapabilityState(kbRoot: string, name: string, state: unknown): Promise<void> {
  const existing = readCapabilityStateFile(kbRoot)
  await writeCapabilityStateFile(kbRoot, {
    ...existing,
    capabilities: {
      ...existing?.capabilities,
      [name]: { ...existing?.capabilities?.[name], state, lastRunAt: new Date().toISOString() },
    },
  })
}

/** One capability's persisted record, as the capability tab's list shows it. */
export interface CapabilityRecord {
  /** The capability's own state; its shape is the capability's business. */
  readonly state?: unknown
  /** ISO 8601 timestamp of the most recent completed run, absent when it never ran. */
  readonly lastRunAt?: string
}

/**
 * Read one capability's whole persisted record — state plus run stamp — for
 * the capability list (ADR-0021 决定 8: the 清单 shows 上次运行/断点摘要).
 * @param kbRoot - the knowledge-base root directory.
 * @param name - the capability's kebab-case name.
 * @returns the record, or `undefined` when the capability has never run.
 */
export function readCapabilityRecord(kbRoot: string, name: string): CapabilityRecord | undefined {
  const slot = readCapabilityStateFile(kbRoot)?.capabilities?.[name]
  if (slot === undefined) return undefined
  return {
    ...slot.state !== undefined ? { state: slot.state } : {},
    ...slot.lastRunAt !== undefined ? { lastRunAt: slot.lastRunAt } : {},
  }
}

/**
 * Persist the mail connector's watermark, leaving every other capability as
 * it is. The watermark lives in the ADR-0021 `capabilities.mail` slot.
 * @param kbRoot - the knowledge-base root directory.
 * @param lastReadAt - the ISO 8601 timestamp to remember.
 * @param firstReadAt - the oldest mail of the batch just dealt with; stored as
 *   the minimum ever seen, so paging 往前 extends the processed range backward.
 * @returns the processed range as it now stands — `firstReadAt` present only
 *   when some run has named a start.
 */
export async function writeMailWatermark(kbRoot: string, lastReadAt: string, firstReadAt?: string): Promise<{
  lastReadAt: string
  firstReadAt?: string
}> {
  const existing = readCapabilityStateFile(kbRoot)
  const previous = existing?.capabilities?.mail
  const previousState = typeof previous?.state === 'object' && previous.state !== null ? previous.state : {}
  const previousFirstReadAt = typeof (previousState as { firstReadAt?: unknown }).firstReadAt === 'string'
    ? (previousState as { firstReadAt: string }).firstReadAt
    : undefined
  const mergedFirstReadAt = firstReadAt === undefined
    ? previousFirstReadAt
    : previousFirstReadAt !== undefined && previousFirstReadAt < firstReadAt ? previousFirstReadAt : firstReadAt
  await writeCapabilityStateFile(kbRoot, {
    ...existing,
    capabilities: {
      ...existing?.capabilities,
      mail: {
        ...previous,
        state: {
          ...previousState,
          lastReadAt,
          ...mergedFirstReadAt !== undefined ? { firstReadAt: mergedFirstReadAt } : {},
        },
        lastRunAt: new Date().toISOString(),
      },
    },
  })
  return {
    lastReadAt,
    ...mergedFirstReadAt !== undefined ? { firstReadAt: mergedFirstReadAt } : {},
  }
}

/** The retired pre-ADR-0024 state file: `~/.dsh/yantao-kb.json`. */
function legacyKbRootStatePath(): string {
  return join(homedir(), '.dsh', 'yantao-kb.json')
}

/**
 * One-time import of the retired `~/.dsh/yantao-kb.json` (ADR-0024 决定 2):
 * when the legacy file is readable and names a root whose
 * `<root>/.dsh/yantao/state.json` does not exist yet, the capability states move
 * into the KB and the legacy file is renamed `.bak` — explicitly recoverable,
 * never silently deleted. The legacy `root` itself is *returned* (the caller
 * seeds the settings-plane pointer with it) and the legacy `connectors.mail`
 * watermark is dropped — the cost is at most one repeated mail fetch.
 *
 * Synchronous because the plugin runs it at apply time, before it can await
 * anything. Every failure leaves the legacy file untouched so the next boot
 * retries; a `.bak` already in place means the import ran before.
 * @returns the legacy KB root when an import happened (or the states are
 *   already in place under it), otherwise `undefined`.
 */
export function importLegacyRootState(): string | undefined {
  const legacyPath = legacyKbRootStatePath()
  if (!existsSync(legacyPath)) return undefined
  let root: unknown
  let capabilities: CapabilityStateFile['capabilities']
  try {
    const parsed: unknown = JSON.parse(readFileSync(legacyPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    root = (parsed as { root?: unknown }).root
    capabilities = (parsed as CapabilityStateFile).capabilities
  } catch {
    return undefined
  }
  if (typeof root !== 'string' || root === '') return undefined
  const newPath = capabilityStatePath(root)
  if (!existsSync(newPath)) {
    try {
      mkdirSync(dirname(newPath), { recursive: true })
      writeFileSync(
        newPath,
        `${JSON.stringify(capabilities === undefined ? {} : { capabilities }, null, 2)}\n`,
        'utf8',
      )
    } catch {
      return undefined
    }
  }
  try {
    renameSync(legacyPath, `${legacyPath}.bak`)
  } catch {
    // The state is already imported; a stale legacy file costs nothing.
  }
  return root
}
