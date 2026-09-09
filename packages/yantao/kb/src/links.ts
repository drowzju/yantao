/**
 * `[[wiki links]]` between KB entities, host side (ADR-0015).
 *
 * A link is written the way Obsidian writes one — `[[名字]]`, with an optional
 * `类型:名字` to disambiguate and an optional `|显示名` — and this module owns
 * both halves of it: what a file links out to, and what links back into it.
 *
 * Two rules shape it:
 *
 * - **Resolution is never a guess.** A target resolves only when it names
 *   exactly one entity file; zero or several means unresolved, and an
 *   unresolved link stays literal `[[…]]` in the reading view instead of
 *   silently going nowhere.
 * - **Links may not point at `resources/`** — originals are not entities, have
 *   no `type:` spelling, and are not meant to be addressed this way.
 *
 * Everything the client needs is computed here, in one Remote call: the scan
 * reads files the tree load already reads, and doing it on the client would
 * cost one round trip per file.
 * @module @deepseek-ai/dsh-yantao-kb/links
 */
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { ENTITY_DIRS, ENTITY_TYPES, KbError, SINGLETON_FILES } from './types.ts'
import { resolveEntityLocator } from './paths.ts'

/** One `[[…]]` occurrence as written. */
export interface WikiLink {
  /** The target: a bare name or a `类型:名字` locator. */
  readonly target: string
  /** The display half of `[[target|label]]`, when one was written. */
  readonly label?: string
}

/** One outgoing link: what was written, and where it lands. */
export interface KbLinkTarget {
  /** The target as written. */
  readonly target: string
  /** The resolved KB-relative path, or null when it does not resolve. */
  readonly path: string | null
}

/** One incoming link: the file that links here, and what it wrote. */
export interface KbLinkSource {
  /** KB-relative path of the linking file. */
  readonly from: string
  /** The target that file wrote. */
  readonly target: string
}

/** Both halves of one file's link graph. */
export interface KbLinks {
  /** The file this was computed for. */
  readonly path: string
  /** What it links out to, in document order. */
  readonly outgoing: readonly KbLinkTarget[]
  /** What links into it, in file-enumeration order. */
  readonly incoming: readonly KbLinkSource[]
}

/** A `[[…]]` token, with an optional `|label` and no brackets inside. */
const WIKI_LINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g

/** A fenced code block delimiter — a `[[…]]` in a sample is not a link. */
const FENCE = /^\s*(?:```|~~~)/

/**
 * The `[[…]]` links one markdown text contains, in document order.
 * @param text - the file's content.
 * @returns the links as written, fenced blocks skipped.
 */
export function wikilinks(text: string): readonly WikiLink[] {
  const found: WikiLink[] = []
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const match of line.matchAll(WIKI_LINK)) {
      const target = match[1]?.trim() ?? ''
      if (target === '') continue
      const label = match[2]?.trim()
      found.push(label === undefined || label === '' ? { target } : { target, label })
    }
  }
  return found
}

/**
 * KB-relative form of an absolute path under the root.
 * @param kbRoot - the knowledge-base root directory.
 * @param absolute - an absolute path inside it.
 * @returns the path with forward slashes, relative to the root.
 */
function display(kbRoot: string, absolute: string): string {
  return relative(resolve(kbRoot), resolve(absolute)).split(sep).join('/')
}

/** Whether a resolved path is an entity file this feature may address. */
function isLinkable(displayPath: string): boolean {
  return displayPath.startsWith('entities/') && displayPath.endsWith('.md')
}

/**
 * Every entity `.md` file of the KB, as KB-relative paths.
 * @param kbRoot - the knowledge-base root directory.
 * @returns the paths, in type-then-directory order.
 */
async function entityFiles(kbRoot: string): Promise<readonly string[]> {
  const root = resolve(kbRoot)
  const found: string[] = []
  for (const type of ENTITY_TYPES) {
    const singleton = SINGLETON_FILES[type]
    if (singleton !== undefined) {
      const path = `entities/${singleton}`
      if (existsSync(join(root, path))) found.push(path)
      continue
    }
    const dir = join(root, 'entities', ENTITY_DIRS[type])
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.endsWith('.md')) found.push(`entities/${ENTITY_DIRS[type]}/${name}`)
    }
  }
  return found
}

/**
 * The one entity file a bare name means, if exactly one does.
 *
 * A dated meeting counts as a match for its own title (`2026-09-08 周会.md`
 * answers to `周会`), which is why a name can match twice and why two matches
 * mean unresolved rather than "take the first".
 * @param kbRoot - the knowledge-base root directory.
 * @param name - the bare name as written.
 * @returns the KB-relative path, or null when it is absent or ambiguous.
 */
async function byName(kbRoot: string, name: string): Promise<string | null> {
  const files = await entityFiles(kbRoot)
  const hits = files.filter((path) => {
    const stem = basename(path, '.md')
    if (stem === name) return true
    // Dated meetings: `YYYY-MM-DD <name>`.
    return /^\d{4}-\d{2}-\d{2} /.test(stem) && stem.slice(11) === name
  })
  return hits.length === 1 ? (hits[0] ?? null) : null
}

/**
 * Resolve one link target to the entity file it names.
 * @param kbRoot - the knowledge-base root directory.
 * @param target - the target as written inside the brackets.
 * @returns the KB-relative path, or null when it is unknown, ambiguous, or not
 *   an entity.
 */
export async function resolveWikiLink(kbRoot: string, target: string): Promise<string | null> {
  const trimmed = target.trim()
  if (trimmed === '') return null
  if (/^(project|projects|area|areas|person|people|meeting|meetings|todo|todos)[:：]/i.test(trimmed)) {
    let absolute: string
    try {
      absolute = resolveEntityLocator(kbRoot, trimmed)
    } catch (error: unknown) {
      // Unknown kind, or a dated-meeting name that matches twice.
      if (error instanceof KbError) return null
      throw error
    }
    if (!existsSync(absolute)) return null
    const path = display(kbRoot, absolute)
    return isLinkable(path) ? path : null
  }
  return byName(kbRoot, trimmed)
}

/**
 * Both halves of one file's link graph.
 *
 * A file that cannot be read contributes nothing rather than failing the call:
 * a link graph is a convenience, and one unreadable note should not hide the
 * rest.
 * @param kbRoot - the knowledge-base root directory.
 * @param path - the file's KB-relative path.
 * @returns the outgoing and incoming links.
 */
export async function linksOf(kbRoot: string, path: string): Promise<KbLinks> {
  const absolute = resolve(kbRoot, path)
  const outgoing: KbLinkTarget[] = []
  let text = ''
  try {
    text = await readFile(absolute, 'utf8')
  } catch {
    return { path, outgoing, incoming: [] }
  }
  for (const link of wikilinks(text)) {
    outgoing.push({ target: link.target, path: await resolveWikiLink(kbRoot, link.target) })
  }
  const incoming: KbLinkSource[] = []
  for (const other of await entityFiles(kbRoot)) {
    if (other === path) continue
    let content: string
    try {
      content = await readFile(join(resolve(kbRoot), other), 'utf8')
    } catch {
      continue
    }
    for (const link of wikilinks(content)) {
      const target = await resolveWikiLink(kbRoot, link.target)
      if (target === path) incoming.push({ from: other, target: link.target })
    }
  }
  return { path, outgoing, incoming }
}
