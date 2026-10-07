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
import type { Proposal, ProposalAction, ProposalMailRange } from './proposal.ts'

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

/**
 * The action kinds a run's answer may carry, as the applier knows them —
 * the full unified vocabulary (ADR-0021 决定 4): the card renders whatever
 * fields each kind needs, and the applier degrades an unserviceable row
 * honestly (an absent seam skips it, never executes it elsewhere).
 */
const KINDS: readonly ProposalAction['kind'][] = [
  'create-entity', 'create-project', 'append-log', 'write-state', 'save-resource', 'create-link',
  'add-todo', 'edit-section', 'append-section', 'add-memory', 'delete-mails', 'archive-mails',
]

/** The payload fields each kind needs as non-empty strings; an action missing any is not one —
 * a near-miss envelope must not reach the card as a writable row (an `append-log` without
 * `text` would interpolate the literal "undefined" into the entity's 流水 as a success). */
const REQUIRED_FIELDS: Partial<Record<ProposalAction['kind'], readonly string[]>> = {
  'create-entity': ['entityType', 'name'],
  'create-project': ['name'],
  'append-log': ['text'],
  'write-state': ['text'],
  'save-resource': ['path', 'content'],
  'create-link': ['link'],
  'add-todo': ['title'],
  'edit-section': ['section', 'after'],
  'append-section': ['section', 'text'],
  'add-memory': ['scope', 'text'],
  'delete-mails': ['entryId'],
  'archive-mails': ['entryId'],
}

/** Keep the entries whose `kind` the applier knows and whose required fields are strings; drop the rest silently. */
function actionsOf(raw: readonly unknown[]): readonly ProposalAction[] {
  return raw.filter((entry): entry is ProposalAction => {
    if (typeof entry !== 'object' || entry === null) return false
    const bag = entry as Record<string, unknown>
    const kind = bag.kind as ProposalAction['kind']
    if (!KINDS.includes(kind)) return false
    return (REQUIRED_FIELDS[kind] ?? []).every(field => typeof bag[field] === 'string' && bag[field] !== '')
  })
}

/**
 * The envelope's optional `mails` range (ADR-0047 验收修正 2), as the parsers
 * accept it: an object whose `lastReadAt` is a parseable date stamp. The
 * stamps must be checked here — the watermark writer stores them verbatim
 * (no ISO check host-side), and a hallucinated cursor («上周五», a locale
 * date) would permanently skip mails in the fetch's `--since` filtering.
 * Anything else — absent, mistyped, unparseable — is simply no range, and
 * the inbox verdict moves no cursor.
 */
function mailsOf(raw: unknown): ProposalMailRange | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as Record<string, unknown>
  const isoOf = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed !== '' && !Number.isNaN(Date.parse(trimmed)) ? trimmed : undefined
  }
  const lastReadAt = isoOf(candidate.lastReadAt)
  if (lastReadAt === undefined) return undefined
  const firstReadAt = isoOf(candidate.firstReadAt)
  return { lastReadAt, ...(firstReadAt !== undefined ? { firstReadAt } : {}) }
}

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
  const actions = actionsOf(raw)
  if (actions.length === 0) return null
  return { title: `能力「${result.name}」的提议`, actions }
}

/** The JSON fragments one answer text may hide: fenced blocks, then the whole text, then the outermost brace span. */
function jsonCandidatesOf(answer: string): readonly string[] {
  const candidates: string[] = []
  for (const match of answer.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) {
    if (match[1] !== undefined) candidates.push(match[1].trim())
  }
  const trimmed = answer.trim()
  candidates.push(trimmed)
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1))
  return candidates
}

/**
 * Read one session's final answer text as a proposal (ADR-0047): the
 * schedule prompt's convention asks the model to close with a single
 * actions-envelope JSON — bare, fenced, or trailing its prose. The first
 * fragment that parses into a non-empty, known-kind action list wins;
 * anything else is not a proposal and the caller keeps the plain notice.
 * @param answer - the turn's final assistant text.
 * @param title - the card's heading, framed by the caller.
 * @returns the proposal, or null when the answer carries none.
 */
export function proposalOfAnswer(answer: string, title: string): Proposal | null {
  for (const candidate of jsonCandidatesOf(answer)) {
    if (candidate === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const raw = (parsed as Record<string, unknown>).actions
    if (!Array.isArray(raw) || raw.length === 0) continue
    const actions = actionsOf(raw)
    if (actions.length === 0) continue
    const mails = mailsOf((parsed as Record<string, unknown>).mails)
    return { title, actions, ...(mails !== undefined ? { mails } : {}) }
  }
  return null
}

/**
 * Read one inbox entry's stored payload back as a proposal (ADR-0047): the
 * store kept it opaquely, so the client re-validates here — a `title` string
 * and a non-empty, known-kind `actions` array, the same invariant the parser
 * enforced at enqueue. A payload that fails (a hand-edited store, an older
 * vocabulary) yields null and the pane degrades the row to a plain notice.
 * @param raw - the opaque payload as the store returned it.
 * @returns the proposal, or null when the payload is not one.
 */
export function proposalOfPayload(raw: unknown): Proposal | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  if (typeof candidate.title !== 'string' || candidate.title.trim() === '') return null
  if (!Array.isArray(candidate.actions) || candidate.actions.length === 0) return null
  const actions = actionsOf(candidate.actions)
  if (actions.length === 0) return null
  const mails = mailsOf(candidate.mails)
  return { title: candidate.title.trim(), actions, ...(mails !== undefined ? { mails } : {}) }
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
