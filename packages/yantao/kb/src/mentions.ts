/**
 * `@` mentions of KB entries, host side (ADR-0013, directories since ADR-0028).
 *
 * The composer's `@` menu inserts the entry's KB-relative path, so a turn
 * reaches the model carrying `@entities/people/张三.md` and nothing else —
 * upstream only explains `@` to models when a `read` tool exists, and the
 * yantao profile disables every fs tool. This module closes that gap: it
 * recognises the mentions a turn carries and renders the cited entries into
 * one context message the agent reads before answering.
 *
 * Everything here is pure (parse and render) so the rules are pinned by unit
 * tests; reading the files is the plugin's job (cited.ts).
 * @module @deepseek-ai/dsh-yantao-kb/mentions
 */

/** Prefixes a mention must carry to be a KB path at all. */
const KB_PREFIXES = ['entities/', 'resources/'] as const

/** Most mentions one turn may cite — a transcript is not a dump. */
export const MAX_MENTIONS = 8

/** Characters of one cited file kept in the context message. */
export const MAX_MENTION_CHARS = 32_000

/** Most files one cited directory may expand to — a directory is not a dump either. */
export const MAX_DIR_ENTRIES = 100

/** Total characters of file content one cited directory may carry. */
export const MAX_DIR_CHARS = 96_000

/**
 * One `@` mention: the bare form, or the quoted form for paths with spaces.
 * The `@` must start the line or follow whitespace, so an email address (`a@b`)
 * is not a mention.
 */
const MENTION = /(?:^|\s)@(?:"([^"\n]+)"|([^\s@，。；：！？、"'（）()]+))/g

/**
 * The KB paths one turn's text cites, in order of appearance, deduplicated.
 *
 * A mention only counts when it names a KB path: `@dinner` or `@here` belong
 * to whoever typed them. Paths that climb out of the root (`..`) or drive the
 * path (`/x`, `C:\x`) are dropped — the caller resolves them under the KB
 * root, and this is the trust boundary that keeps them there.
 * @param text - the turn's text.
 * @returns the cited KB-relative paths, at most {@link MAX_MENTIONS}.
 */
export function kbMentions(text: string): readonly string[] {
  const found: string[] = []
  for (const match of text.matchAll(MENTION)) {
    const path = (match[1] ?? match[2] ?? '').replace(/^\/+/, '')
    if (path === '' || !KB_PREFIXES.some(prefix => path.startsWith(prefix))) continue
    if (path.includes('..') || /^[A-Za-z]:/.test(path)) continue
    if (!found.includes(path)) found.push(path)
    if (found.length >= MAX_MENTIONS) break
  }
  return found
}

/** One file inside a cited directory: its content when it fit the budget, a placeholder reason otherwise. */
export interface CitedDirFile {
  /** Path relative to the KB root. */
  readonly path: string
  /** The file's content; null when a placeholder stands in for it. */
  readonly content: string | null
  /** Why the content is missing: NUL bytes (binary) or the directory's content budget. */
  readonly reason?: 'binary' | 'budget'
  /** The file's size in bytes, when known. */
  readonly size?: number
}

/** One cited KB path, resolved: a readable text file, a binary file, or a directory. */
export type CitedEntry =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'binary'; path: string; size: number }
  | { kind: 'dir'; path: string; files: readonly CitedDirFile[]; truncated?: boolean }

/** Render one file block, truncating over-long content. */
function renderFile(path: string, content: string): string {
  const body = content.length > MAX_MENTION_CHARS
    ? `${content.slice(0, MAX_MENTION_CHARS)}\n…（已截断）`
    : content
  return `<kb-file path="${path}">\n${body}\n</kb-file>`
}

/** Render a cited directory: its text files inline, placeholders for the rest. */
function renderDir(entry: Extract<CitedEntry, { kind: 'dir' }>): string {
  const inner = entry.files.map((file) => {
    if (file.content !== null) return renderFile(file.path, file.content)
    const why = file.reason === 'binary' ? '二进制文件，未注入内容' : '超出目录内容预算，未注入内容'
    const size = file.size !== undefined ? `；大小 ${file.size} 字节` : ''
    return `<kb-file path="${file.path}">\n（${why}${size}）\n</kb-file>`
  })
  const note = entry.truncated === true ? `\n（目录条目超过 ${MAX_DIR_ENTRIES} 个，已截断）` : ''
  return `<kb-dir path="${entry.path}" files="${entry.files.length}">\n${inner.join('\n')}${note}\n</kb-dir>`
}

/**
 * Render cited entries as one context message's text.
 * @param entries - the cited entries that resolved, in citation order.
 * @returns the message text; empty when nothing was cited.
 */
export function renderKbMentions(entries: readonly CitedEntry[]): string {
  if (entries.length === 0) return ''
  const blocks = entries.map((entry) => {
    if (entry.kind === 'dir') return renderDir(entry)
    if (entry.kind === 'binary') {
      return `<kb-file path="${entry.path}">\n（二进制文件，未注入内容；大小 ${entry.size} 字节）\n</kb-file>`
    }
    return renderFile(entry.path, entry.content)
  })
  return [
    `以下是本轮用 @ 引用的知识库内容（共 ${entries.length} 项），直接引用它们回答，不要猜测文件内容：`,
    ...blocks,
  ].join('\n\n')
}
