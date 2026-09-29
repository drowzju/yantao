/**
 * The deterministic half of broken-link repair (ADR-0036 决定 4): a broken
 * `[[…]]` gets fix candidates by roster similarity — code scores, the human
 * ticks, code rewrites. The model plays no part here; its link suggestions
 * are a different dimension (缺链机会, `targets.links`) and arrive through
 * the verdict, not this module.
 *
 * Scoring follows llm_wiki's structural lint (`lint-structural-core.ts`):
 * edit-distance similarity plus bigram overlap, thresholds as named
 * constants. One deliberate departure: a CJK↔CJK character substitution
 * costs half — the dominant CJK typo is one wrong hanzi (「张三丰」→
 * 「张叁丰」), and rating it a full unit buries short names under the bar
 * while unrelated names still fall far below.
 *
 * The rewrite mirrors llm_wiki's `rewriteWikilinkTarget` (`lint-fixes.ts`):
 * only a folded target match is replaced, the `|别名` half survives, fenced
 * code is never touched — the same fence semantics as the KB's own link
 * scanner (`packages/yantao/kb` links.ts), so a link the prescan saw is
 * exactly the link this rewrites.
 * @module @deepseek-ai/dsh-client-ui-yantao/broken-link-suggest
 */
import { normalizeEntityName } from './validate-verify.ts'

/**
 * A candidate at or above this score may become a tickable fix row; below
 * it the broken link degrades to a display-only row (宁缺毋滥). Same bar
 * as llm_wiki's `BROKEN_LINK_SUGGESTION_MIN_SCORE`.
 */
export const HIGH_CONFIDENCE = 0.74

/**
 * A name contained in the other (`飞书` ⊂ `飞书迁移`) is already a strong
 * hint, but not certain enough for the top bar.
 */
const CONTAINMENT_SCORE = 0.82

/** A CJK↔CJK character substitution (hand-written homophone/near-form typos) costs half a unit. */
const CJK_SUBSTITUTION_COST = 0.5

/** At most three candidates reach the card; a longer list is noise. */
export const MAX_CANDIDATES = 3

const HAN = /\p{Script=Han}/u
const WIKILINK = /\[\[([^\[\]|]+)(\|([^\]]*))?\]\]/g
const FENCE = /^(```|~~~)/
const HEADING = /^#{1,2} /

/** The `类型:` locator half of a written target, if one is present. */
function stripLocator(target: string): string {
  const colon = target.indexOf(':')
  return colon === -1 ? target : target.slice(colon + 1)
}

/** Whether a character is a Han character (the weighted-distance CJK test). */
function isHan(char: string): boolean {
  return HAN.test(char)
}

/**
 * Levenshtein over code-point arrays where a CJK↔CJK substitution costs
 * {@link CJK_SUBSTITUTION_COST} instead of a full unit.
 */
function weightedLevenshtein(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  const current = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const left = a[i - 1] ?? ''
      const right = b[j - 1] ?? ''
      const cost = left === right ? 0 : isHan(left) && isHan(right) ? CJK_SUBSTITUTION_COST : 1
      current[j] = Math.min(
        (current[j - 1] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[j] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[j - 1] ?? Number.POSITIVE_INFINITY) + cost,
      )
    }
    previous = current.slice()
  }
  return previous.at(-1) ?? 0
}

/** Distinct adjacent-character pairs; a lone character is its own fragment. */
function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set(value === '' ? [] : [value])
  const result = new Set<string>()
  for (let i = 0; i < value.length - 1; i += 1) result.add(value.slice(i, i + 2))
  return result
}

/** Sørensen–Dice coefficient over two fragment sets: shared ×2 ÷ total. */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const fragment of a) if (b.has(fragment)) shared += 1
  return (2 * shared) / (a.size + b.size)
}

/**
 * Similarity of two names, 0..1: the best of the edit-distance ratio (CJK
 * substitutions weigh half), bigram overlap, and the containment floor.
 * Both inputs are folded first ({@link normalizeEntityName}), so case,
 * width and whitespace differences never reach the scorers.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeEntityName(a)
  const right = normalizeEntityName(b)
  if (left === '' || right === '') return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return CONTAINMENT_SCORE
  const leftChars = Array.from(left)
  const rightChars = Array.from(right)
  const editScore = 1 - weightedLevenshtein(leftChars, rightChars) / Math.max(leftChars.length, rightChars.length)
  return Math.max(editScore, dice(bigrams(left), bigrams(right)))
}

/** One roster entry the suggestions score against. */
export interface SuggestRosterEntry {
  /** The entity's name as the KB spells it. */
  readonly name: string
}

/** One surviving fix candidate for a broken link. */
export interface LinkFixCandidate {
  /** The roster name the broken target may have meant. */
  readonly name: string
  /** The similarity score, 0..1; at or above {@link HIGH_CONFIDENCE}. */
  readonly score: number
}

/**
 * Score a broken link's target against the roster: at most
 * {@link MAX_CANDIDATES} names at or above {@link HIGH_CONFIDENCE}, best
 * first. A `类型:` locator prefix is stripped before scoring — the locator
 * names a type, the similarity is about the name.
 * @param target - the broken link's target as written inside the brackets.
 * @param roster - every entity name the KB holds.
 * @returns the sorted candidates; empty when nothing clears the bar.
 */
export function suggestLinkFixes(
  target: string,
  roster: readonly SuggestRosterEntry[],
): readonly LinkFixCandidate[] {
  const scored: LinkFixCandidate[] = []
  for (const entry of roster) {
    const score = nameSimilarity(stripLocator(target), entry.name)
    if (score >= HIGH_CONFIDENCE) scored.push({ name: entry.name, score })
  }
  return scored
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, MAX_CANDIDATES)
}

/**
 * Rewrite every unfenced `[[…]]` whose folded target equals the broken one
 * into `[[suggested|alias]]` — the alias half survives untouched, a link
 * that names something else does too, and running it twice changes nothing.
 * A `类型:` locator on the broken target is dropped wholesale (it already
 * failed to disambiguate; re-attaching it to the suggestion would be a
 * guess), and the suggestion is inserted bare.
 * @param content - the host entity's full text.
 * @param brokenTarget - the link target as written (locator included).
 * @param suggested - the roster name to point at instead.
 * @returns the rewritten text; unchanged when nothing matches.
 */
export function rewriteWikilinkTarget(content: string, brokenTarget: string, suggested: string): string {
  const wanted = normalizeEntityName(stripLocator(brokenTarget))
  if (wanted === '') return content
  let fenced = false
  return content.split('\n').map((line) => {
    if (FENCE.test(line.trim())) {
      fenced = !fenced
      return line
    }
    if (fenced) return line
    return line.replace(WIKILINK, (match, rawTarget: string, _aliasPart?: string, alias?: string) => {
      if (normalizeEntityName(stripLocator(rawTarget.trim())) !== wanted) return match
      return alias === undefined ? `[[${suggested}]]` : `[[${suggested}|${alias}]]`
    })
  }).join('\n')
}

/** One section of a host file whose body contains the broken link. */
export interface BrokenLinkSectionFix {
  /** The section heading without the `## ` prefix, e.g. `状态`. */
  readonly section: string
  /** The section's body as the file holds it today. */
  readonly before: string
  /** The body with every unfenced occurrence of the broken link rewritten. */
  readonly after: string
}

/**
 * Locate the broken link in the host's sections and produce one rewrite per
 * affected section (a link may recur in several). Boundaries mirror the
 * applier's `replaceSection` (`#{1,2} ` headings), link detection skips
 * fenced blocks the same way the KB's own link scanner does, and `## 流水`
 * is reported like any other section — the append-only iron law is the
 * caller's business (it degrades those rows to display-only).
 * @param content - the host entity's full text.
 * @param brokenTarget - the link target as written inside the brackets.
 * @param suggested - the roster name to point at instead.
 * @returns the per-section rewrites, document order; empty when the link
 *   appears in no section body (frontmatter or before the first heading).
 */
export function brokenLinkSectionFixes(
  content: string,
  brokenTarget: string,
  suggested: string,
): readonly BrokenLinkSectionFix[] {
  const wanted = normalizeEntityName(stripLocator(brokenTarget))
  if (wanted === '') return []
  const lines = content.split('\n')
  const bounds: { section: string; start: number; end: number }[] = []
  let fenced = false
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line.trim())) fenced = !fenced
    if (!fenced && HEADING.test(line)) {
      const last = bounds.at(-1)
      if (last !== undefined) last.end = index
      bounds.push({ section: line.replace(HEADING, '').trim(), start: index + 1, end: lines.length })
    }
  }
  const fixes: BrokenLinkSectionFix[] = []
  for (const bound of bounds) {
    const before = lines.slice(bound.start, bound.end).join('\n')
    const after = rewriteWikilinkTarget(before, brokenTarget, suggested)
    if (after === before) continue
    fixes.push({ section: bound.section, before, after })
  }
  return fixes
}
