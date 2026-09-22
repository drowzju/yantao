/**
 * Thread aggregation for the mail batch (ADR-0019 read side): the panel's
 * flat one-row-per-mail list becomes one row per conversation, because ten
 * replies on one topic read as one decision, not ten.
 *
 * Aggregation is view-only. The analysis still sees the flat numbered list
 * and cites 1-based numbers; a thread here carries its members' original
 * batch positions so per-mail verdicts keep lighting the rows they lit
 * before.
 * @module @deepseek-ai/dsh-client-ui-yantao/mail-threads
 */
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { MailImportance } from './mail-analysis.ts'

/** Threads with at least this many mails start collapsed in the panel. */
export const THREAD_COLLAPSE_MIN = 3

/** One mail inside a thread, with its position in the flat batch. */
export interface MailThreadMember {
  /** The mail itself, verbatim from the batch. */
  readonly mail: KbMailMessage
  /** The mail's 0-based position in the batch — the panel's verdict lookup key. */
  readonly index: number
}

/** One conversation as the panel renders it: a header plus its member rows. */
export interface MailThread {
  /** The grouping key — see {@link threadKey}. */
  readonly key: string
  /** The header's display topic: the conversation's subject without RE/FW noise. */
  readonly topic: string
  /** The members, in batch order (newest first), carrying their batch positions. */
  readonly members: readonly MailThreadMember[]
}

/**
 * Strip the reply/forward noise a subject accumulates: `RE:`, `FW:`, `FWD:`,
 * `AW:`, `答复：`, `回复：`, `转发：` — repeated, mixed, either colon, any case.
 * @param subject - the raw subject line.
 * @returns the bare topic, trimmed; `` when the subject was empty or pure noise.
 */
export function bareSubject(subject: string): string {
  return subject.replace(/^(?:\s*(?:re|fw|fwd|aw|答复|回复|转发)\s*[:：]\s*)+/gi, '').trim()
}

/**
 * The key one mail groups under. Outlook's `ConversationID` is the authority
 * (it survives retitled replies); a mail without one — old wire data, an
 * exotic item — falls back to its normalized subject. A mail with neither a
 * conversation id nor a subject groups alone: subjectless mails must not
 * lump into one phantom thread.
 * @param mail - the mail to key.
 * @returns the stable grouping key.
 */
export function threadKey(mail: Pick<KbMailMessage, 'id' | 'subject' | 'conversationId'>): string {
  const conversation = mail.conversationId ?? ''
  if (conversation !== '') return `cid:${conversation}`
  const bare = bareSubject(mail.subject)
  if (bare === '') return `solo:${mail.id}`
  return `subj:${bare}`
}

/** Importance ranks upward: focus shouts over digest mumbles over normal. */
const IMPORTANCE_RANK: Record<MailImportance, number> = { normal: 0, digest: 1, focus: 2 }

/**
 * Fold member importances into the badge a thread header wears: the loudest
 * verdict wins, because a thread containing one focus mail deserves focus.
 * @param importances - one per member, in any order; gaps count as normal.
 * @returns the rolled-up importance.
 */
export function rollupImportance(importances: readonly (MailImportance | undefined)[]): MailImportance {
  let best: MailImportance = 'normal'
  for (const importance of importances) {
    if (importance === undefined) continue
    if (IMPORTANCE_RANK[importance] > IMPORTANCE_RANK[best]) best = importance
  }
  return best
}

/**
 * Group a batch into threads. Threads order by their newest member's batch
 * position (the batch itself is newest-first, so first occurrence wins);
 * members keep batch order, which is what the panel's per-mail verdict
 * badges already map against.
 * @param mails - the batch, newest first, verbatim from the capability.
 * @returns the threads, newest conversation first.
 */
export function groupThreads(mails: readonly KbMailMessage[]): MailThread[] {
  const threads = new Map<string, { topic: string; members: MailThreadMember[] }>()
  for (const [index, mail] of mails.entries()) {
    const key = threadKey(mail)
    let thread = threads.get(key)
    if (thread === undefined) {
      const topic = mail.conversationTopic !== undefined && mail.conversationTopic !== ''
        ? mail.conversationTopic
        : bareSubject(mail.subject)
      thread = { topic, members: [] }
      threads.set(key, thread)
    }
    thread.members.push({ mail, index })
  }
  return [...threads.entries()].map(([key, thread]) => ({ key, topic: thread.topic, members: thread.members }))
}
