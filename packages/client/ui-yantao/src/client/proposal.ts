/**
 * The unified proposal schema (ADR-0021 决定 4): one shape for everything an
 * agent proposes and a human confirms — the mail analysis's four blocks land
 * here as a flat action list.
 *
 * A proposal proposes; nothing in this module writes to the KB. Applying is
 * {@link ./proposal-apply.ts} `applyProposal`'s business, and only after the
 * human has ticked rows in {@link ProposalCard}.
 * @module @deepseek-ai/dsh-client-ui-yantao/proposal
 */
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { MailAnalysis } from './mail-analysis.ts'
import type { MailEntities } from './mail-apply.ts'
import type { WorkbenchLocaleKey } from './locales.ts'

/** The entity types `createEntity` accepts, as the controller types them. */
export type ProposalEntityType = 'project' | 'area' | 'person' | 'meeting'

/** One thing the agent proposes and the human may tick. */
export type ProposalAction =
  | {
    /** Create one entity from the canonical template. */
    readonly kind: 'create-entity'
    readonly entityType: ProposalEntityType
    readonly name: string
    readonly reason: string
    /** The person's e-mail address, written into the frontmatter `email:` field. */
    readonly email?: string
  }
  | {
    /** Append one dated bullet to an entity's `## 流水` (the append-only section). */
    readonly kind: 'append-log'
    readonly entityPath: string
    readonly entityName: string
    readonly text: string
    readonly reason: string
  }
  | {
    /** Append one line to an entity's `## 状态`. */
    readonly kind: 'write-state'
    readonly entityPath: string
    readonly entityName: string
    readonly text: string
    readonly reason: string
  }
  | {
    /** Write one file under `resources/` (or anywhere the path names). */
    readonly kind: 'save-resource'
    readonly path: string
    readonly content: string
    readonly reason: string
  }
  | {
    /** Write one `[[…]]` link into an entity's `## 状态` (the backlink is automatic, ADR-0015). */
    readonly kind: 'create-link'
    readonly entityPath: string
    readonly entityName: string
    readonly link: string
    readonly reason: string
  }
  | {
    /** Join one line of work into the todo singleton, under optimistic concurrency. */
    readonly kind: 'add-todo'
    readonly title: string
    readonly due?: string
    readonly body: string
    readonly reason: string
  }

/** One mail the analysis flagged, shown on the card without a checkbox. */
export interface ProposalHighlight {
  /** Who sent it. */
  readonly sender: string
  /** Its subject line. */
  readonly subject: string
  /** One line of why it was flagged. */
  readonly why: string
}

/** Everything one run proposes; the human ticks actions, not blocks. */
export interface Proposal {
  /** The card's heading — which judgement these actions came from. */
  readonly title: string
  /** One line under the title, e.g. that the session is kept for re-reading. */
  readonly note?: string
  /** The actions, in the order the applier executes them. */
  readonly actions: readonly ProposalAction[]
  /**
   * The 重点提醒 mails: serious, directly addressed, or involving a superior.
   * Informational — they sit above the action groups, never ticked.
   */
  readonly highlights?: readonly ProposalHighlight[]
  /** The 汇总类 mails (邮催、通知), merged into one block instead of per-mail alarms. */
  readonly digest?: readonly ProposalHighlight[]
}

/** What one group of same-kind actions is called on the card — dictionary keys, translated at render. */
export const GROUP_KEYS: Record<ProposalAction['kind'], WorkbenchLocaleKey> = {
  'create-entity': 'group.createEntity',
  'append-log': 'group.projectUpdate',
  'write-state': 'group.writeState',
  'save-resource': 'group.resource',
  'create-link': 'group.domainLink',
  'add-todo': 'group.todo',
}

/** Today as a YYYY-MM-DD stamp, in the human's own timezone. */
export function stamp(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const date = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

/** Characters a file name may not carry on Windows; a mail subject has all of them. */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim().replace(/^\.+/, '')
}

/**
 * One resource note: the distilled points up front (what a reader skims), the
 * mail's raw body below them (what a reader verifies against), and the dated
 * provenance line last. The raw body is kept because a summary alone cannot
 * answer "它到底说了什么" — the mail is the evidence, the 要点 are the index.
 * @param name - the resource's title.
 * @param summary - the model's summary.
 * @param mail - the mail the note keeps, when the analysis named one.
 * @returns the note's content.
 */
export function resourceNote(name: string, summary: string, mail?: KbMailMessage): string {
  const body = mail === undefined || mail.body.trim() === ''
    ? '（无正文）'
    : `${mail.body}${mail.truncated ? '\n\n（正文过长，此处截断）' : ''}`
  return [
    '---',
    'type: resource',
    'source: mail',
    `created: ${stamp()}`,
    'tags: []',
    '---',
    '',
    '## 要点',
    '',
    summary,
    '',
    '## 原文',
    '',
    body,
    '',
    '## 提炼记录',
    '',
    `- ${stamp()} 由邮件分析留存：${name}`,
    '',
  ].join('\n')
}

/**
 * Turn a mail analysis into a proposal (ADR-0019 → ADR-0021 决定 4): the four
 * blocks become a flat action list in a fixed order — people, todos, project
 * notes, resources — so the card groups them and the applier runs them in one
 * pass. A project the KB does not hold keeps its action with an empty path:
 * the card still shows it, and the applier still reports the miss.
 *
 * The batch itself rides along for two jobs: a resource's 原文 section keeps
 * the mail it came from, and the per-mail verdicts become the card's 重点提醒
 * and 汇总类 blocks — informational, above the tickable groups.
 * @param analysis - what the session proposed.
 * @param entities - the workspace picture the names resolve against.
 * @param title - the card's heading; the analysis run's session title.
 * @param mails - the analysed batch, in the prompt's order (1-based verdicts cite it).
 * @returns the proposal.
 */
export function analysisToProposal(
  analysis: MailAnalysis,
  entities: MailEntities,
  title: string,
  mails: readonly KbMailMessage[] = [],
): Proposal {
  const actions: ProposalAction[] = []
  for (const person of analysis.people) {
    actions.push({
      kind: 'create-entity',
      entityType: 'person',
      name: person.name,
      reason: person.relation !== '' ? `${person.relation}：${person.reason}` : person.reason,
      ...person.email !== undefined && person.email !== '' ? { email: person.email } : {},
    })
  }
  for (const todo of analysis.todos) {
    actions.push({
      kind: 'add-todo',
      title: todo.title,
      body: todo.body,
      reason: todo.body,
      ...todo.due !== undefined ? { due: todo.due } : {},
    })
  }
  for (const note of analysis.projects) {
    const file = entities.files.find(entry => entry.name === note.name)
    actions.push({
      kind: 'append-log',
      entityPath: file?.path ?? '',
      entityName: note.name,
      text: note.note,
      reason: note.note,
    })
  }
  for (const resource of analysis.resources) {
    actions.push({
      kind: 'save-resource',
      path: `resources/${safeName(resource.name)}.md`,
      content: resourceNote(resource.name, resource.summary, resource.mail !== undefined ? mails[resource.mail - 1] : undefined),
      reason: resource.summary,
    })
  }
  const highlightOf = (mail: number): ProposalHighlight | undefined => {
    const source = mails[mail - 1]
    if (source === undefined) return undefined
    return { sender: source.senderName, subject: source.subject || '（无主题）', why: '' }
  }
  const highlights: ProposalHighlight[] = []
  const digest: ProposalHighlight[] = []
  for (const verdict of analysis.verdicts) {
    const flagged = highlightOf(verdict.mail)
    if (flagged === undefined) continue
    const entry = { ...flagged, why: verdict.why }
    if (verdict.importance === 'focus') highlights.push(entry)
    if (verdict.importance === 'digest') digest.push(entry)
  }
  return {
    title,
    actions,
    ...(highlights.length > 0 ? { highlights } : {}),
    ...(digest.length > 0 ? { digest } : {}),
  }
}
