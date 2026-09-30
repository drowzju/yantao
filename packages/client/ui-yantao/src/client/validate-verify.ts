/**
 * The defence layer between the model's verdict and the card (ADR-0036
 * 决定 5): the model's words are not evidence. Every finding's subject and
 * every link's endpoint is checked against what actually exists — the
 * roster, the prescan's named entities and broken targets — and rows that
 * resolve to nothing are dropped, 宁缺毋滥 (the same stance as the v2
 * parser's empty-row rule). llm_wiki was bitten by exactly this class of
 * hallucination (#537: the model confidently reported missing pages that
 * existed); a set lookup wipes it out at zero cost.
 *
 * The check is deliberately one-way: the prescan's own rows never pass
 * through here — they reach the card directly, zero tokens, zero
 * hallucination, nothing to verify.
 *
 * Matching is lenient on form, strict on substance: names are folded with
 * NFKC (full-width punctuation and digits collapse onto their ASCII
 * twins), whitespace stripped, case lowered — so `Ｆｕｌｌ－Width` still
 * hits `full-width` — but a name the KB does not hold is a name the card
 * does not show.
 * @module @deepseek-ai/dsh-client-ui-yantao/validate-verify
 */
import type { ValidateVerdict } from './validate.ts'

/**
 * Fold a name the way the KB's own names are compared: NFKC, no whitespace,
 * lower case. CJK passes through untouched — only the full/half-width and
 * case axes are flattened.
 */
export function normalizeEntityName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/**
 * The entity a finding's subject points at: `[[target|alias]]` yields
 * `target`, a bare name stays itself. Whitespace trimmed.
 */
function subjectTargetOf(subject: string): string {
  const linked = /\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/.exec(subject)
  return (linked?.[1] ?? subject).trim()
}

/** How many rows each part of the verdict lost to the layer. */
export interface VerifyCounts {
  readonly findings: number
  readonly targets: number
  readonly links: number
}

/**
 * Verify a parsed verdict against reality (ADR-0036 决定 5):
 * - `stale`/`contradiction`/`bare` findings must name an entity the model
 *   actually saw (the prescan's named entities) or one of its broken links —
 *   anything else is invention;
 * - `missing` findings name an absence, so the check inverts: a subject the
 *   roster already holds is not missing — dropped;
 * - `targets[].entity` must be on the roster, else the whole target goes;
 * - `links[].to` must be on the roster, else just that link row goes;
 * - recited prescan kinds (`orphan`/`broken-link`) are not semantic
 *   findings and are dropped outright.
 * @param args - the verdict plus the three name sets the prompt was built
 *   from: the roster (every entity), the named entities (whose full text
 *   the model saw), and the broken-link targets as written.
 * @returns the surviving verdict and the per-part drop counts.
 */
export function verifyValidateVerdict(args: {
  readonly verdict: ValidateVerdict
  readonly rosterNames: readonly string[]
  readonly namedNames: readonly string[]
  readonly brokenTargets: readonly string[]
}): { verdict: ValidateVerdict; counts: VerifyCounts } {
  const roster = new Set(args.rosterNames.map(normalizeEntityName))
  const named = new Set(args.namedNames.map(normalizeEntityName))
  const broken = new Set(args.brokenTargets.map(normalizeEntityName))

  let droppedFindings = 0
  const findings = args.verdict.findings.filter((finding) => {
    const target = normalizeEntityName(subjectTargetOf(finding.subject))
    // `bare` (2026-09-30 link hygiene) rides with stale/contradiction: its
    // subject is the host entity whose full text the model saw, so the same
    // seen-it check applies — a bare link in an entity the model never read
    // is invention, and one in a named entity is real.
    const alive = finding.kind === 'missing'
      ? !roster.has(target)
      : (finding.kind === 'stale' || finding.kind === 'contradiction' || finding.kind === 'bare')
        && (named.has(target) || broken.has(target))
    if (!alive) droppedFindings += 1
    return alive
  })

  let droppedTargets = 0
  let droppedLinks = 0
  const targets = args.verdict.targets.flatMap((target) => {
    if (!roster.has(normalizeEntityName(target.entity))) {
      droppedTargets += 1
      return []
    }
    const links = target.links.filter((link) => {
      const alive = roster.has(normalizeEntityName(link.to))
      if (!alive) droppedLinks += 1
      return alive
    })
    return [{ ...target, links }]
  })

  return {
    verdict: { ...args.verdict, findings, targets },
    counts: { findings: droppedFindings, targets: droppedTargets, links: droppedLinks },
  }
}
