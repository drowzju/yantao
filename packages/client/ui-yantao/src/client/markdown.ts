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
 * Collapse sections whose body is empty into quiet placeholder lines.
 *
 * A freshly created entity's template declares its sections before any of them
 * carries text; rendered at full heading weight they announce several empty
 * rooms and dominate the first screen (design.md §1: emptiness must serve a
 * focal point, not fill one). A level-2+ heading followed by nothing but blank
 * lines until the next heading or the end of the file becomes a single
 * `**name**（空）` line; consecutive placeholders land on adjacent lines, which
 * markdown renders as one soft-wrapped paragraph. The document title (h1) is
 * never collapsed, a fenced block counts as content, and non-empty sections
 * pass through byte-for-byte.
 * @param text - markdown text (a body, envelope already split off).
 * @returns the text to render.
 */
export function collapseEmptySections(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let fenced = false
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (fenced) {
      if (FENCE.test(line)) fenced = false
      out.push(line)
      index += 1
      continue
    }
    if (FENCE.test(line)) {
      fenced = true
      out.push(line)
      index += 1
      continue
    }
    const match = HEADING_LINE.exec(line)
    if (match === null || (match[1]?.length ?? 1) < 2) {
      out.push(line)
      index += 1
      continue
    }
    // Measure the section: everything up to the next unfenced heading or the
    // end of the file. A fence inside it is content by itself, so a section
    // holding one is never empty.
    const name = match[2] ?? ''
    let cursor = index + 1
    let sectionFenced = false
    let empty = true
    while (cursor < lines.length) {
      const probe = lines[cursor] ?? ''
      if (sectionFenced) {
        empty = false
        if (FENCE.test(probe)) sectionFenced = false
        cursor += 1
        continue
      }
      if (FENCE.test(probe)) {
        sectionFenced = true
        empty = false
        cursor += 1
        continue
      }
      if (HEADING_LINE.test(probe)) break
      if (probe.trim() !== '') empty = false
      cursor += 1
    }
    if (empty) {
      out.push(`**${name}**（空）`)
      index = cursor
      continue
    }
    out.push(line)
    index += 1
  }
  return out.join('\n')
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
 * Restore the line breaks an exported HTML table cell packs into one source
 * line (钉钉知识库导出).
 *
 * The export flattens a cell's paragraphs and lists into `<br>` / `<li>`
 * tags, and the renderer drops inline HTML silently — so every entry of a
 * progress-log cell fuses into one wrapping blob. A GFM table row cannot
 * hold a literal newline, so the break comes back as the character
 * references `&#10;`: the markdown grammar decodes it into a real `\n`
 * inside the cell's text, and the reading view's `white-space: pre-wrap`
 * cells (MarkdownView.module.css) render that as a line break. Every other
 * tag is stripped — the renderer drops inline HTML silently anyway — so the
 * synthesized break runs collapse to one and no blank line appears that the
 * source never had.
 *
 * Only table rows are touched: a `<br>` anywhere else is the same silent
 * drop either way, and conservative scope keeps code spans (split out
 * segment-wise) and fenced blocks literal.
 * @param text - markdown text (a body, envelope already split off).
 * @returns the text to render.
 */
/** A GFM table row. */
const TABLE_ROW = /^\s*\|/
/** An HTML line break, as exports write it. */
const HTML_BREAK = /<br\s*\/?>/gi
/** An HTML list-item opener; the item's own text already carries its marker. */
const HTML_LIST_ITEM = /<li\b[^>]*>/gi
/**
 * Any other tag: the renderer drops inline HTML silently, so stripping it
 * here changes nothing on screen — and lets the break runs below collapse
 * across where it stood. The letter after `<` keeps `a < b` prose safe.
 */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g
/** A run of synthesized break references, collapsing to one. */
const BREAK_RUN = /(?:&#10;){2,}/g
/** A single-backtick code span; backtick-fence variants inside a cell are out of scope. */
const CODE_SPAN = /(`[^`]*`)/

export function restoreTableBreaks(text: string): string {
  let fenced = false
  return text.split(/\r?\n/).map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced
      return line
    }
    if (fenced || !TABLE_ROW.test(line) || !line.includes('<')) return line
    return line.split(CODE_SPAN).map((segment, index) => {
      // Odd segments are code spans: their `<br>` is sample text, not layout.
      if (index % 2 === 1) return segment
      return segment
        .replace(HTML_BREAK, '&#10;')
        .replace(HTML_LIST_ITEM, '&#10;')
        .replace(HTML_TAG, '')
        .replace(BREAK_RUN, '&#10;')
    }).join('')
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

/**
 * Whether one markdown file's envelope declares it archived (ADR-0041 决定
 * 1): the frontmatter `archive: true` flag is the single authoritative
 * signal — the detail view's 归档/还原 button reads it from the draft.
 * @param text - the file's full content.
 * @returns true when the envelope carries `archive: true`.
 */
export function frontmatterArchived(text: string): boolean {
  return splitFrontmatter(text).fields.some(field => field.key === 'archive' && field.value === 'true')
}

/**
 * Local-image support (ADR-0048 一期).
 *
 * A markdown file's `![…](…)` destinations may point at files sitting next to
 * it (`_assets/foo.png`), the way Obsidian resolves them. The renderer only
 * accepts http(s), so the reading view pre-fetches each referenced image
 * through the host RPC and hands the render an object URL via the
 * `imageSources` hook. These two helpers are the textual half: collecting the
 * references worth fetching, and turning a reference as written into the
 * KB-relative path to fetch.
 */

/** Image file extensions the host serves as images — mirrors the controller's own gate. */
const IMAGE_SUFFIX = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i

/** Any URI scheme prefix (`http:`, `data:`, `mailto:`…) — none of those is KB-relative. */
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** An inline image token: `![alt](url "title")` — angle-wrapped destinations may carry spaces. */
const INLINE_IMAGE = /!\[[^\]\n]*\]\(\s*(?:<([^<>\n]*)>|([^<>()\s]+))(?:\s+"[^"\n]*")?\s*\)/g

/** A reference-style image definition: `[label]: url`, one per line. */
const IMAGE_DEFINITION = /^\s{0,3}\[[^\]\n]+\]:\s*<?([^<>\s]+)>?/

/**
 * The local image references a document makes, in order, deduplicated.
 *
 * Inline `![…](…)` tokens and `[label]: url` definitions both count; fenced
 * blocks are skipped (an image mention inside sample code is sample text).
 * A destination carrying a scheme or a fragment is not local and is dropped
 * here already — the resolver would refuse it anyway.
 * @param text - markdown text (a body, envelope already split off).
 * @returns the references as written, e.g. `_assets/foo.png`.
 */
export function localImageRefs(text: string): readonly string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const record = (candidate: string | undefined): void => {
    const ref = candidate?.trim()
    if (ref === undefined || ref === '' || ref.startsWith('#') || URI_SCHEME.test(ref)) return
    if (seen.has(ref)) return
    seen.add(ref)
    found.push(ref)
  }
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (!line.includes('![') && !IMAGE_DEFINITION.test(line)) continue
    for (const match of line.matchAll(INLINE_IMAGE)) record(match[1] ?? match[2])
    const definition = IMAGE_DEFINITION.exec(line)
    if (definition !== null) record(definition[1])
  }
  return found
}

/**
 * The KB-relative path one local image reference names.
 *
 * Relative references sit against the containing file's directory; a leading
 * `/` is KB-root-relative; `.` and `..` segments fold, and a `..` climbing
 * past the root refuses outright — a reference may not escape the KB.
 * Percent escapes decode (with a malformed-sequence fallback to the raw
 * text), backslashes stand in for slashes, and the result must carry an
 * image extension or it is not something to fetch.
 * @param fileDir - the containing file's directory, KB-relative, possibly empty.
 * @param ref - the reference as written in the markdown source.
 * @returns the normalized KB-relative path, or null when the reference is not
 * a resolvable local image.
 */
export function resolveLocalImagePath(fileDir: string, ref: string): string | null {
  const raw = ref.trim()
  if (raw === '' || raw.startsWith('#') || URI_SCHEME.test(raw)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const stack: string[] = decoded.startsWith('/') ? [] : fileDir.split('/').filter(segment => segment !== '')
  for (const segment of decoded.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return null
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  const path = stack.join('/')
  return path === '' || !IMAGE_SUFFIX.test(path) ? null : path
}

/**
 * The directory part of a KB-relative file path.
 * @param path - a KB-relative file path.
 * @returns everything before the last `/`, or the empty string when the file sits at the root.
 */
export function fileDirOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}
