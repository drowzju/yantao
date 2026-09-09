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
