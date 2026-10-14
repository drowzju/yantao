/**
 * The proposal inbox store (ADR-0047): the holding pen for structured
 * proposals produced outside a human-initiated card flow — today, a
 * schedule's background session (ADR-0045) whose answer parsed into a
 * unified proposal (ADR-0021 决定 4). The file lives at
 * `<kbRoot>/.dsh/yantao/proposal-inbox.json`; the producer is the frontend
 * scheduler (human-channel code — the agent has no tool into this surface),
 * and the human drains it from the 提议 tab: approve applies through the
 * human channel, discard just marks.
 *
 * The store validates shape only; the proposal payload itself is opaque
 * here — its schema authority is the client's unified proposal module
 * (ADR-0021), and this layer merely persists and returns it untouched, so
 * the two sides can evolve the action vocabulary without touching the
 * store.
 * @module @deepseek-ai/dsh-yantao-kb/proposal-inbox
 */

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { KbError } from './types.ts'

/**
 * One action's settlement record (ADR-0059 决定 5): `index` positions the
 * action in the unified proposal's canonical action order (the same order
 * the card ticks over), `ok` says whether its write landed, and `error`
 * carries the failure's reason verbatim when `ok` is false.
 */
export interface ProposalApplyRecord {
  readonly index: number
  readonly ok: boolean
  readonly error: string
}

/** One queued proposal awaiting (or past) the human's decision. */
export interface QueuedProposal {
  /** Stable identity, assigned at enqueue. */
  readonly id: string
  /** ISO timestamp of the enqueue moment. */
  readonly createdAt: string
  /** Where it came from, e.g. `schedule:sch_xxx` — `<kind>:<producer id>`. */
  readonly source: string
  /** The producer's display name, shown on the card's provenance line. */
  readonly sourceName: string
  /** The card's heading, as the producer framed it. */
  readonly title: string
  /** One line under the title, when the producer added one. */
  readonly note?: string
  /**
   * The unified proposal (ADR-0021 决定 4), opaque at this layer — schema
   * authority is the client; the store persists it verbatim.
   */
  readonly proposal: unknown
  /**
   * Pending until the human decides; a decision is final, no re-open.
   * ADR-0059 决定 5 splits the approve verdict by outcome: `approved` (every
   * ticked action landed), `approved-with-errors` (some landed, some did
   * not — the 逐项容错 precedent forbids punishing good rows), `failed`
   * (nothing landed). `discarded` stays the no-write verdict.
   */
  readonly status: 'pending' | 'approved' | 'approved-with-errors' | 'failed' | 'discarded'
  /** ISO timestamp of the decision; present exactly when status is not `pending`. */
  readonly decidedAt?: string
  /**
   * Per-action settlement results (ADR-0059 决定 5) — the card display's
   * authoritative data. Present on rows settled from an apply that did not
   * land cleanly; a clean `approved` carries no trail.
   */
  readonly applyResults?: readonly ProposalApplyRecord[]
}

/** The store's on-disk shape. */
export interface ProposalInboxFile {
  readonly version: 1
  readonly proposals: readonly QueuedProposal[]
}

/** Where the store lives, relative to the KB root. */
export const PROPOSAL_INBOX_DISPLAY_PATH = '.dsh/yantao/proposal-inbox.json'

/** Past this many undecided rows the inbox is a smell — enqueue refuses. */
export const INBOX_PENDING_SOFT_CAP = 50

/** The total row budget (decisions included) the store normalizes against. */
const INBOX_TOTAL_CAP = INBOX_PENDING_SOFT_CAP * 4

/** Length caps for the framing fields; the payload is capped by the parser upstream. */
const SOURCE_MAX = 128
/** Cap on an entry's `sourceName` — producers pre-validate against it so a rejection names the fix. */
export const SOURCE_NAME_MAX = 64
/** Cap on an entry's `title` — producers pre-validate against it so a rejection names the fix. */
export const TITLE_MAX = 200
const NOTE_MAX = 500

/** Where the store sits on disk. */
function inboxTarget(kbRoot: string): string {
  return join(kbRoot, '.dsh', 'yantao', 'proposal-inbox.json')
}

/** A fresh entry id: `prp_<base36 ms>_<random>` — same recipe as the schedule ids. */
export function newProposalInboxId(now: Date = new Date()): string {
  return `prp_${now.getTime().toString(36)}_${randomBytes(4).toString('hex')}`
}

/**
 * Validate one inbox list in full: ids unique, framing fields bounded, the
 * payload a proposal-shaped object (a `title` string and a non-empty
 * `actions` array — the one invariant every consumer relies on), and the
 * status/decidedAt pairing consistent. Shape errors carry Chinese messages
 * the UI shows verbatim.
 * @param entries - the list as the caller wants it stored, enqueue order.
 * @returns the same list, normalized (framing fields trimmed).
 */
export function normalizeInboxEntries(entries: readonly unknown[]): QueuedProposal[] {
  if (entries.length > INBOX_TOTAL_CAP) {
    throw new KbError('too-many-inbox-entries', `提议收件箱最多保留 ${INBOX_TOTAL_CAP} 条（含已决策）`)
  }
  const seen = new Set<string>()
  return entries.map((item, at) => {
    if (typeof item !== 'object' || item === null) {
      throw new KbError('bad-inbox-entry', `第 ${at + 1} 条提议格式不对`)
    }
    const raw = item as {
      id?: unknown
      createdAt?: unknown
      source?: unknown
      sourceName?: unknown
      title?: unknown
      note?: unknown
      proposal?: unknown
      status?: unknown
      decidedAt?: unknown
      applyResults?: unknown
    }
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      throw new KbError('bad-inbox-id', `第 ${at + 1} 条提议缺少 id`)
    }
    const id = raw.id.trim()
    if (seen.has(id)) {
      throw new KbError('duplicate-inbox-entry', `提议 id「${id}」重复了`)
    }
    seen.add(id)
    if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) {
      throw new KbError('bad-inbox-entry', `提议「${id}」的入队时间不是合法日期`)
    }
    if (typeof raw.source !== 'string' || raw.source.trim() === '' || raw.source.trim().length > SOURCE_MAX) {
      throw new KbError('bad-inbox-source', `提议「${id}」的来源标识缺失或过长`)
    }
    const source = raw.source.trim()
    if (typeof raw.sourceName !== 'string' || raw.sourceName.trim() === '' || raw.sourceName.trim().length > SOURCE_NAME_MAX) {
      throw new KbError('bad-inbox-source', `提议「${id}」的来源名称缺失或过长`)
    }
    const sourceName = raw.sourceName.trim()
    if (typeof raw.title !== 'string' || raw.title.trim() === '' || raw.title.trim().length > TITLE_MAX) {
      throw new KbError('bad-inbox-title', `提议「${id}」的标题缺失或过长（上限 ${TITLE_MAX} 字）`)
    }
    const title = raw.title.trim()
    if (raw.note !== undefined && (typeof raw.note !== 'string' || raw.note.trim().length > NOTE_MAX)) {
      throw new KbError('bad-inbox-note', `提议「${id}」的备注过长（上限 ${NOTE_MAX} 字）`)
    }
    const note = typeof raw.note === 'string' && raw.note.trim() !== '' ? raw.note.trim() : undefined
    const proposal = raw.proposal
    if (typeof proposal !== 'object' || proposal === null || !Array.isArray((proposal as { actions?: unknown }).actions)
      || (proposal as { actions: unknown[] }).actions.length === 0) {
      throw new KbError('bad-inbox-proposal', `提议「${id}」的提议体缺少非空 actions 数组`)
    }
    const status = raw.status
    if (status !== 'pending' && status !== 'approved' && status !== 'approved-with-errors'
      && status !== 'failed' && status !== 'discarded') {
      throw new KbError('bad-inbox-status', `提议「${id}」的状态不合法`)
    }
    if (status === 'pending') {
      if (raw.decidedAt !== undefined) {
        throw new KbError('bad-inbox-status', `提议「${id}」还在等待决策，不应带有决策时间`)
      }
    } else if (typeof raw.decidedAt !== 'string' || Number.isNaN(Date.parse(raw.decidedAt))) {
      throw new KbError('bad-inbox-status', `提议「${id}」已决策但缺少决策时间`)
    }
    const applyResults = normalizeApplyResults(id, raw.applyResults)
    return {
      id,
      createdAt: raw.createdAt,
      source,
      sourceName,
      title,
      ...note !== undefined ? { note } : {},
      proposal,
      status,
      ...raw.decidedAt !== undefined ? { decidedAt: raw.decidedAt } : {},
      ...applyResults !== undefined ? { applyResults } : {},
    }
  })
}

/** Cap on one row's per-action trail — proposals are bounded far below this. */
const APPLY_RESULTS_MAX = 200
/** Cap on one record's error copy; the verbose report lives on the card. */
const APPLY_ERROR_MAX = 500

/**
 * Validate one row's optional per-action trail (ADR-0059 决定 5): an array
 * of `{index, ok, error}` records, indexes non-negative integers. Absent
 * stays absent; a malformed trail is a loud shape error, not a silent drop —
 * the trail is the settled card's authoritative display data.
 */
function normalizeApplyResults(id: string, raw: unknown): ProposalApplyRecord[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > APPLY_RESULTS_MAX) {
    throw new KbError('bad-inbox-apply-results', `提议「${id}」的逐项结果缺失或过多（上限 ${APPLY_RESULTS_MAX} 条）`)
  }
  return raw.map((item, at) => {
    if (typeof item !== 'object' || item === null) {
      throw new KbError('bad-inbox-apply-results', `提议「${id}」第 ${at + 1} 条逐项结果格式不对`)
    }
    const record = item as { index?: unknown; ok?: unknown; error?: unknown }
    if (typeof record.index !== 'number' || !Number.isInteger(record.index) || record.index < 0) {
      throw new KbError('bad-inbox-apply-results', `提议「${id}」第 ${at + 1} 条逐项结果的序号不合法`)
    }
    if (typeof record.ok !== 'boolean') {
      throw new KbError('bad-inbox-apply-results', `提议「${id}」第 ${at + 1} 条逐项结果缺少 ok 布尔值`)
    }
    if (typeof record.error !== 'string' || record.error.length > APPLY_ERROR_MAX) {
      throw new KbError('bad-inbox-apply-results', `提议「${id}」第 ${at + 1} 条逐项结果的错误说明缺失或过长（上限 ${APPLY_ERROR_MAX} 字）`)
    }
    return { index: record.index, ok: record.ok, error: record.error }
  })
}

/**
 * Read the whole inbox. An absent file is an empty inbox (nothing queued
 * yet); a corrupt file is a loud error — the human's pending decisions must
 * not be silently discarded.
 * @param kbRoot - the live KB root.
 * @returns the entries in enqueue order.
 */
export async function readProposalInbox(kbRoot: string): Promise<QueuedProposal[]> {
  let raw: string
  try {
    raw = await readFile(inboxTarget(kbRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new KbError('bad-inbox-file', `${PROPOSAL_INBOX_DISPLAY_PATH} 不是合法 JSON，请修复或删除后重试`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { proposals?: unknown }).proposals)) {
    throw new KbError('bad-inbox-file', `${PROPOSAL_INBOX_DISPLAY_PATH} 缺少 proposals 数组`)
  }
  return normalizeInboxEntries((parsed as { proposals: readonly unknown[] }).proposals)
}

/**
 * Replace the whole inbox (small-list semantics, same recipe as the
 * schedule store). Validation runs before the write, so a rejected write
 * never touches the file; the parent directory is created first — a fresh
 * KB has no `.dsh/yantao/` until something writes there.
 * @param kbRoot - the live KB root.
 * @param entries - the complete new list, in enqueue order.
 */
export async function writeProposalInbox(kbRoot: string, entries: readonly QueuedProposal[]): Promise<void> {
  const validated = normalizeInboxEntries(entries)
  const payload = JSON.stringify({ version: 1, proposals: validated } satisfies ProposalInboxFile, null, 2) + '\n'
  // Atomic replace via the house utility (random-suffix sibling, exclusive
  // create, bounded Windows rename retries, temp cleanup on failure): a
  // crash mid-write must never leave a truncated JSON store behind — that
  // would wedge list/enqueue/resolve (the human's pending decisions
  // unreadable) until a hand repair. Parent dirs come with it.
  await writeFileAtomic(inboxTarget(kbRoot), payload, { mode: 0o600 })
}

/** What a producer hands in at enqueue — the store assigns id/createdAt/status. */
export interface InboxEnqueueInput {
  /** Where it came from, e.g. `schedule:sch_xxx`. */
  readonly source: string
  /** The producer's display name. */
  readonly sourceName: string
  /** The card's heading. */
  readonly title: string
  /** One line under the title, optional. */
  readonly note?: string
  /** The unified proposal, opaque at this layer. */
  readonly proposal: unknown
}

// Every mutator's read→modify→write runs on this chain: two overlapping
// writers in this process (a scheduler enqueue racing a human resolve, or
// two scheduled sessions finishing together) would otherwise last-writer-win
// and silently drop a proposal or a decision. This is a single-process
// guarantee by design: every shipped writer reaches the store through the
// controller's RPCs, which funnel into this one process — a hypothetical
// second process importing the kb lib directly would still race, and would
// need the house `withFileLock` on top. Cheap — every write funnels here.
let inboxWriteChain: Promise<unknown> = Promise.resolve()
function withInboxLock<T>(work: () => Promise<T>): Promise<T> {
  const run = inboxWriteChain.then(work, work)
  inboxWriteChain = run.catch(() => undefined)
  return run
}

/**
 * Append one proposal to the inbox. Refuses when the undecided backlog is
 * past the soft cap — a queue nobody drains is a smell, and the refusal is
 * the nudge to go decide.
 * @param kbRoot - the live KB root.
 * @param input - the proposal and its provenance.
 * @param now - the enqueue moment; defaults to now.
 * @returns the full list as stored after the append.
 */
export function enqueueProposal(kbRoot: string, input: InboxEnqueueInput, now: Date = new Date()): Promise<QueuedProposal[]> {
  return withInboxLock(async () => {
    const entries = await readProposalInbox(kbRoot)
    if (entries.filter(entry => entry.status === 'pending').length >= INBOX_PENDING_SOFT_CAP) {
      throw new KbError('inbox-full', `未决策的提议已达 ${INBOX_PENDING_SOFT_CAP} 条，先去提议页处理再跑下一次`)
    }
    const entry: QueuedProposal = {
      id: newProposalInboxId(now),
      createdAt: now.toISOString(),
      source: input.source,
      sourceName: input.sourceName,
      title: input.title,
      ...(input.note !== undefined ? { note: input.note } : {}),
      proposal: input.proposal,
      status: 'pending',
    }
    const next = [...entries, entry]
    // Decided rows are kept for the record, but the total cap is a hard
    // normalization failure that would wedge every consumer — trim the
    // oldest decided rows (pending ones are never touched) so the store
    // stays readable and self-healing.
    let stored = next
    if (stored.length > INBOX_TOTAL_CAP) {
      const drop = new Set(
        stored.filter(row => row.status !== 'pending')
          .slice(0, stored.length - INBOX_TOTAL_CAP)
          .map(row => row.id),
      )
      stored = stored.filter(row => !drop.has(row.id))
    }
    await writeProposalInbox(kbRoot, stored)
    return stored
  })
}

/**
 * One apply-ledger audit line (ADR-0059 决定 5): the settlement record of
 * one inbox proposal, appended at resolve time. The ledger is the audit
 * truth that survives independently of the entity files and the inbox store
 * — both may be cleaned up, or exactly the surfaces a failed write cannot
 * reach.
 */
export interface ApplyLedgerEntry {
  /** ISO timestamp of the settlement. */
  readonly at: string
  /** The settled proposal's id. */
  readonly id: string
  /** The settled proposal's title, for a human skimming the file. */
  readonly title: string
  /** The settlement verdict. */
  readonly status: 'approved' | 'approved-with-errors' | 'failed' | 'discarded'
  /** Per-action trail, when the resolve carried one. */
  readonly applyResults?: readonly ProposalApplyRecord[]
}

/** Where the ledger lives, relative to the KB root. */
export const APPLY_LEDGER_DISPLAY_PATH = '.dsh/yantao/apply-ledger.jsonl'

/** Past this many lines the ledger drops its oldest — the workspace-runs ring convention (ADR-0056 决定 6). */
const APPLY_LEDGER_CAP = 500

function ledgerTarget(kbRoot: string): string {
  return join(kbRoot, '.dsh', 'yantao', 'apply-ledger.jsonl')
}

/**
 * Append one settlement line to the apply-ledger, ring-truncated: the file
 * keeps the newest {@link APPLY_LEDGER_CAP} lines. Best-effort by design —
 * the inbox row is already settled when this runs, and failing the resolve
 * RPC over an audit append would push the client into its discard-fallback
 * path over bookkeeping. A lost ledger line is a gap in the audit trail,
 * not a lost decision.
 */
async function appendApplyLedger(kbRoot: string, entry: ApplyLedgerEntry): Promise<void> {
  try {
    let lines: string[] = []
    try {
      const raw = await readFile(ledgerTarget(kbRoot), 'utf8')
      lines = raw.split('\n').filter(line => line.trim() !== '')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    lines.push(JSON.stringify(entry))
    if (lines.length > APPLY_LEDGER_CAP) lines = lines.slice(lines.length - APPLY_LEDGER_CAP)
    await writeFileAtomic(ledgerTarget(kbRoot), `${lines.join('\n')}\n`, { mode: 0o600 })
  } catch { /* audit is best-effort; the row's own trail is the primary record */ }
}

/**
 * One machine verification's warning on a pending card (ADR-0059 决定 2):
 * the read-closure check speaks through the card's existing highlight
 * channel — same shape the mail analyses' 重点 blocks use, so the card
 * renders it with zero new UI vocabulary.
 */
export interface InboxAnnotation {
  /** The warning's issuer, e.g. `读取闭合`. */
  readonly sender: string
  /** The warned-at thing: a resource path or an action summary. */
  readonly subject: string
  /** What the machine saw that a human should double-check. */
  readonly why: string
}

/** Cap on one card's total highlights — verifier warnings merge into the same list. */
const HIGHLIGHTS_MAX = 20
/** Cap on one warning's copy; the evidence lives in the session. */
const HIGHLIGHT_WHY_MAX = 300

/**
 * Append verifier warnings to one pending entry's card (ADR-0059 决定 2):
 * the scheduler's read-closure scan runs after the tool has already enqueued,
 * so its findings land as a second write — merged into the payload's
 * `highlights` (the channel the card already renders), pending rows only
 * (a decided card is settled history, annotating it would rewrite the
 * verdict's context). Existing highlights are kept; the merged list is
 * capped at the newest {@link HIGHLIGHTS_MAX}.
 * @param kbRoot - the live KB root.
 * @param id - the entry to annotate.
 * @param highlights - the warnings to append, each `{sender, subject, why}`.
 * @returns the full list as stored after the merge.
 */
export function annotateProposalInboxEntry(
  kbRoot: string,
  id: string,
  highlights: readonly InboxAnnotation[],
): Promise<QueuedProposal[]> {
  return withInboxLock(async () => {
    const entries = await readProposalInbox(kbRoot)
    const entry = entries.find(candidate => candidate.id === id)
    if (entry === undefined) {
      throw new KbError('inbox-entry-not-found', `提议 ${id} 不存在`)
    }
    if (entry.status !== 'pending') {
      throw new KbError('inbox-entry-decided', `提议「${entry.title}」已经决策过了，不能再附注校验警告`)
    }
    const cleaned = highlights.map((highlight, at) => {
      if (typeof highlight !== 'object' || highlight === null
        || typeof highlight.sender !== 'string' || highlight.sender.trim() === ''
        || typeof highlight.subject !== 'string' || highlight.subject.trim() === ''
        || typeof highlight.why !== 'string' || highlight.why.trim() === ''
        || highlight.why.length > HIGHLIGHT_WHY_MAX) {
        throw new KbError('bad-inbox-highlight', `提议「${entry.title}」第 ${at + 1} 条校验警告格式不对（需 sender/subject/why，why 上限 ${HIGHLIGHT_WHY_MAX} 字）`)
      }
      return { sender: highlight.sender.trim(), subject: highlight.subject.trim(), why: highlight.why.trim() }
    })
    const payload = entry.proposal as Record<string, unknown>
    const existing = Array.isArray(payload.highlights) ? payload.highlights : []
    const merged = [...existing, ...cleaned].slice(-HIGHLIGHTS_MAX)
    const annotated: QueuedProposal = {
      ...entry,
      proposal: { ...payload, highlights: merged },
    }
    const next = entries.map(candidate => candidate.id === id ? annotated : candidate)
    await writeProposalInbox(kbRoot, next)
    return next
  })
}

/**
 * Record the human's decision on one pending proposal: the status flips and
 * the decided stamp lands. Already-decided rows refuse — a decision is
 * final, the card's 批准/丢弃 buttons act on pending rows only. An apply
 * settlement (anything but `discarded`) also appends one line to the
 * apply-ledger (ADR-0059 决定 5) and stores the per-action trail on the row.
 * @param kbRoot - the live KB root.
 * @param id - the entry to resolve.
 * @param status - the decision: `approved` / `approved-with-errors` /
 *   `failed` (the applier ran beforehand and reports through `applyResults`)
 *   or `discarded`.
 * @param decidedAt - the decision moment.
 * @param applyResults - the applier's per-action trail, when the decision
 *   settles an apply.
 * @returns the full list as stored after the resolve.
 */
export function resolveProposalInboxEntry(
  kbRoot: string,
  id: string,
  status: 'approved' | 'approved-with-errors' | 'failed' | 'discarded',
  decidedAt: Date = new Date(),
  applyResults?: readonly ProposalApplyRecord[],
): Promise<QueuedProposal[]> {
  return withInboxLock(async () => {
    const entries = await readProposalInbox(kbRoot)
    const entry = entries.find(candidate => candidate.id === id)
    if (entry === undefined) {
      throw new KbError('inbox-entry-not-found', `提议 ${id} 不存在`)
    }
    if (entry.status !== 'pending') {
      throw new KbError('inbox-entry-decided', `提议「${entry.title}」已经决策过了`)
    }
    const settled: QueuedProposal = {
      ...entry,
      status,
      decidedAt: decidedAt.toISOString(),
      ...(applyResults !== undefined ? { applyResults } : {}),
    }
    const next = entries.map(candidate => candidate.id === id ? settled : candidate)
    await writeProposalInbox(kbRoot, next)
    await appendApplyLedger(kbRoot, {
      at: decidedAt.toISOString(),
      id,
      title: entry.title,
      status,
      ...(applyResults !== undefined ? { applyResults } : {}),
    })
    return next
  })
}
