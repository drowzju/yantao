/**
 * The one confinement vocabulary for reaching into a capability directory —
 * shared by the nomination (`skill-rewrite.ts`, kb side) and the approved
 * writeback (`capability/rewrite.ts`, controller side). Two hand-rolled twins
 * drifted once already; from now on the blacklist, the normalization and the
 * filesystem guards live here and both faces dress the failures in their own
 * voice (KbError codes vs plain controller prose).
 * @module @deepseek-ai/dsh-yantao-kb/capability-file
 */

import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

/** Run-artifact directories no rewrite may ever touch — a run's debris, not the capability's instructions. */
export const CAPABILITY_ARTIFACT_DIRS: ReadonlySet<string> = new Set(['state', 'downloads', 'reports', 'out', '__pycache__'])

/** Why a confinement or read refused, so each caller can dress it in its own error type. */
export type CapabilityFileRejection = 'illegal' | 'artifact' | 'escapes' | 'symlink'

/** The shared confinement's refusal, carrying the reason for the caller's re-dressing. */
export class CapabilityFileError extends Error {
  constructor(readonly reason: CapabilityFileRejection, message: string) {
    super(message)
  }
}

/**
 * Normalize and confine one capability-relative `file` path against the
 * capability directory. Lexical checks are the gate; the containment
 * double-check against the real path arithmetic catches what slips past.
 * @returns the normalized relative path, forward slashes.
 * @throws CapabilityFileError with reason `illegal` (absolute, empty, `..`),
 *   `artifact` (blacklisted run-artifact directory), or `escapes` (resolves
 *   outside the directory).
 */
export function confineCapabilityFile(directory: string, file: string): string {
  const slashed = file.replaceAll('\\', '/')
  // Absoluteness is judged on the path as given — stripping leading slashes
  // first would quietly turn `/etc/passwd` into a tame-looking `etc/passwd`.
  if (isAbsolute(slashed)) {
    throw new CapabilityFileError('illegal', file)
  }
  const normalized = slashed.replace(/^\/+/, '')
  if (normalized === '' || normalized.endsWith('/')) {
    throw new CapabilityFileError('illegal', file)
  }
  if (normalized.split('/').includes('..')) {
    throw new CapabilityFileError('escapes', file)
  }
  // Case-insensitive on purpose: Windows paths are, so `State/cursor.txt`
  // must not sneak past a blacklist spelled in lowercase.
  if (normalized.split('/').some(segment => CAPABILITY_ARTIFACT_DIRS.has(segment.toLowerCase()))) {
    throw new CapabilityFileError('artifact', file)
  }
  const target = resolve(directory, normalized)
  const rel = relative(directory, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new CapabilityFileError('escapes', file)
  }
  return rel.replaceAll('\\', '/')
}

/**
 * Read one confined capability file as UTF-8 text, refusing to traverse a
 * symlink: the drift guard and the writeback must never chase a link out of
 * the capability directory. Callers keep the errno mapping for ENOENT and
 * friends — only the symlink case is dressed here.
 * @throws CapabilityFileError with reason `symlink` when the target is a link.
 */
export async function readCapabilityTextFile(directory: string, file: string): Promise<string> {
  const target = resolve(directory, file)
  // lstat, not stat: a dangling link still reports itself here, and any
  // errno (ENOENT included) rides to the caller's own error dressing.
  const info = await lstat(target)
  if (info.isSymbolicLink()) {
    throw new CapabilityFileError('symlink', target)
  }
  return readFile(target, 'utf8')
}
