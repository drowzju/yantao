/**
 * `@` mentions of KB entities, host side (ADR-0013).
 *
 * The composer's `@` menu inserts the entity's KB-relative path, so a turn
 * reaches the model carrying `@entities/people/张三.md` and nothing else —
 * upstream only explains `@` to models when a `read` tool exists, and the
 * yantao profile disables every fs tool. This module closes that gap: it
 * recognises the mentions a turn carries and renders the cited files into one
 * context message the agent reads before answering.
 *
 * Everything here is pure (parse and render) so the rules are pinned by unit
 * tests; reading the files is the plugin's job.
 * @module @deepseek-ai/dsh-yantao-kb/mentions
 */

/** Prefixes a mention must carry to be a KB path at all. */
const KB_PREFIXES = ['entities/', 'resources/'] as const

/** Most mentions one turn may cite — a transcript is not a dump. */
export const MAX_MENTIONS = 8

/** Characters of one cited file kept in the context message. */
export const MAX_MENTION_CHARS = 32_000

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

/**
 * Render cited files as one context message's text.
 * @param entries - the cited files that read successfully, in citation order.
 * @returns the message text; empty when nothing was cited.
 */
export function renderKbMentions(entries: readonly { path: string; content: string }[]): string {
  if (entries.length === 0) return ''
  const blocks = entries.map(({ path, content }) => {
    const body = content.length > MAX_MENTION_CHARS
      ? `${content.slice(0, MAX_MENTION_CHARS)}\n…（已截断）`
      : content
    return `<kb-file path="${path}">\n${body}\n</kb-file>`
  })
  return [
    `以下是本轮用 @ 引用的 ${entries.length} 个知识库文件的当前内容，直接引用它们回答，不要猜测文件内容：`,
    ...blocks,
  ].join('\n\n')
}
