/**
 * Matching capabilities to a rail row (ADR-0021 决定 7): a row's right-click
 * menu offers exactly the capabilities whose `appliesTo` accepts it — a
 * resource row by file suffix, an entity row by entity type — and only those
 * a human may invoke (ADR-0023 决定 2). `external` capabilities (the mail
 * connector) name no row, so they never appear here.
 *
 * The run's answer is parsed here too: a capability that answers with a
 * proposal (`{ actions: [...] }`, the one schema from {@link ./proposal.ts})
 * opens the shared card; anything else is reported as a plain notice.
 * @module @deepseek-ai/dsh-client-ui-yantao/capability-match
 */
import type { KbCapabilityRunResult, KbCapabilitySummary } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { Proposal, ProposalAction } from './proposal.ts'

/** The row a menu is open for, in the shape the matcher reads. */
export type CapabilityRowTarget =
  | { readonly kind: 'resource'; readonly path: string }
  | { readonly kind: 'entity'; readonly path: string; readonly entityType: string }

/**
 * The capabilities one row's menu offers: human-invocable ones whose
 * `appliesTo` accepts the row — a resource by file suffix (case-insensitive,
 * dot included), an entity by its type.
 * @param summaries - everything `capabilityList` reported.
 * @param target - the row the menu opened on.
 * @returns the matching capabilities, in discovery order.
 */
export function matchCapabilities(
  summaries: readonly KbCapabilitySummary[],
  target: CapabilityRowTarget,
): readonly KbCapabilitySummary[] {
  return summaries.filter((summary) => {
    if (!summary.invocation.includes('human')) return false
    const applies = summary.appliesTo
    if (applies === undefined) return false
    if (target.kind === 'resource') {
      // `resource: true` accepts every resource — the registration checkbox's
      // "all resources" shortcut; a list filters by file suffix.
      if (applies.resource === true) return true
      const suffixes = applies.resource
      if (suffixes === undefined || typeof suffixes === 'boolean') return false
      const lower = target.path.toLowerCase()
      return suffixes.some(suffix => lower.endsWith(suffix.toLowerCase()))
    }
    return applies.entity?.includes(target.entityType) ?? false
  })
}

/** The action kinds a run's answer may carry, as the applier knows them. */
const KINDS: readonly ProposalAction['kind'][] = [
  'create-entity', 'append-log', 'write-state', 'save-resource', 'create-link', 'add-todo',
]

/**
 * Read a run's answer as a proposal: an object carrying a non-empty
 * `actions` array becomes the card's proposal — title from the capability's
 * name, actions kept as-is (the card renders whatever fields each kind
 * needs; an unreadable row would only ever render blanks). Anything else is
 * not a proposal and the caller reports the run as a plain notice instead.
 * @param result - what `capabilityRun` answered.
 * @returns the proposal, or null when the answer is not one.
 */
export function proposalOfRunResult(result: KbCapabilityRunResult): Proposal | null {
  const value = result.result
  if (typeof value !== 'object' || value === null) return null
  const raw = (value as Record<string, unknown>).actions
  if (!Array.isArray(raw) || raw.length === 0) return null
  const actions = raw.filter((entry): entry is ProposalAction => {
    if (typeof entry !== 'object' || entry === null) return false
    return KINDS.includes((entry as Record<string, unknown>).kind as ProposalAction['kind'])
  })
  if (actions.length === 0) return null
  return { title: `能力「${result.name}」的提议`, actions }
}

/**
 * The one-line notice a non-proposal run answers with: what ran, and what it
 * left behind, if anything.
 * @param result - what `capabilityRun` answered.
 * @returns the notice line.
 */
export function runNoticeOf(result: KbCapabilityRunResult): string {
  if (result.artifacts.length > 0) return `能力「${result.name}」完成，产物：${result.artifacts.join('、')}`
  return `能力「${result.name}」已完成。`
}
