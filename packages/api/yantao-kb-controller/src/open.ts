/**
 * Hand a target to the desktop's own handler (ADR-0017).
 *
 * This is the whole "borrow Obsidian" bridge: the UI passes either a KB-relative
 * path (opened with whatever the desktop associates with `.md`) or an
 * `obsidian://open?path=…` URI. Everything else is refused — an open-ended
 * "run this string on the host" would be a shell, not a bridge.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/open
 */
import { spawn } from 'node:child_process'

/** URI schemes a target may name. `obsidian:` is the one the UI uses. */
export const OPENABLE_SCHEMES = ['obsidian:', 'vscode:', 'http:', 'https:', 'mailto:'] as const

/**
 * Characters that would survive into a `cmd /c start` command line and change
 * its meaning. A KB file name never needs them, and neither does a URI.
 */
const SHELL_METACHARACTERS = /[&|<>^"'\n\r]/

/** True when `target` opens with a scheme rather than naming a file. */
export function hasScheme(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target)
}

/**
 * The scheme of a target, lower-cased with its colon; undefined when it has none.
 * @param target - the target as written.
 * @returns `obsidian:` shaped, or undefined.
 */
export function schemeOf(target: string): string | undefined {
  if (!hasScheme(target)) return undefined
  return target.slice(0, target.indexOf(':') + 1).toLowerCase()
}

/**
 * Whether this target may be handed to the desktop at all.
 * @param target - a KB-relative path or a URI.
 * @returns true when it is a plain path or names an allowlisted scheme.
 */
export function isOpenable(target: string): boolean {
  if (target.trim() === '') return false
  if (SHELL_METACHARACTERS.test(target)) return false
  const scheme = schemeOf(target)
  return scheme === undefined || (OPENABLE_SCHEMES as readonly string[]).includes(scheme)
}

/** The shape of `node:child_process`'s `spawn` this module needs; tests stand in a fake. */
export type SpawnLike = typeof spawn

/**
 * The command that opens `target` on this platform.
 * @param target - an absolute file path or a URI, already validated.
 * @returns the program and its arguments.
 */
export function openCommand(target: string): { readonly command: string; readonly args: readonly string[] } {
  // On Windows there is no argument-array opener that handles custom URI
  // schemes, so `cmd /c start` is the only route — which is exactly why
  // {@link isOpenable} rejects shell metacharacters.
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', target] }
  return { command: process.platform === 'darwin' ? 'open' : 'xdg-open', args: [target] }
}

/**
 * Open `target` with the desktop's handler, detached and not awaited.
 * @param target - an absolute file path or a URI, already validated.
 * @param spawnImpl - the spawn to use; tests pass a fake so nothing really opens.
 */
export function openWithDesktop(target: string, spawnImpl: SpawnLike = spawn): void {
  const { command, args } = openCommand(target)
  const child = spawnImpl(command, args as string[], { detached: true, stdio: 'ignore' })
  child.unref()
}
