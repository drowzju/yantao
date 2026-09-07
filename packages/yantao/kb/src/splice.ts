/**
 * The section splicer — the only write the agent side of the trust boundary
 * may perform. Appending locates the single `## 流水` anchor heading and
 * inserts bullet lines at the end of that section, preserving every other
 * byte of the file (the human-owned `## 状态` section above all) exactly as
 * it was. Missing or duplicated anchors are hard errors; the splicer never
 * recreates structure.
 * @module @deepseek-ai/dsh-yantao-kb/splice
 */

import { KbError } from './types.ts'

/** The anchor heading line, tolerating trailing blanks and a CR from CRLF files. */
const LOG_HEADING = /^## 流水[ \t]*\r?$/

/** The start of the next level-two section (an `### ` heading stays inside the current one). */
const NEXT_SECTION = /^## \S/

/**
 * Append bullet lines at the end of the `## 流水` section.
 *
 * Insertion is a pure line splice: the file is split on `\n`, new lines are
 * inserted at one offset, and the rows rejoin with the same separator, so
 * every pre-existing line — including the whole State section and any
 * trailing blank runs — survives byte-for-byte. When the section still has
 * content, the bullet lands directly after its last non-blank line (keeping
 * the bullet list contiguous); when the section holds only blanks, the
 * bullet lands after the heading's blank separator.
 *
 * @param content - the complete current file text.
 * @param lines - the bullet block to insert (see {@link logBullet}).
 * @param displayPath - path used in error prose.
 * @returns the complete new file text.
 */
export function appendToLogSection(content: string, lines: readonly string[], displayPath: string): string {
  if (lines.length === 0) throw new KbError('empty-append', '追加内容为空')
  const rows = content.split('\n')
  const anchors: number[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (LOG_HEADING.test(rows[index] as string)) anchors.push(index)
  }
  if (anchors.length === 0) {
    throw new KbError(
      'missing-log-anchor',
      `文件 ${displayPath} 缺少『## 流水』锚点小节；请由人类修复文件结构，工具不会重建小节`,
    )
  }
  if (anchors.length > 1) {
    throw new KbError(
      'ambiguous-log-anchor',
      `文件 ${displayPath} 含有 ${anchors.length} 个『## 流水』锚点小节，无法判断追加位置；请由人类修复文件结构`,
    )
  }
  const anchor = anchors[0] as number
  let sectionEnd = rows.length
  for (let index = anchor + 1; index < rows.length; index += 1) {
    if (NEXT_SECTION.test(rows[index] as string)) {
      sectionEnd = index
      break
    }
  }
  let lastContent = -1
  for (let index = anchor + 1; index < sectionEnd; index += 1) {
    if ((rows[index] as string).trim() !== '') lastContent = index
  }
  let insertAt: number
  if (lastContent !== -1) {
    insertAt = lastContent + 1
  } else {
    // An empty section keeps the blank separator after its heading and the
    // bullet lands below it, matching the entity template's layout.
    insertAt = anchor + 1
    if (insertAt < sectionEnd && (rows[insertAt] as string).trim() === '') insertAt += 1
  }
  rows.splice(insertAt, 0, ...lines)
  return rows.join('\n')
}

/**
 * Build one log bullet block: the first text line rides on the
 * `- YYYY-MM-DD ` bullet and every continuation line is indented two spaces
 * so the markdown list item stays intact.
 * @param date - the date stamp prefixed onto the bullet (YYYY-MM-DD).
 * @param text - the log text; newlines become indented continuation lines.
 * @returns the bullet block as an array of lines.
 */
export function logBullet(date: string, text: string): string[] {
  const parts = text.split('\n')
  return [`- ${date} ${parts[0]}`, ...parts.slice(1).map(line => `  ${line}`)]
}
