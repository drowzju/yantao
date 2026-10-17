/**
 * The DingTalk binding collector (ADR-0061 决定 2): the workbench's one read
 * over every `bindings.json` the connector maintains. The connector persists
 * conversationId → sessionId maps per owner — robot accounts under
 * `<stateDir>/[accounts/<id>/]bindings.json`, digital employees under
 * `<stateDir>/digital-employees/<uuid>/bindings.json` — and the workbench
 * needs the union to (a) list the bound conversations in the 钉钉 dialog and
 * (b) badge DingTalk-born sessions in the 会话总览.
 *
 * Read-only and tolerant by design: a missing file, a corrupt JSON blob, or a
 * non-string value is a skipped source, never a failed RPC — the collector
 * reports what it could see, and a half-configured connector answers with
 * fewer rows rather than an error.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/dingtalk-bindings
 */

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** One conversation's binding, as the workbench renders it. */
export interface DingtalkBindingRow {
  /** The DingTalk conversation the session is bound to (the store's key). */
  readonly conversationId: string
  /** The host session id the conversation resumes. */
  readonly sessionId: string
  /** Which family of connector runtime owns the binding. */
  readonly kind: 'robot' | 'digital-employee'
  /** The owning account id (robots) or agent uuid (digital employees). */
  readonly owner: string
}

/** The connector's state root: same resolution as the connector's paths.ts. */
export function dingtalkStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_DINGTALK_STATE_DIR || join(homedir(), '.dsh-dingtalk')
}

/** Parse one bindings.json's text into entries; anything malformed yields nothing. */
function parseBindings(text: string): readonly [string, string][] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
  const rows: [string, string][] = []
  for (const [conversationId, sessionId] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof sessionId === 'string' && sessionId !== '') rows.push([conversationId, sessionId])
  }
  return rows
}

/**
 * Collect every live binding across all connector owners. Later sources win
 * on a duplicated sessionId (scan order: default robot, then accounts, then
 * digital employees — deterministic), so the badge map stays one-label-per-
 * session.
 * @param stateDir - the connector state root; defaults to the connector's own resolution.
 * @returns the deduplicated binding rows, owners grouped and name-sorted.
 */
export async function collectDingtalkBindings(stateDir: string = dingtalkStateDir()): Promise<readonly DingtalkBindingRow[]> {
  const rows: DingtalkBindingRow[] = []

  // One owner directory's store, appended with its kind/owner label.
  const harvest = async (dir: string, kind: DingtalkBindingRow['kind'], owner: string): Promise<void> => {
    let text: string
    try {
      text = await readFile(join(dir, 'bindings.json'), 'utf8')
    } catch {
      return
    }
    for (const [conversationId, sessionId] of parseBindings(text)) {
      rows.push({ conversationId, sessionId, kind, owner })
    }
  }

  await harvest(stateDir, 'robot', 'default')
  try {
    for (const account of await readdir(join(stateDir, 'accounts'), { withFileTypes: true })) {
      if (account.isDirectory()) await harvest(join(stateDir, 'accounts', account.name), 'robot', account.name)
    }
  } catch { /* no accounts directory — only the default robot exists */ }
  try {
    for (const employee of await readdir(join(stateDir, 'digital-employees'), { withFileTypes: true })) {
      if (employee.isDirectory()) await harvest(join(stateDir, 'digital-employees', employee.name), 'digital-employee', employee.name)
    }
  } catch { /* no digital employees configured */ }

  // Dedupe by sessionId, last-wins (a session rebound to a new conversation
  // keeps ONE badge, pointing at its newest conversation).
  const bySession = new Map<string, DingtalkBindingRow>()
  for (const row of rows) bySession.set(row.sessionId, row)
  return [...bySession.values()]
}

/**
 * Rewrite one conversation's binding (ADR-0062 决定 3): point it at a
 * workbench session (merge) or sever it (`sessionId: null` — the connector
 * falls back to creating a fresh session on the next message). The store that
 * already holds the conversation is rewritten in place; a conversation no
 * store knows lands in the default robot's store, so the write always has a
 * home. The connector picks the change up on its next message via the store's
 * mtime self-check — no restart.
 *
 * Tolerant like the collector: a corrupt or missing store is recreated from
 * scratch rather than failing the RPC.
 * @returns the store file that was written.
 */
export async function setDingtalkBinding(
  conversationId: string,
  sessionId: string | null,
  stateDir: string = dingtalkStateDir(),
): Promise<{ readonly file: string }> {
  // Locate the store that currently holds the conversation (same scan order
  // as the collector); the default robot's store is the fallback destination.
  const candidates: string[] = [join(stateDir, 'bindings.json')]
  try {
    for (const account of await readdir(join(stateDir, 'accounts'), { withFileTypes: true })) {
      if (account.isDirectory()) candidates.push(join(stateDir, 'accounts', account.name, 'bindings.json'))
    }
  } catch { /* no accounts directory */ }
  try {
    for (const employee of await readdir(join(stateDir, 'digital-employees'), { withFileTypes: true })) {
      if (employee.isDirectory()) {
        candidates.push(join(stateDir, 'digital-employees', employee.name, 'bindings.json'))
      }
    }
  } catch { /* no digital employees */ }

  const [fallback] = candidates
  let file = fallback ?? join(stateDir, 'bindings.json')
  for (const candidate of candidates) {
    let text: string
    try {
      text = await readFile(candidate, 'utf8')
    } catch {
      continue
    }
    if (Object.prototype.hasOwnProperty.call(safeParse(text), conversationId)) {
      file = candidate
      break
    }
  }

  let store: Record<string, unknown>
  try {
    store = { ...safeParse(await readFile(file, 'utf8')) }
  } catch {
    store = {}
  }
  store = sessionId === null
    ? Object.fromEntries(Object.entries(store).filter(([key]) => key !== conversationId))
    : { ...store, [conversationId]: sessionId }

  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp.${process.pid}`
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
  return { file }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch { /* fall through */ }
  return {}
}
