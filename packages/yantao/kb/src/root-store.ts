/**
 * The persisted KB root: one JSON file under dsh's home (`~/.dsh`, the same
 * home the profile store already uses) holding `{ "root": string, "connectors": … }`.
 * It is what lets the workbench remember where the human put the knowledge
 * base, so the plugin's `kbRoot` config is only the first-run fallback. The
 * same file also carries each connector's cursor (ADR-0019's mail watermark),
 * because a cursor belongs to the knowledge base it was read for, and not to
 * the KB itself — that is markdown for humans, not a place for machine state.
 * @module @deepseek-ai/dsh-yantao-kb/root-store
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The whole persisted state: the KB root plus the connectors bound to it. */
interface KbRootState {
  /** The knowledge-base root directory. */
  root: string
  /** Per-connector machine state; never mirrored into the KB itself. */
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
 * @returns the ISO 8601 timestamp, or `undefined` when mail has never been read.
 */
export function readMailWatermark(): string | undefined {
  const lastReadAt = readKbRootState()?.connectors?.mail?.lastReadAt
  return typeof lastReadAt === 'string' && lastReadAt !== '' ? lastReadAt : undefined
}

/**
 * Persist the mail connector's watermark, leaving the KB root and any other
 * connector state as they are.
 * @param lastReadAt - the ISO 8601 timestamp to remember.
 * @throws when no KB root is persisted yet: a watermark with no knowledge base
 *   to bind it to could never be read back, so it is refused rather than written.
 */
export async function writeMailWatermark(lastReadAt: string): Promise<void> {
  const existing = readKbRootState()
  if (existing === undefined) {
    throw new Error('yantao-kb: cannot persist a mail watermark before a KB root is configured')
  }
  await writeKbRootState({
    ...existing,
    connectors: { ...existing.connectors, mail: { ...existing.connectors?.mail, lastReadAt } },
  })
}
