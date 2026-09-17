/**
 * Reading the KB entries a turn cited (ADR-0013, directories since ADR-0028).
 *
 * The mention pipeline is split in two: `mentions.ts` is pure (parse and
 * render, pinned by unit tests), and this module is the filesystem half —
 * stat each cited path, read files with a NUL check, and expand directories
 * under the entry and content budgets — so those rules are testable against
 * real temporary directories.
 * @module @deepseek-ai/dsh-yantao-kb/cited
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { CitedDirFile, CitedEntry } from './mentions.ts'
import { MAX_DIR_CHARS, MAX_DIR_ENTRIES } from './mentions.ts'

/** Read one file as text, reporting NUL-bearing files as binary instead of decoding them. */
async function readTextFile(absolute: string): Promise<{ kind: 'file'; content: string } | { kind: 'binary'; size: number }> {
  const buffer = await readFile(absolute)
  if (buffer.includes(0)) return { kind: 'binary', size: buffer.length }
  return { kind: 'file', content: buffer.toString('utf8') }
}

/**
 * Expand one cited directory into a content-carrying listing: text files
 * inline (each still capped by the render-time per-file truncation), binary
 * and over-budget files as placeholder rows. The walk is Dirent-based, so
 * symlinks — which report neither directory nor file — are skipped outright
 * and a planted link cannot turn the walk into a cycle.
 */
async function readCitedDirectory(path: string, absolute: string): Promise<CitedEntry> {
  // A hand-typed mention may carry a trailing slash (`@resources/报告/`);
  // normalize so neither the wrapper nor the file rows grow a double slash.
  const base = path.endsWith('/') ? path.slice(0, -1) : path
  const files: CitedDirFile[] = []
  let budget = MAX_DIR_CHARS
  // Walk one directory level; answers whether the entry cap ended the listing.
  const walk = async (dir: string, prefix: string): Promise<boolean> => {
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return false // an unreadable subdirectory costs its entries, not the citation
    }
    dirents.sort((left, right) => left.name.localeCompare(right.name))
    for (const dirent of dirents) {
      if (files.length >= MAX_DIR_ENTRIES) return true
      if (dirent.isDirectory()) {
        if (await walk(join(dir, dirent.name), `${prefix}${dirent.name}/`)) return true
      } else if (dirent.isFile()) {
        if (budget <= 0) {
          files.push({ path: `${prefix}${dirent.name}`, content: null, reason: 'budget' })
          continue
        }
        try {
          const read = await readTextFile(join(dir, dirent.name))
          if (read.kind === 'binary') {
            files.push({ path: `${prefix}${dirent.name}`, content: null, reason: 'binary', size: read.size })
          } else if (read.content.length > budget) {
            files.push({ path: `${prefix}${dirent.name}`, content: null, reason: 'budget' })
          } else {
            budget -= read.content.length
            files.push({ path: `${prefix}${dirent.name}`, content: read.content })
          }
        } catch {
          // an unreadable file costs its row, not the citation
        }
      }
    }
    return false
  }
  // The walk prefix starts at the cited path itself, so every file row's
  // path is KB-relative — the model can hand it straight to
  // `kb_read_resource` without re-joining the directory.
  const truncated = await walk(absolute, `${base}/`)
  return { kind: 'dir', path: base, files, ...(truncated ? { truncated: true } : {}) }
}

/**
 * Resolve the KB paths a turn cited into renderable entries, in citation
 * order. A cited path that vanished, is unreadable, or points outside the
 * root costs the citation, not the turn.
 * @param root - the live KB root.
 * @param paths - KB-relative paths from {@link kbMentions}.
 * @returns the resolved entries, in citation order.
 */
export async function readCitedEntries(root: string, paths: readonly string[]): Promise<CitedEntry[]> {
  const cited: CitedEntry[] = []
  for (const path of paths) {
    const absolute = join(root, path)
    // Defense in depth: kbMentions already refuses escaping paths, and this
    // keeps the read inside the root even if that check ever loosens.
    if (relative(root, absolute).startsWith('..')) continue
    let info
    try {
      info = await stat(absolute)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      cited.push(await readCitedDirectory(path, absolute))
    } else if (info.isFile()) {
      try {
        const read = await readTextFile(absolute)
        cited.push(read.kind === 'binary'
          ? { kind: 'binary', path, size: read.size }
          : { kind: 'file', path, content: read.content })
      } catch {
        // vanished between stat and read — skip
      }
    }
  }
  return cited
}
