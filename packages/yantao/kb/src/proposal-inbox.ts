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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { KbError } from './types.ts'

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
  /** Pending until the human decides; a decision is final, no re-open. */
  readonly status: 'pending' | 'approved' | 'discarded'
  /** ISO timestamp of the decision; present exactly when status is not `pending`. */
  readonly decidedAt?: string
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
const SOURCE_NAME_MAX = 64
const TITLE_MAX = 200
const NOTE_MAX = 500

/** Where the store sits on disk. */
function inboxTarget(kbRoot: string): string {
  return join(kbRoot, '.dsh', 'yantao', 'proposal-inbox.json')
}

/**
 * Atomic replace via temp file + rename. Windows can transiently refuse the
 * replace (EPERM) while a scanner or indexer still holds the destination —
 * a few short retries keep the atomic replace honest without fragility.
 */
async function atomicWrite(target: string, payload: string): Promise<void> {
  const staging = `${target}.tmp`
  await writeFile(staging, payload, 'utf8')
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(staging, target)
      return
    } catch (error) {
      if (attempt >= 3 || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      await new Promise(resolveAck => setTimeout(resolveAck, 25 * (attempt + 1)))
    }
  }
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
    if (status !== 'pending' && status !== 'approved' && status !== 'discarded') {
      throw new KbError('bad-inbox-status', `提议「${id}」的状态不合法`)
    }
    if (status === 'pending') {
      if (raw.decidedAt !== undefined) {
        throw new KbError('bad-inbox-status', `提议「${id}」还在等待决策，不应带有决策时间`)
      }
    } else if (typeof raw.decidedAt !== 'string' || Number.isNaN(Date.parse(raw.decidedAt))) {
      throw new KbError('bad-inbox-status', `提议「${id}」已决策但缺少决策时间`)
    }
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
    }
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
  const target = inboxTarget(kbRoot)
  await mkdir(dirname(target), { recursive: true })
  const payload = JSON.stringify({ version: 1, proposals: validated } satisfies ProposalInboxFile, null, 2) + '\n'
  // Temp-file + rename: a crash mid-write must never leave a truncated JSON
  // store behind — that would wedge list/enqueue/resolve (the human's
  // pending decisions unreadable) until a hand repair.
  await atomicWrite(target, payload)
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
// writers (a scheduler enqueue racing a human resolve, or two scheduled
// sessions finishing together) would otherwise last-writer-win and silently
// drop a proposal or a decision. Cheap — every write funnels through here.
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
 * Record the human's decision on one pending proposal: the status flips and
 * the decided stamp lands. Already-decided rows refuse — a decision is
 * final, the card's 批准/丢弃 buttons act on pending rows only.
 * @param kbRoot - the live KB root.
 * @param id - the entry to resolve.
 * @param status - the decision: `approved` (the applier runs separately) or `discarded`.
 * @param decidedAt - the decision moment.
 * @returns the full list as stored after the resolve.
 */
export function resolveProposalInboxEntry(
  kbRoot: string,
  id: string,
  status: 'approved' | 'discarded',
  decidedAt: Date = new Date(),
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
    const next = entries.map(candidate => candidate.id === id
      ? { ...candidate, status, decidedAt: decidedAt.toISOString() }
      : candidate)
    await writeProposalInbox(kbRoot, next)
    return next
  })
}
