/**
 * The persisted KB root: one JSON file under dsh's home (`~/.dsh`, the same
 * home the profile store already uses) holding `{ "root": string, "capabilities": … }`.
 * It is what lets the workbench remember where the human put the knowledge
 * base, so the plugin's `kbRoot` config is only the first-run fallback. The
 * same file also carries each capability's machine state (ADR-0021: the
 * generalized form of ADR-0019's mail watermark), because a cursor belongs to
 * the knowledge base it was read for, and not to the KB itself — that is
 * markdown for humans, not a place for machine state.
 * @module @deepseek-ai/dsh-yantao-kb/root-store
 */

import { existsSync, readFileSync } from 'node:fs'
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

/** The whole persisted state: the KB root plus the capabilities bound to it. */
interface KbRootState {
  /** The knowledge-base root directory. */
  root: string
  /** Per-capability machine state; never mirrored into the KB itself. */
  capabilities?: Record<string, CapabilityState>
  /**
   * Legacy pre-ADR-0021 connector cursors, kept readable so an existing mail
   * watermark survives the upgrade; a write moves it into `capabilities`.
   */
  connectors?: {
    /** The Outlook mail connector (ADR-0019). */
    mail?: {
      /** ISO 8601 timestamp of the most recent mail the connector has read. */
      lastReadAt?: string
    }
  }
}

/** The state file's path: `~/.dsh/yantao-kb.json`.
 * @returns the absolute path of the persisted KB root state file.
 */
export function kbRootStatePath(): string {
  return join(homedir(), '.dsh', 'yantao-kb.json')
}

/** Parse the state file's content; anything without a usable `root` yields `undefined`.
 * @param raw - the file's raw content.
 * @returns the parsed state, or `undefined` when the content is not a `{ root: string }`.
 */
function parseKbRootState(raw: string): KbRootState | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const root = (parsed as { root?: unknown }).root
    if (typeof root !== 'string' || root === '') return undefined
    // The state is carried through as parsed, so keys a newer yantao added
    // survive a read-modify-write by this version.
    return parsed as KbRootState
  } catch {
    return undefined
  }
}

/** Read the whole persisted state, synchronously.
 * @returns the parsed state, or `undefined` when there is none.
 */
function readKbRootState(): KbRootState | undefined {
  const path = kbRootStatePath()
  try {
    if (!existsSync(path)) return undefined
    return parseKbRootState(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Read the persisted KB root override. Synchronous because the plugin must
 * publish a root at apply time, before it can await anything; a missing or
 * unreadable state file means "not configured yet", never an error.
 * @returns the persisted root, or `undefined` when there is none.
 */
export function readKbRootOverride(): string | undefined {
  return readKbRootState()?.root
}

/**
 * Write the whole state, creating `~/.dsh` when it is absent. A failing write
 * surfaces as a rejected promise and leaves any previous state untouched.
 * @param state - the state to persist.
 */
async function writeKbRootState(state: KbRootState): Promise<void> {
  const path = kbRootStatePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * Persist `root` as the KB root override, keeping whatever else the state
 * file already holds — the connectors' cursors are bound to this root, but
 * they are not invalidated by the human re-picking the same directory.
 * @param root - the knowledge-base root directory to remember.
 */
export async function writeKbRootOverride(root: string): Promise<void> {
  const existing = readKbRootState()
  await writeKbRootState(existing === undefined ? { root } : { ...existing, root })
}

/**
 * Read the mail connector's watermark: the timestamp it last read up to.
 * Synchronous, like {@link readKbRootOverride} — the connector asks for it
 * while assembling a fetch, on the same path as the root it belongs to.
 * Reads the ADR-0021 `capabilities.mail` slot first and the legacy
 * `connectors.mail` one second, so a watermark written before the
 * generalization still answers.
 * @returns the ISO 8601 timestamp, or `undefined` when mail has never been read.
 */
export function readMailWatermark(): string | undefined {
  const state = readKbRootState()
  const generalized = state?.capabilities?.mail?.state
  const legacy = state?.connectors?.mail?.lastReadAt
  const lastReadAt = legacyLastReadAt(generalized) ?? legacy
  return typeof lastReadAt === 'string' && lastReadAt !== '' ? lastReadAt : undefined
}

/** The `lastReadAt` inside a mail capability state, when it carries one. */
function legacyLastReadAt(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const value = (state as { lastReadAt?: unknown }).lastReadAt
  return typeof value === 'string' ? value : undefined
}

/**
 * Persist the mail connector's watermark, leaving the KB root and any other
 * capability state as they are. The watermark moves into the ADR-0021
 * `capabilities.mail` slot and the legacy `connectors` key is dropped — it
 * only ever held the mail cursor, so nothing else can be lost.
 * @param lastReadAt - the ISO 8601 timestamp to remember.
 * @throws when no KB root is persisted yet: a watermark with no knowledge base
 *   to bind it to could never be read back, so it is refused rather than written.
 */
export async function writeMailWatermark(lastReadAt: string): Promise<void> {
  const existing = readKbRootState()
  if (existing === undefined) {
    throw new Error('yantao-kb: cannot persist a mail watermark before a KB root is configured')
  }
  const previous = mailStateOf(existing)
  const previousState = typeof previous?.state === 'object' && previous.state !== null ? previous.state : {}
  const { connectors: _legacy, ...rest } = existing
  await writeKbRootState({
    ...rest,
    capabilities: {
      ...existing.capabilities,
      mail: { ...previous, state: { ...previousState, lastReadAt }, lastRunAt: new Date().toISOString() },
    },
  })
}

/** The mail capability's persisted slot under either the new or the legacy key. */
function mailStateOf(state: KbRootState): CapabilityState | undefined {
  return state.capabilities?.mail ?? (state.connectors?.mail !== undefined ? { state: { ...state.connectors.mail } } : undefined)
}

/**
 * Read one capability's persisted state (ADR-0021). Synchronous, like every
 * other read here — the runner asks for it while assembling a run.
 * @param name - the capability's kebab-case name.
 * @returns the state as the capability last left it, or `undefined` when it has never run.
 */
export function readCapabilityState(name: string): unknown {
  return readKbRootState()?.capabilities?.[name]?.state
}

/**
 * Persist one capability's state (ADR-0021), stamping the run that produced
 * it and leaving the KB root and every other capability as they are.
 * @param name - the capability's kebab-case name.
 * @param state - the state to remember; it replaces the previous value whole.
 * @throws when no KB root is persisted yet: state with no knowledge base to
 *   bind it to could never be read back, so it is refused rather than written.
 */
export async function writeCapabilityState(name: string, state: unknown): Promise<void> {
  const existing = readKbRootState()
  if (existing === undefined) {
    throw new Error(`yantao-kb: cannot persist capability ${name} state before a KB root is configured`)
  }
  await writeKbRootState({
    ...existing,
    capabilities: {
      ...existing.capabilities,
      [name]: { ...existing.capabilities?.[name], state, lastRunAt: new Date().toISOString() },
    },
  })
}
