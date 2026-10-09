/**
 * The plain line diff behind the skill-rewrite card rows (ADR-0054): no diff
 * library, no word-level gymnastics — an LCS over lines, rendered as `-`/`+`/
 * space rows the human reads straight off. A diff too long to read reports
 * the omitted middle as a count; the card renders it localized.
 * @module @deepseek-ai/dsh-client-ui-yantao/diff
 */

/** One visual row of the diff: unchanged context, removed, or added. */
export interface DiffRow {
  readonly type: 'same' | 'del' | 'add'
  readonly text: string
}

/** The full diff: rows in order, plus how many middle rows were collapsed. */
export interface LineDiffResult {
  readonly rows: readonly DiffRow[]
  /** Middle rows dropped by the cap — 0 when the whole diff is shown. */
  readonly omitted: number
}

/** Past this many rows the middle collapses to a counted ellipsis. */
const ROWS_CAP = 300

/** Context rows kept on each side of the ellipsis when truncating. */
const TRIM_KEEP = 20

/**
 * Split into content lines: a trailing `\n` terminates the last line rather
 * than opening an empty one, and the empty text has no lines at all — the
 * same convention `git diff` speaks, so a file-final newline never paints a
 * phantom context row.
 */
function linesOf(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Line-diff two texts (LCS dynamic programming; both sides are bounded by
 * the kb tool's 200k-char cap, so the O(n·m) table stays affordable).
 * @param original - the left side, as the proposing agent read it.
 * @param next - the right side, the proposed content.
 * @returns the rows in order and the omitted-middle count.
 */
export function lineDiff(original: string, next: string): LineDiffResult {
  const left = linesOf(original)
  const right = linesOf(next)
  // LCS lengths: lcs[i][j] = LCS length of left[i..] and right[j..].
  const lcs: Uint32Array[] = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    const row = lcs[i] as Uint32Array
    const below = lcs[i + 1] as Uint32Array
    for (let j = right.length - 1; j >= 0; j -= 1) {
      row[j] = left[i] === right[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number)
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    const row = lcs[i] as Uint32Array
    if (left[i] === right[j]) {
      rows.push({ type: 'same', text: left[i] as string })
      i += 1
      j += 1
    } else if ((lcs[i + 1]?.[j] as number) >= (row[j + 1] as number)) {
      rows.push({ type: 'del', text: left[i] as string })
      i += 1
    } else {
      rows.push({ type: 'add', text: right[j] as string })
      j += 1
    }
  }
  while (i < left.length) { rows.push({ type: 'del', text: left[i] as string }); i += 1 }
  while (j < right.length) { rows.push({ type: 'add', text: right[j] as string }); j += 1 }
  if (rows.length <= ROWS_CAP) return { rows, omitted: 0 }
  return {
    rows: [...rows.slice(0, TRIM_KEEP), ...rows.slice(-TRIM_KEEP)],
    omitted: rows.length - TRIM_KEEP * 2,
  }
}
