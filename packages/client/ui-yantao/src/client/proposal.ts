/**
 * The unified proposal schema's client face (ADR-0021 决定 4): one shape for
 * everything an agent proposes and a human confirms — the mail analysis's
 * four blocks land here as a flat action list.
 *
 * ADR-0060 决定 7: the schema and the applier engine live in the controller's
 * shared module (`@deepseek-ai/dsh-api-yantao-kb-controller/proposal-apply`),
 * and this module re-exports them for the workbench while keeping the two
 * client-side producers — the card's group labels and the mail analysis →
 * proposal conversion.
 * @module @deepseek-ai/dsh-client-ui-yantao/proposal
 */
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type {
  Proposal, ProposalAction, ProposalHighlight,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/proposal-apply'
import type { MailAnalysis } from './mail-analysis.ts'
import { bareSubject } from './mail-threads.ts'
import type { MailEntities } from './mail-apply.ts'
import type { WorkbenchLocaleKey } from './locales.ts'

export type {
  ProposalEntityType, ProposalAction, ProposalHighlight, ProposalMailRange,
  ProposalFinding, ProposalOrphan, ProposalPrescan, Proposal,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/proposal-apply'
export { allProposalActions, stamp } from '@deepseek-ai/dsh-api-yantao-kb-controller/proposal-apply'

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
  'archive-mails': 'group.saveMails',
  'skill-rewrite': 'group.skillRewrite',
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
  // ADR-0038 决定 6: every action born of a mail carries its source — the
  // 1-based batch number and the mail's subject — so the card can group
  // creations per mail and label supplements with what they supplement.
  // Provenance attaches only when the cited mail is actually in the batch.
  const provenanceOf = (mail: number | undefined) => {
    const source = mail === undefined ? undefined : mails[mail - 1]
    if (mail === undefined || source === undefined) return {}
    return { mail, mailSubject: source.subject || '（无主题）' }
  }
  for (const person of analysis.people) {
    actions.push({
      kind: 'create-entity',
      entityType: 'person',
      name: person.name,
      reason: person.reason,
      ...person.relation !== undefined ? { relation: person.relation } : {},
      ...person.email !== undefined && person.email !== '' ? { email: person.email } : {},
      ...provenanceOf(person.mail),
    })
  }
  for (const todo of analysis.todos) {
    actions.push({
      kind: 'add-todo',
      title: todo.title,
      body: todo.body,
      reason: todo.body,
      ...todo.due !== undefined ? { due: todo.due } : {},
      ...provenanceOf(todo.mail),
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
      ...provenanceOf(note.mail),
    })
  }
  // 2026-10-09 三提名合一: save nominees become tickable archive-mails
  // actions — the model picks the mail and writes the index summary; the
  // human's tick arms the save (原件＋附件＋一行索引) through the
  // human-channel-only archive verb. A nominee whose mail is not in the batch
  // is unattributable (no entryId) and dropped; the model may nominate the
  // same mail twice — keep the first, drop the rest. The ledger is seeded
  // here, ahead of the newProjects loop, so a project-creating mail that the
  // model forgot to nominate still gets its archive row (2026-10-15 立项
  // 实质化: 立项必留痕) and the loop below cannot double-nominate.
  const savedIds = new Set<string>()
  for (const save of analysis.saves) {
    const source = mails[save.mail - 1]
    if (source === undefined || savedIds.has(source.entryId)) continue
    savedIds.add(source.entryId)
    actions.push({
      kind: 'archive-mails',
      entryId: source.entryId,
      sender: source.senderName,
      subject: source.subject || '（无主题）',
      summary: save.summary,
      reason: save.summary,
    })
  }
  // ADR-0034 决定 3: the 「建立项目」 intent lands here, apart from the
  // must-already-exist `projects`. A suggested area that the KB does not
  // actually hold is dropped, not written — the same anti-hallucination rule
  // the projects slot obeys, applied to associations.
  //
  // 2026-10-15 立项实质化: a create is no longer allowed to be the whole
  // story. The nomination's brief rides as an edit-section follower
  // (afterCreate, ADR-0030) that fills the fresh entity's 目标 section —
  // the same proven pattern the meeting material follows. And the source
  // mail is archived alongside unless the model already nominated it in
  // `saves`: a project born from a mail keeps the mail.
  for (const project of analysis.newProjects) {
    const areas = (project.areas ?? []).filter(area => entities.areas.includes(area))
    actions.push({
      kind: 'create-project',
      name: project.name,
      reason: project.why,
      ...(areas.length > 0 ? { areas } : {}),
      ...provenanceOf(project.mail),
    })
    if (project.brief !== '') {
      actions.push({
        kind: 'edit-section',
        path: '',
        section: '目标',
        before: '',
        after: project.brief,
        why: project.why,
        afterCreate: project.name,
        ...provenanceOf(project.mail),
      })
    }
    const source = project.mail !== undefined ? mails[project.mail - 1] : undefined
    if (source !== undefined && !savedIds.has(source.entryId)) {
      savedIds.add(source.entryId)
      const summary = project.brief !== '' ? project.brief : project.why
      actions.push({
        kind: 'archive-mails',
        entryId: source.entryId,
        sender: source.senderName,
        subject: source.subject || '（无主题）',
        summary,
        reason: summary,
      })
    }
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
        ...provenanceOf(meeting.mail),
      })
      for (const line of material) {
        actions.push({
          kind: 'append-section',
          path: '',
          section: line.section,
          text: line.text,
          why: meeting.why,
          afterCreate: meeting.name,
          ...provenanceOf(meeting.mail),
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
        ...provenanceOf(meeting.mail),
      })
    }
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
  // ADR-0038 决定 2: a deletion nominee already owns a tickable row in the
  // delete group — it does not also clutter the digest block.
  const deleted = new Set(analysis.deletions.map(deletion => deletion.mail))
  // Digest mails merge per stream (the panel groups them its own way): one
  // 汇总类 line per stream, `主题 ×N`, instead of one row per ping.
  // ADR-0038 决定 3: the merge key degrades to sender + bare subject. System
  // digest pushes (weWork/贴近一线) each carry their own ConversationID, so
  // the cid-authoritative threadKey would split what is really one stream;
  // this is display-layer only — the panel's threading keeps threadKey.
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
    if (deleted.has(verdict.mail)) continue
    const source = mails[verdict.mail - 1]
    const key = source === undefined
      ? `verdict:${verdict.mail}`
      : `${source.senderAddress}\n${bareSubject(source.subject) || source.subject}`
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
