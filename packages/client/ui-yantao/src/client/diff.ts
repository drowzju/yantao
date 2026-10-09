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
 * Above this many LCS cells the dynamic program refuses to allocate: two
 * 20k-line sides would otherwise build a 1.6 GB table on the main thread.
 * The common prefix/suffix is peeled before the core is judged, so
 * near-identical giants still get their true diff; only genuinely divergent
 * cores fall back to the wholesale-replacement presentation.
 */
const DP_CELL_CAP = 4_000_000

/**
 * Split into content lines: a trailing `\n` terminates the last line rather
 * than opening an empty one, and the empty text has no lines at all — the
 * same convention `git diff` speaks, so a file-final newline never paints a
 * phantom context row.
 */
function linesOf(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * LCS-align two line arrays into diff rows (greedy backtrack toward the
 * larger neighbor on ties).
 */
function lcsRows(a: readonly string[], b: readonly string[]): DiffRow[] {
  // LCS lengths: lcs[i][j] = LCS length of a[i..] and b[j..].
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = lcs[i] as Uint32Array
    const below = lcs[i + 1] as Uint32Array
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number)
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const row = lcs[i] as Uint32Array
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] as string })
      i += 1
      j += 1
    } else if ((lcs[i + 1]?.[j] as number) >= (row[j + 1] as number)) {
      rows.push({ type: 'del', text: a[i] as string })
      i += 1
    } else {
      rows.push({ type: 'add', text: b[j] as string })
      j += 1
    }
  }
  while (i < a.length) { rows.push({ type: 'del', text: a[i] as string }); i += 1 }
  while (j < b.length) { rows.push({ type: 'add', text: b[j] as string }); j += 1 }
  return rows
}

/**
 * Line-diff two texts (LCS dynamic programming; both sides are bounded by
 * the kb tool's 200k-char cap). Within the DP-cell budget this is the plain
 * textbook diff; beyond it, the common prefix/suffix is peeled first and
 * only the changed core is aligned — and if even that core is too big, the
 * core is presented as a wholesale replacement, which the row cap collapses.
 * @param original - the left side, as the proposing agent read it.
 * @param next - the right side, the proposed content.
 * @returns the rows in order and the omitted-middle count.
 */
export function lineDiff(original: string, next: string): LineDiffResult {
  const left = linesOf(original)
  const right = linesOf(next)
  let rows: DiffRow[]
  if (left.length * right.length <= DP_CELL_CAP) {
    rows = lcsRows(left, right)
  } else {
    // Peel the common head and tail — O(n+m) — so near-identical giants
    // still get their true diff on the small changed core.
    let start = 0
    while (start < left.length && start < right.length && left[start] === right[start]) start += 1
    let endLeft = left.length
    let endRight = right.length
    while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
      endLeft -= 1
      endRight -= 1
    }
    const head: DiffRow[] = []
    for (let at = 0; at < start; at += 1) head.push({ type: 'same', text: left[at] as string })
    const tail: DiffRow[] = []
    for (let at = endLeft; at < left.length; at += 1) tail.push({ type: 'same', text: left[at] as string })
    const coreLeft = left.slice(start, endLeft)
    const coreRight = right.slice(start, endRight)
    const core = coreLeft.length * coreRight.length <= DP_CELL_CAP
      ? lcsRows(coreLeft, coreRight)
      // Genuinely divergent giants: the honest worst case — the left core
      // removed wholesale, the right added wholesale — no alignment attempted.
      : [...coreLeft.map((text): DiffRow => ({ type: 'del', text })),
        ...coreRight.map((text): DiffRow => ({ type: 'add', text }))]
    rows = [...head, ...core, ...tail]
  }
  if (rows.length <= ROWS_CAP) return { rows, omitted: 0 }
  return {
    rows: [...rows.slice(0, TRIM_KEEP), ...rows.slice(-TRIM_KEEP)],
    omitted: rows.length - TRIM_KEEP * 2,
  }
}
