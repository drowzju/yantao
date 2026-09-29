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
import type { KbMailMessage, KbPersonRelation } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { MailAnalysis } from './mail-analysis.ts'
import { bareSubject, threadKey } from './mail-threads.ts'
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
    /**
     * The person's relation to the owner, handed to `createEntity` so the
     * frontmatter records what the analysis judged instead of the template's
     * `subordinate` default. Only meaningful for a `person`.
     */
    readonly relation?: KbPersonRelation
    /** The person's e-mail address, written into the frontmatter `email:` field. */
    readonly email?: string
  }
  | {
    /**
     * Create one project, with the area association in the same confirming
     * breath (ADR-0034 决定 4): the ticked area names are written into the
     * fresh file's frontmatter `areas: []` — the one spot the agent's tools
     * cannot reach but the human channel may. Separate from `create-entity`
     * so the card can group and dress it differently (领域勾选).
     */
    readonly kind: 'create-project'
    readonly name: string
    readonly reason: string
    /** Suggested area names, already filtered to ones the KB holds. */
    readonly areas?: readonly string[]
  }
  | {
    /** Append one dated bullet to an entity's `## 流水` (the append-only section). */
    readonly kind: 'append-log'
    readonly entityPath: string
    readonly entityName: string
    readonly text: string
    readonly reason: string
    /**
     * When the action targets an entity this same card creates: the create's
     * name. The applier resolves the path as the create runs (ADR-0030) —
     * the create must be ticked and succeed, or the row is skipped.
     */
    readonly afterCreate?: string
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
    /** Same create-follows-create resolution as `append-log`'s (ADR-0030). */
    readonly afterCreate?: string
  }
  | {
    /** Join one line of work into the todo singleton, under optimistic concurrency. */
    readonly kind: 'add-todo'
    readonly title: string
    readonly due?: string
    readonly body: string
    readonly reason: string
  }
  | {
    /**
     * Replace one `## ` section's body in an entity file (ADR-0029 决定 3).
     * `before` is what the model saw (shown on the card); at apply time the
     * file is re-read and the section re-located, so `after` always lands on
     * the current body, never on a snapshot. A section the file does not
     * carry is created (only the UI channel may create sections —
     * `kb_edit_section` hard-errors on a missing anchor); `## 流水` is
     * refused at apply time (append-only iron law).
     */
    readonly kind: 'edit-section'
    readonly path: string
    /** The section heading without the `## ` prefix, e.g. `状态`. */
    readonly section: string
    readonly before: string
    readonly after: string
    readonly why: string
    /**
     * When the section lives in an entity this same card creates: the
     * create's name. The applier resolves the path as the create runs
     * (ADR-0030) — the create must be ticked and succeed, or the row is
     * skipped.
     */
    readonly afterCreate?: string
  }
  | {
    /**
     * Append one line at the end of a named `## ` section (ADR-0034 决定 4:
     * meeting enrichment lands in 决议/待办). Unlike `edit-section` this never
     * replaces anything — enrichment adds to what the section already holds;
     * a section the file does not carry is created (UI channel only).
     */
    readonly kind: 'append-section'
    readonly path: string
    /** The section heading without the `## ` prefix, e.g. `决议`. */
    readonly section: string
    readonly text: string
    readonly why: string
    /** Same create-follows-create resolution as `edit-section`'s (ADR-0030). */
    readonly afterCreate?: string
  }
  | {
    /**
     * Remember one behavior rule in a scope (ADR-0032 批次③). The scope is
     * pinned by the UI — the mail analysis's proposals all land in `mail` —
     * so a misjudged rule can never leak into every task as a global memory.
     * The applier routes it through `memoryAdd`; an exact duplicate is
     * rendered as 已记得, not an error.
     */
    readonly kind: 'add-memory'
    readonly scope: string
    readonly text: string
    readonly reason: string
  }
  | {
    /**
     * Move one nominated mail to Outlook's 已删除 folder (ADR-0034 决定 5).
     * The agent only nominates; the knife swings on the human's tick — the
     * applier routes it through the optional `deleteMails` seam, which drives
     * the controller's human-channel-only `verb: 'delete'`. Absent seam ⇒
     * the row is honestly skipped, never silently executed elsewhere.
     */
    readonly kind: 'delete-mails'
    readonly entryId: string
    readonly sender: string
    readonly subject: string
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

/**
 * One finding of the validate gesture (ADR-0035 决定 3): a pure display row
 * on the card — never ticked, never an action. The fix, when the model
 * proposed one, lives in the action groups on its own.
 */
export interface ProposalFinding {
  /** What kind of finding: `orphan`, `broken-link`, `stale`, `contradiction`, `missing`. */
  readonly kind: string
  /** The entity or link the finding names. */
  readonly subject: string
  /** One line of why. */
  readonly why: string
}

/** One orphan the prescan found, as the deterministic block shows it. */
export interface ProposalOrphan {
  readonly name: string
  readonly type: string
  /** How many links resolve into it. */
  readonly incoming: number
}

/**
 * The validate gesture's deterministic block (ADR-0036 决定 6): everything
 * the code computed and the model never saw — orphan entities, broken links
 * that found no credible fix, and the tickable fix-candidate rows. Kept as
 * its own object so a prescan row and a model row cannot meet in one array;
 * the card renders it above the model block, in a calmer style.
 */
export interface ProposalPrescan {
  /** Entities at most one link resolves into. */
  readonly orphans: readonly ProposalOrphan[]
  /** Broken links (and the 流水/小节外 strays) that degrade to display rows. */
  readonly findings: readonly ProposalFinding[]
  /**
   * The fix-candidate rows, tickable like any action. The applier resolves
   * ticked indices against `[...prescan.actions, ...actions]` — these sit
   * at the front of the execution order.
   */
  readonly actions: readonly ProposalAction[]
}

/** Everything one run proposes; the human ticks actions, not blocks. */
export interface Proposal {
  /** The card's heading — which judgement these actions came from. */
  readonly title: string
  /** One line under the title, e.g. that the session is kept for re-reading. */
  readonly note?: string
  /**
   * The model block's actions, in the order the applier executes them —
   * after any {@link Proposal.prescan} rows, which precede them in the
   * applier's resolution order.
   *
   * Invariant: these rows and `prescan.actions` must be disjoint — both the
   * applier and the card resolve over `[...prescan.actions, ...actions]`
   * (see {@link allProposalActions}), so a row carried in both arrays would
   * render twice and execute twice.
   */
  readonly actions: readonly ProposalAction[]
  /**
   * The 重点提醒 mails: serious, directly addressed, or involving a superior.
   * Informational — they sit above the action groups, never ticked.
   */
  readonly highlights?: readonly ProposalHighlight[]
  /** The 汇总类 mails (邮催、通知), merged into one block instead of per-mail alarms. */
  readonly digest?: readonly ProposalHighlight[]
  /**
   * The KB's area names, offered to the create-project rows' 领域勾选
   * (ADR-0034 决定 4). Absent when the KB holds no areas.
   */
  readonly areas?: readonly string[]
  /**
   * The model block's findings (ADR-0036 决定 6): the diagnostician's
   * semantic rows, styled as before. Deterministic prescan rows live in
   * {@link Proposal.prescan}, never here.
   */
  readonly findings?: readonly ProposalFinding[]
  /**
   * The deterministic prescan block (ADR-0036 决定 2/4/6): zero-token
   * findings and fix candidates, rendered above — and visually apart
   * from — everything the model said. Absent for the other gestures.
   */
  readonly prescan?: ProposalPrescan
}

/**
 * Every tickable row in the applier's execution order: prescan fixes first,
 * then the model's. THE canonical concatenation — the card's tick indices
 * and `applyProposal`'s resolution both read it, so the disjointness
 * contract between the two arrays lives in exactly one place.
 */
export function allProposalActions(proposal: Proposal): readonly ProposalAction[] {
  return [...(proposal.prescan?.actions ?? []), ...proposal.actions]
}

/** What one group of same-kind actions is called on the card — dictionary keys, translated at render. */
export const GROUP_KEYS: Record<ProposalAction['kind'], WorkbenchLocaleKey> = {
  'create-entity': 'group.createEntity',
  'create-project': 'group.createProject',
  'append-log': 'group.projectUpdate',
  'write-state': 'group.writeState',
  'save-resource': 'group.resource',
  'create-link': 'group.domainLink',
  'add-todo': 'group.todo',
  'edit-section': 'group.editSection',
  'append-section': 'group.appendSection',
  'add-memory': 'group.memory',
  'delete-mails': 'group.deleteMails',
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
      reason: person.reason,
      ...person.relation !== undefined ? { relation: person.relation } : {},
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
  // ADR-0034 决定 3: the 「建立项目」 intent lands here, apart from the
  // must-already-exist `projects`. A suggested area that the KB does not
  // actually hold is dropped, not written — the same anti-hallucination rule
  // the projects slot obeys, applied to associations.
  for (const project of analysis.newProjects) {
    const areas = (project.areas ?? []).filter(area => entities.areas.includes(area))
    actions.push({
      kind: 'create-project',
      name: project.name,
      reason: project.why,
      ...(areas.length > 0 ? { areas } : {}),
    })
  }
  // ADR-0034 决定 3/4: a meeting the KB holds gains 决议/待办 material in
  // place; a new one is created first and the material follows it through
  // the create-follows-create resolution (ADR-0030).
  for (const meeting of analysis.meetings) {
    const material: readonly { section: string; text: string }[] = [
      ...(meeting.decision !== undefined && meeting.decision !== '' ? [{ section: '决议', text: meeting.decision }] : []),
      ...(meeting.todo !== undefined && meeting.todo !== '' ? [{ section: '待办', text: meeting.todo }] : []),
    ]
    if (meeting.isNew) {
      actions.push({
        kind: 'create-entity',
        entityType: 'meeting',
        name: meeting.name,
        reason: meeting.why,
      })
      for (const line of material) {
        actions.push({
          kind: 'append-section',
          path: '',
          section: line.section,
          text: line.text,
          why: meeting.why,
          afterCreate: meeting.name,
        })
      }
      continue
    }
    const file = entities.meetingFiles.find(entry => entry.name === meeting.name)
    for (const line of material) {
      actions.push({
        kind: 'append-section',
        path: file?.path ?? '',
        section: line.section,
        text: line.text,
        why: meeting.why,
      })
    }
  }
  for (const resource of analysis.resources) {
    actions.push({
      kind: 'save-resource',
      path: `resources/${safeName(resource.name)}.md`,
      content: resourceNote(resource.name, resource.summary, resource.mail !== undefined ? mails[resource.mail - 1] : undefined),
      reason: resource.summary,
    })
  }
  // ADR-0032 批次③: the model proposes only text and why; the scope is
  // pinned here to `mail` — the analysis's own surface — so a rule it
  // misjudges stays out of every other task.
  for (const memory of analysis.memories) {
    actions.push({
      kind: 'add-memory',
      scope: 'mail',
      text: memory.text,
      reason: memory.why,
    })
  }
  const highlightOf = (mail: number): ProposalHighlight | undefined => {
    const source = mails[mail - 1]
    if (source === undefined) return undefined
    return { sender: source.senderName, subject: source.subject || '（无主题）', why: '' }
  }
  const highlights: ProposalHighlight[] = []
  // Digest mails merge per thread (the panel groups them the same way): one
  // 汇总类 line per conversation, `主题 ×N`, instead of one row per ping.
  const digest = new Map<string, { entry: ProposalHighlight; count: number }>()
  for (const verdict of analysis.verdicts) {
    const flagged = highlightOf(verdict.mail)
    if (flagged === undefined) continue
    const entry = { ...flagged, why: verdict.why }
    if (verdict.importance === 'focus') {
      highlights.push(entry)
      continue
    }
    if (verdict.importance !== 'digest') continue
    const source = mails[verdict.mail - 1]
    const key = source === undefined ? `verdict:${verdict.mail}` : threadKey(source)
    const merged = digest.get(key)
    if (merged === undefined) {
      const topic = source?.conversationTopic || flagged.subject
      digest.set(key, { entry: { sender: flagged.sender, subject: topic, why: verdict.why }, count: 1 })
      continue
    }
    merged.count += 1
    if (verdict.why !== '' && merged.entry.why !== verdict.why) {
      merged.entry = { ...merged.entry, why: `${merged.entry.why}；${verdict.why}` }
    }
  }
  const digestRows = [...digest.values()].map(({ entry, count }) =>
    count > 1 ? { ...entry, subject: `${bareSubject(entry.subject) || entry.subject} ×${count}` } : entry,
  )
  // ADR-0034 决定 5: deletion nominees become tickable delete-mails actions —
  // the agent nominates, the human's tick swings the knife through the
  // controller's human-channel-only delete verb. A nominee whose mail is not
  // in the batch is unattributable (no entryId to move) and dropped.
  for (const deletion of analysis.deletions) {
    const source = mails[deletion.mail - 1]
    if (source === undefined) continue
    actions.push({
      kind: 'delete-mails',
      entryId: source.entryId,
      sender: source.senderName,
      subject: source.subject || '（无主题）',
      reason: deletion.reason,
    })
  }
  return {
    title,
    actions,
    ...(highlights.length > 0 ? { highlights } : {}),
    ...(digestRows.length > 0 ? { digest: digestRows } : {}),
    ...(entities.areas.length > 0 ? { areas: [...entities.areas] } : {}),
  }
}
