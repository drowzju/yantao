/**
 * Read-only frontmatter parsing for KB files. Writing is the templates'
 * business and is deliberately not a YAML round trip: entity files are
 * hand-owned documents, so every tool that touches one validates the
 * envelope but splices text without re-emitting it.
 * @module @deepseek-ai/dsh-yantao-kb/frontmatter
 */

import { load } from 'js-yaml'
import { KbError } from './types.ts'

/** One parsed frontmatter envelope: the decoded mapping plus the untouched remainder. */
export interface Frontmatter {
  /** The decoded YAML mapping. */
  data: Record<string, unknown>
  /** Everything after the closing fence line, byte-identical to the input slice. */
  body: string
}

const ENVELOPE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t\r]*(?:\r?\n|$)/

/**
 * Parse the leading `---` envelope of a KB file. A missing envelope, invalid
 * YAML, or a non-mapping document is a hard `malformed-frontmatter` error —
 * the tools never repair or recreate structure.
 */
export function parseFrontmatter(content: string, displayPath: string): Frontmatter {
  const match = ENVELOPE.exec(content)
  if (match === null) {
    throw new KbError(
      'malformed-frontmatter',
      `文件 ${displayPath} 缺少 frontmatter（--- 包裹的 YAML 头）；请由人类修复文件结构`,
    )
  }
  let data: unknown
  try {
    data = load(match[1] as string)
  } catch (error) {
    throw new KbError(
      'malformed-frontmatter',
      `文件 ${displayPath} 的 frontmatter 不是合法 YAML：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new KbError('malformed-frontmatter', `文件 ${displayPath} 的 frontmatter 必须是一个 YAML 映射`)
  }
  return { data: data as Record<string, unknown>, body: content.slice(match[0].length) }
}
