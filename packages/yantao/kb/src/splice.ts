/**
 * The section splicer — the only writes the agent side of the trust boundary
 * may perform. Appending locates the single `## 流水` anchor heading and
 * inserts bullet lines at the end of that section; rewriting locates the
 * single `## 状态` anchor and replaces only that section's body. Both
 * preserve every other byte of the file exactly as it was. Missing or
 * duplicated anchors are hard errors; the splicer never recreates structure.
 * @module @deepseek-ai/dsh-yantao-kb/splice
 */

import { KbError } from './types.ts'

/** The anchor heading line, tolerating trailing blanks and a CR from CRLF files. */
const LOG_HEADING = /^## 流水[ \t]*\r?$/

/** The State anchor heading line, same tolerance as the Log anchor. */
const STATE_HEADING = /^## 状态[ \t]*\r?$/

/** The start of the next level-two section (an `### ` heading stays inside the current one). */
const NEXT_SECTION = /^## \S/

/** A section the splicer can address: its heading, the label used in error prose, and its error-code stem. */
interface SectionAnchor {
  heading: RegExp
  label: string
  code: string
}

/** The `## 流水` (Log) section descriptor. */
const LOG_SECTION: SectionAnchor = { heading: LOG_HEADING, label: '## 流水', code: 'log' }

/** The `## 状态` (State) section descriptor. */
const STATE_SECTION: SectionAnchor = { heading: STATE_HEADING, label: '## 状态', code: 'state' }

/**
 * Locate one section by its heading: the heading's row index and the row
 * where the next level-two section starts. The heading must appear exactly
 * once — a missing or duplicated anchor is a hard error, because guessing
 * which section the caller meant would corrupt the file.
 * @param rows - the file split on `\n`.
 * @param section - which section to locate.
 * @param displayPath - path used in error prose.
 * @returns the heading index and the exclusive end index of the section body.
 */
function locateSection(rows: readonly string[], section: SectionAnchor, displayPath: string): { anchor: number; end: number } {
  const anchors: number[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (section.heading.test(rows[index] as string)) anchors.push(index)
  }
  if (anchors.length === 0) {
    throw new KbError(
      `missing-${section.code}-anchor`,
      `文件 ${displayPath} 缺少『${section.label}』锚点小节；请由人类修复文件结构，工具不会重建小节`,
    )
  }
  if (anchors.length > 1) {
    throw new KbError(
      `ambiguous-${section.code}-anchor`,
      `文件 ${displayPath} 含有 ${anchors.length} 个『${section.label}』锚点小节，无法判断写入位置；请由人类修复文件结构`,
    )
  }
  const anchor = anchors[0] as number
  let end = rows.length
  for (let index = anchor + 1; index < rows.length; index += 1) {
    if (NEXT_SECTION.test(rows[index] as string)) {
      end = index
      break
    }
  }
  return { anchor, end }
}

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
  const { anchor, end: sectionEnd } = locateSection(rows, LOG_SECTION, displayPath)
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
 * Replace the whole body of the `## 状态` section with `text`.
 *
 * The replacement is the mirror image of {@link appendToLogSection}: the
 * same single-anchor rule and the same line splice, but the rows between the
 * heading and the next section are swapped out instead of added to, so the
 * Log section below and everything above the anchor survive byte-for-byte.
 * The canonical layout is restored around the new body — one blank line
 * below the heading and one above the next section — which is why an empty
 * `text` reproduces the template's empty State section rather than removing it.
 *
 * @param content - the complete current file text.
 * @param text - the new State body; CRLF is normalized and outer blank lines dropped.
 * @param displayPath - path used in error prose.
 * @returns the complete new file text.
 */
export function replaceStateSection(content: string, text: string, displayPath: string): string {
  const rows = content.split('\n')
  const { anchor, end } = locateSection(rows, STATE_SECTION, displayPath)
  const normalized = text.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '')
  const body = ['', ...normalized.trim() === '' ? [] : normalized.split('\n'), '']
  rows.splice(anchor + 1, end - anchor - 1, ...body)
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
