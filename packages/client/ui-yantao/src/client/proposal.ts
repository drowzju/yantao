/**
 * The unified proposal schema (ADR-0021 决定 4): one shape for everything an
 * agent proposes and a human confirms — the mail analysis's four blocks and
 * the reading flow's domain proposal both land here as flat action lists.
 *
 * A proposal proposes; nothing in this module writes to the KB. Applying is
 * {@link ./proposal-apply.ts} `applyProposal`'s business, and only after the
 * human has ticked rows in {@link ProposalCard}.
 * @module @deepseek-ai/dsh-client-ui-yantao/proposal
 */
import type { MailAnalysis } from './mail-analysis.ts'
import type { MailEntities } from './mail-apply.ts'
import type { ReadingRun } from './reading-flow.ts'

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

/** Everything one run proposes; the human ticks actions, not blocks. */
export interface Proposal {
  /** The card's heading — which judgement these actions came from. */
  readonly title: string
  /** One line under the title, e.g. that the session is kept for re-reading. */
  readonly note?: string
  /** The actions, in the order the applier executes them. */
  readonly actions: readonly ProposalAction[]
}

/** What one group of same-kind actions is called on the card. */
export const GROUP_LABELS: Record<ProposalAction['kind'], string> = {
  'create-entity': '新建实体',
  'append-log': '项目动态',
  'write-state': '写状态',
  'save-resource': '资源',
  'create-link': '领域关联',
  'add-todo': '待办',
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
 * One resource note: the same skeleton a registered resource gets, with the
 * summary the model wrote filled in.
 * @param name - the resource's title.
 * @param summary - the model's summary.
 * @returns the note's content.
 */
export function resourceNote(name: string, summary: string): string {
  return `---\ntype: resource\nsource: mail\ncreated: ${stamp()}\ntags: []\n---\n\n## 摘要\n\n${summary}\n\n## 提炼记录\n\n- ${stamp()} 由邮件分析留存：${name}\n`
}

/**
 * An entity's display name, from its KB-relative path — the file name without
 * the `.md` suffix, which is how the rails label it.
 * @param path - the entity's KB-relative path.
 * @returns the display name.
 */
function entityNameOf(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/, '')
}

/**
 * Turn a mail analysis into a proposal (ADR-0019 → ADR-0021 决定 4): the four
 * blocks become a flat action list in a fixed order — people, todos, project
 * notes, resources — so the card groups them and the applier runs them in one
 * pass. A project the KB does not hold keeps its action with an empty path:
 * the card still shows it, and the applier still reports the miss.
 * @param analysis - what the session proposed.
 * @param entities - the workspace picture the names resolve against.
 * @param title - the card's heading; the analysis run's session title.
 * @returns the proposal.
 */
export function analysisToProposal(analysis: MailAnalysis, entities: MailEntities, title: string): Proposal {
  const actions: ProposalAction[] = []
  for (const person of analysis.people) {
    actions.push({
      kind: 'create-entity',
      entityType: 'person',
      name: person.name,
      reason: person.relation !== '' ? `${person.relation}：${person.reason}` : person.reason,
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
      content: resourceNote(resource.name, resource.summary),
      reason: resource.summary,
    })
  }
  return { title, actions }
}

/**
 * Turn a reading run's domain proposal into a proposal (ADR-0020 → ADR-0021
 * 决定 4): each existing domain becomes one `[[领域:…]]` link into the
 * project's 状态, and a proposed new domain becomes a create followed by its
 * link — the applier executes in order, so the link lands after the creation.
 * @param run - the first round's result.
 * @param projectPath - the reading project's KB-relative path.
 * @returns the proposal.
 */
export function readingProposalOf(run: ReadingRun, projectPath: string): Proposal {
  const name = entityNameOf(projectPath)
  const actions: ProposalAction[] = run.proposal.domains.map(domain => ({
    kind: 'create-link',
    entityPath: projectPath,
    entityName: name,
    link: `[[领域:${domain}]]`,
    reason: `模型判断这本书适合挂到「${domain}」之下`,
  }))
  const { newDomain } = run.proposal
  if (newDomain !== undefined) {
    actions.push({
      kind: 'create-entity',
      entityType: 'area',
      name: newDomain,
      reason: '知识库还没有这个领域，模型建议新建',
    })
    actions.push({
      kind: 'create-link',
      entityPath: projectPath,
      entityName: name,
      link: `[[领域:${newDomain}]]`,
      reason: `新建领域后把书挂到「${newDomain}」之下`,
    })
  }
  return { title: run.title, note: '会话已保留，可以回去看它为什么这么判断。', actions }
}
