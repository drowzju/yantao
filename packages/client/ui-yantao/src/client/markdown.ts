/**
 * The YAML frontmatter envelope of a KB file, split off the body (ADR-0014).
 *
 * `MarkdownText` registers no frontmatter extension, so an untouched file
 * parses as "thematic break, paragraph, thematic break" and renders its
 * envelope as visible junk. Nothing on the wire changes for this: the split is
 * a pure client-side read of text the editor already loaded.
 *
 * The parser is deliberately a subset — `key: value` lines only, values kept
 * as written (arrays stay their inline form) — because a KB file's envelope is
 * machine-written by `packages/yantao/kb/src/templates.ts` and never uses YAML
 * anchors, blocks, or quotes.
 * @module @deepseek-ai/dsh-client-ui-yantao/markdown
 */

/** One `key: value` line of the envelope. */
export interface FrontmatterField {
  /** The key as written. */
  readonly key: string
  /** The value as written, trimmed; empty for a bare `key:`. */
  readonly value: string
}

/** A markdown file split into its envelope and its body. */
export interface SplitMarkdown {
  /** The envelope's fields, in order; empty when there is no envelope. */
  readonly fields: readonly FrontmatterField[]
  /** The body: everything after the envelope, with its leading blanks dropped. */
  readonly body: string
  /** Whether the file had a closed envelope at all. */
  readonly hasFrontmatter: boolean
}

/** The opening delimiter, alone on the file's first line. */
const OPEN = '---'
/** The two closing delimiters YAML allows. */
const CLOSING = ['---', '...'] as const

/**
 * Split a markdown file into its frontmatter fields and its body.
 *
 * No envelope — a file that does not start with `---`, whose `---` is not the
 * first line, or whose envelope is never closed — yields the text unchanged
 * with {@link SplitMarkdown.hasFrontmatter} false: showing junk is worse than
 * showing raw text, and the raw text is what the source view would show too.
 * @param text - the file's full content.
 * @returns the split; see {@link SplitMarkdown}.
 */
export function splitFrontmatter(text: string): SplitMarkdown {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== OPEN) return { fields: [], body: text, hasFrontmatter: false }
  const end = lines.findIndex((line, index) => index > 0 && CLOSING.includes(line.trim() as '---' | '...'))
  if (end < 0) return { fields: [], body: text, hasFrontmatter: false }
  const fields: FrontmatterField[] = []
  for (const line of lines.slice(1, end)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (key === '') continue
    fields.push({ key, value: line.slice(separator + 1).trim() })
  }
  // Drop the blank line templates leave under the envelope, not the body's own
  // leading structure: one blank at most.
  const rest = lines.slice(end + 1)
  const body = rest[0]?.trim() === '' ? rest.slice(1).join('\n') : rest.join('\n')
  return { fields, body, hasFrontmatter: true }
}

/** A task-list item: bullet, checkbox, and the space after it. */
const TASK_LINE = /^(\s*[-*+]\s+)\[([ xX])\](\s?)/

/** A markdown ATX heading. */
const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*$/

/** A fenced code block delimiter — headings inside one are not headings. */
const FENCE = /^\s*(?:```|~~~)/

/**
 * The line numbers carrying a task checkbox, in document order.
 *
 * The reading view matches these against the rendered checkboxes one by one,
 * which is the whole reason the order has to be the document's: micromark
 * renders list items in the order it meets them.
 * @param text - the file's content.
 * @returns the line indices of every `- [ ]` / `- [x]` item.
 */
export function taskLines(text: string): readonly number[] {
  const found: number[] = []
  let fenced = false
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    // A `- [ ]` inside a code block is sample text, not a checkbox: counting it
    // would desynchronise the ordinal the rendered boxes are matched against.
    if (fenced) continue
    if (TASK_LINE.test(line)) found.push(index)
  }
  return found
}

/**
 * Flip the Nth task checkbox of a file.
 * @param text - the file's content.
 * @param ordinal - which task item, counting from zero in document order.
 * @returns the new content, or null when there is no such task item.
 */
export function toggleTask(text: string, ordinal: number): string | null {
  const lines = text.split(/\r?\n/)
  const targets = taskLines(text)
  const line = targets[ordinal]
  if (line === undefined) return null
  const match = TASK_LINE.exec(lines[line] ?? '')
  if (match === null) return null
  const checked = match[2]?.toLowerCase() === 'x'
  lines[line] = `${match[1]}[${checked ? ' ' : 'x'}]${match[3]}${lines[line]?.slice(match[0].length) ?? ''}`
  return lines.join('\n')
}

/** One heading of the outline panel. */
export interface OutlineEntry {
  /** The ATX level: 1 for `#`, 6 for `######`. */
  readonly level: number
  /** The heading's text, delimiters stripped. */
  readonly text: string
}

/**
 * The headings of a document, in order, skipping fenced code.
 * @param text - markdown text (a body, envelope already split off).
 * @returns the outline entries.
 */
export function headingOutline(text: string): readonly OutlineEntry[] {
  const found: OutlineEntry[] = []
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = HEADING_LINE.exec(line)
    if (match === null) continue
    found.push({ level: match[1]?.length ?? 1, text: match[2] ?? '' })
  }
  return found
}

/**
 * Where a resolved `[[…]]` link points in the rendered document (ADR-0015).
 *
 * `MarkdownText` allows only http(s)/mailto destinations, so a link to a KB
 * file cannot carry a `kb:` scheme or a relative path — it would be stripped
 * and the link lost. The reading view therefore renders them at this reserved,
 * never-resolving host (RFC 2606) and intercepts the click before the browser
 * can act on it. Ugly, and the only way to get a clickable link out of a
 * renderer we do not own.
 */
export const LINK_HOST = 'https://kb.invalid/'

/** A `[[…]]` token, with an optional `|label`. */
const WIKI_LINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g

/** A fenced code block delimiter. */
const LINK_FENCE = /^\s*(?:```|~~~)/

/**
 * The href a resolved link carries.
 * @param path - the linked file's KB-relative path.
 * @returns the URL the rendered anchor points at.
 */
export function linkHref(path: string): string {
  return `${LINK_HOST}${encodeURIComponent(path)}`
}

/**
 * The KB path one rendered href names, or null when it is not one of ours.
 * @param href - an anchor's href.
 * @returns the KB-relative path, or null for any other link.
 */
export function linkPath(href: string): string | null {
  return href.startsWith(LINK_HOST) ? decodeURIComponent(href.slice(LINK_HOST.length)) : null
}

/**
 * Rewrite `[[…]]` links into ordinary markdown links, leaving unresolved ones
 * as they were written.
 *
 * An unresolved target keeps its brackets on purpose: the human sees which
 * link did not take, which is better than a link that goes nowhere.
 * @param text - markdown text (a body, envelope already split off).
 * @param resolve - target → KB-relative path, or null when unresolved.
 * @returns the text to render.
 */
export function renderWikiLinks(text: string, resolve: (target: string) => string | null): string {
  const lines = text.split(/\r?\n/)
  let fenced = false
  return lines.map((line) => {
    if (LINK_FENCE.test(line)) {
      fenced = !fenced
      return line
    }
    if (fenced) return line
    return line.replace(WIKI_LINK, (whole, first: string, second: string | undefined) => {
      const target = first.trim()
      if (target === '') return whole
      const path = resolve(target)
      if (path === null) return whole
      const label = second?.trim() === '' || second === undefined ? target : second.trim()
      return `[${label}](${linkHref(path)})`
    })
  }).join('\n')
}

/**
 * The one-line summary the collapsed envelope bar shows.
 * @param fields - the envelope's fields.
 * @returns `type: project · created: 2026-09-08` shaped text; empty when there is nothing to say.
 */
export function frontmatterSummary(fields: readonly FrontmatterField[]): string {
  return fields
    .filter(field => field.value !== '')
    .map(field => `${field.key}: ${field.value}`)
    .join(' · ')
}
