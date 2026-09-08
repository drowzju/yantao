/**
 * The persisted KB root: one JSON file under dsh's home (`~/.dsh`, the same
 * home the profile store already uses) holding `{ "root": string }`. It is
 * what lets the workbench remember where the human put the knowledge base,
 * so the plugin's `kbRoot` config is only the first-run fallback.
 * @module @deepseek-ai/dsh-yantao-kb/root-store
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The state file's path: `~/.dsh/yantao-kb.json`.
 * @returns the absolute path of the persisted KB root state file.
 */
export function kbRootStatePath(): string {
  return join(homedir(), '.dsh', 'yantao-kb.json')
}

/** Extract the `root` string from the state file's content; anything else yields `undefined`.
 * @param raw - the file's raw content.
 * @returns the persisted root, or `undefined` when the content is not a `{ root: string }`.
 */
function parseKbRootState(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const root = (parsed as { root?: unknown }).root
    return typeof root === 'string' && root !== '' ? root : undefined
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
  const path = kbRootStatePath()
  try {
    if (!existsSync(path)) return undefined
    return parseKbRootState(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Persist `root` as the KB root override, creating `~/.dsh` when it is
 * absent. A failing write surfaces as a rejected promise and leaves any
 * previous state untouched.
 * @param root - the knowledge-base root directory to remember.
 */
export async function writeKbRootOverride(root: string): Promise<void> {
  const path = kbRootStatePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ root }, null, 2)}\n`, 'utf8')
}
