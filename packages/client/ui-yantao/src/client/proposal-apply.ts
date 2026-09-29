/**
 * Applying a proposal (ADR-0021 决定 4): the one place where ticked actions
 * become KB writes, and it runs strictly after the human has ticked them.
 *
 * Six kinds of write, each the smallest thing that lands the verdict: an
 * entity is created from the canonical template, a bullet joins an entity's
 * `## 流水` (append-only, never rewritten), a line joins `## 状态`, a file
 * lands under `resources/`, a `[[…]]` link is written into a 状态 section,
 * and todo lines join the singleton's item list under optimistic concurrency
 * in one batched call (ADR-0018). The refine loop adds a seventh
 * (ADR-0029 决定 3): one `## ` section's body is replaced — the file is
 * re-read and the section re-located at apply time, a missing section is
 * created, `## 流水` is refused, and one failed action is marked while the
 * rest still land.
 *
 * The mail analysis's confirm lands here too (ADR-0019 amended): what used to
 * be a second agent round prompting `kb_create_entity`/`kb_write_state` is
 * now these direct writes — the UI is the human channel (hard rule 2), and
 * the session stays kept for re-reading either way.
 * @module @deepseek-ai/dsh-client-ui-yantao/proposal-apply
 */
import type {
  KbMailDeleteResult, KbTodoItem, KbTodosResult, KbWriteTodosResult,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { isDuplicateMemory, type EntityCreator, type FileReader, type FileWriter, type MailDeleter, type MemoryAdder, type TodoLoader, type TodoWriter } from './remote.ts'
import type { Proposal, ProposalAction } from './proposal.ts'
import { stamp } from './proposal.ts'

/** What the writes need of the KB: the same seams the panes already use. */
export interface ProposalTarget {
  /** Create one entity and resolve its path. */
  readonly createEntity: EntityCreator
  /** Read one KB file's content. */
  readonly read: FileReader
  /** Write one KB file's full content. */
  readonly write: FileWriter
  /** Read the todo singleton. */
  readonly todos: TodoLoader
  /** Write the todo singleton under optimistic concurrency. */
  readonly writeTodos: TodoWriter
  /** Remember one behavior rule (ADR-0032 批次③); an exact duplicate is refused. */
  readonly memoryAdd: MemoryAdder
  /**
   * Move nominated mails to Outlook's 已删除 folder (ADR-0034 决定 5) —
   * optional, because only the human channel carries the knife: a caller
   * without it (the refine loop's target) skips delete-mails rows honestly
   * instead of executing them somewhere unseen.
   */
  readonly deleteMails?: MailDeleter
}

/** What one confirmed card produced. */
export interface ProposalApplyResult {
  /** One line per thing written, for the caller's summary. */
  readonly written: readonly string[]
  /** Actions that could not be written, with the reason. */
  readonly skipped: readonly string[]
}

/**
 * Append one bullet to an entity's `## 流水` — the append-only section, which
 * is why this is an append and not a rewrite.
 * @param content - the file's current content.
 * @param note - the line to add.
 * @returns the new content.
 */
export function appendLog(content: string, note: string): string {
  return `${content.replace(/\s*$/, '')}\n- ${stamp()} ${note}\n`
}

/**
 * Append one line at the end of a markdown section: after the section's
 * heading, before the next heading of the same or higher level. A section the
 * file does not carry (a human may have deleted it) falls back to appending
 * at the end of the file — the line is not lost to a missing heading.
 * @param content - the file's current content.
 * @param heading - the section heading to insert into, e.g. `## 状态`.
 * @param text - the line(s) to insert.
 * @returns the new content.
 */
export function insertIntoSection(content: string, heading: string, text: string): string {
  const lines = content.replace(/\s*$/, '').split('\n')
  const start = lines.findIndex(line => line.trim() === heading)
  if (start === -1) return `${content.replace(/\s*$/, '')}\n${text}\n`
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2} /.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  let sectionEnd = end
  while (sectionEnd > start + 1 && lines[sectionEnd - 1]?.trim() === '') sectionEnd -= 1
  return [...lines.slice(0, sectionEnd), text, ...lines.slice(sectionEnd), ''].join('\n')
}

/**
 * Replace one markdown section's body: everything between the section's
 * heading and the next heading of the same or higher level becomes `after`.
 * A heading the file does not carry creates the section at the end of the
 * file — only the UI channel may create sections (`kb_edit_section`
 * hard-errors on a missing anchor, ADR-0026), and this runs on the UI
 * channel after the human ticked the row. A heading carried twice is an
 * error, not a guess: replacing "the" body of an ambiguous section would
 * silently pick one.
 * @param content - the file's current content.
 * @param heading - the full section heading, e.g. `## 状态`.
 * @param after - the new body (trimmed of surrounding blank lines).
 * @returns the new content.
 */
export function replaceSection(content: string, heading: string, after: string): string {
  const lines = content.replace(/\s*$/, '').split('\n')
  const starts: number[] = []
  for (const [index, line] of lines.entries()) {
    if (line.trim() === heading) starts.push(index)
  }
  if (starts.length === 0) {
    return `${content.replace(/\s*$/, '')}\n\n${heading}\n\n${after.trim()}\n`
  }
  if (starts.length > 1) throw new Error(`小节 ${heading} 在文件中出现 ${starts.length} 次，无法定位`)
  const start = starts[0] as number
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2} /.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  return [...lines.slice(0, start + 1), '', after.trim(), ...lines.slice(end), ''].join('\n')
}

/** The label one written action reports, for the caller's summary. */
function writtenLine(action: ProposalAction): string {
  switch (action.kind) {
    case 'create-entity': return `实体 ${action.name}`
    case 'create-project': return `项目 ${action.name}`
    case 'append-log': return `项目动态 ${action.entityName}`
    case 'write-state': return `状态 ${action.entityName}`
    case 'save-resource': return `资源 ${action.path}`
    case 'create-link': return `关联 ${action.entityName} → ${action.link}`
    case 'add-todo': return `待办 ${action.title}`
    // A create-following section action carries no path until the applier
    // resolves it; the create's name is what the human ticked.
    case 'edit-section': return `章节 ${action.section}（${action.path !== '' ? action.path : action.afterCreate ?? ''}）`
    case 'append-section': return `章节 ${action.section}（${action.path !== '' ? action.path : action.afterCreate ?? ''}）`
    case 'add-memory': return `记忆（${action.scope}）${action.text}`
    case 'delete-mails': return `删除邮件 ${action.subject}`
  }
}

/** The message one failed action reports, for the card's 标红 list. */
function failedLine(action: ProposalAction, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${writtenLine(action)}：${message}`
}

/**
 * Write everything the human ticked, in index order.
 *
 * Todos go through one `writeTodos` call carrying the text the board last
 * read, so a concurrent edit in Obsidian is reported rather than clobbered
 * (ADR-0018). An entity action whose path could not be resolved at proposal
 * time (`entityPath: ''`) is skipped, not guessed: the prompt told the model
 * to match existing names, and guessing a filename is worse than reporting
 * the miss.
 * @param options - the proposal, the ticked indexes, the create-project rows'
 *   adjusted 领域勾选 keyed by action index (absent: keep the model's
 *   suggestion, ADR-0034 决定 4), and the KB seams.
 * @returns what was written and what was skipped.
 */
export async function applyProposal(options: {
  readonly proposal: Proposal
  readonly ticked: readonly number[]
  readonly areaPicks?: Readonly<Record<number, readonly string[]>>
  readonly target: ProposalTarget
}): Promise<ProposalApplyResult> {
  const { proposal, ticked, target } = options
  // The validate card's deterministic fix rows precede the model's in the
  // execution order (ADR-0036 决定 6): the card ticks indices over this same
  // concatenation, so one resolution serves both blocks.
  const allActions = [...(proposal.prescan?.actions ?? []), ...proposal.actions]
  const picked = ticked
    .map(index => ({ index, action: allActions[index] }))
    .filter((row): row is { index: number; action: ProposalAction } => row.action !== undefined)
  const written: string[] = []
  const skipped: string[] = []

  const todos = picked
    .map(row => row.action)
    .filter((action): action is Extract<ProposalAction, { kind: 'add-todo' }> => action.kind === 'add-todo')
  // An explicit predicate: TS 5.5 only infers one when the check narrows the
  // parameter itself, and here the discriminant sits on `row.action`.
  const rest = picked.filter(
    (row): row is { index: number; action: Exclude<ProposalAction, { kind: 'add-todo' }> } =>
      row.action.kind !== 'add-todo',
  )

  // The paths of the entities this very card created, by name: a create's own
  // edits, links, and log follow it (ADR-0030). A create that was not ticked
  // or that failed leaves no entry, and its followers are skipped, not guessed.
  const created = new Map<string, string>()
  const resolveAfterCreate = (name: string): string | undefined => created.get(name)

  for (const { index, action } of rest) {
    try {
      if (action.kind === 'create-entity') {
        // Only the mail path names a person's address; its analysis also
        // judges the relation, which must ride along or the template's
        // `subordinate` default records every person as a 下属.
        const path = await target.createEntity(
          action.entityType,
          action.name,
          action.relation,
          ...action.email !== undefined ? [action.email] : [],
        )
        created.set(action.name, path)
        written.push(writtenLine(action))
        continue
      }
      if (action.kind === 'create-project') {
        const path = await target.createEntity('project', action.name)
        created.set(action.name, path)
        // ADR-0034 决定 4: the area association rides in the same confirming
        // breath, so no orphan project is born. The template emits
        // `areas: []`; a file without that line (a user-template quirk) is
        // reported, not guessed at.
        const areas = options.areaPicks?.[index] ?? action.areas ?? []
        if (areas.length > 0) {
          try {
            const content = await target.read(path)
            if (!/^areas: \[\][ \t]*$/m.test(content)) throw new Error('frontmatter 里没有 areas: [] 可写')
            await target.write(
              path,
              content.replace(/^areas: \[\][ \t]*$/m, `areas: [${areas.map(area => JSON.stringify(area)).join(', ')}]`),
            )
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            skipped.push(`项目 ${action.name} 的领域关联：${message}`)
          }
        }
        written.push(writtenLine(action))
        continue
      }
      if (action.kind === 'save-resource') {
        if (action.path.endsWith('/.md')) {
          skipped.push(`资源「${action.reason}」：名字不能作为文件名`)
          continue
        }
        await target.write(action.path, action.content)
        written.push(writtenLine(action))
        continue
      }
      if (action.kind === 'add-memory') {
        // ADR-0032 批次③: the host refuses an exact duplicate — that is the
        // rule already being remembered, which reads as 已记得, not a failure.
        try {
          await target.memoryAdd(action.scope, action.text)
          written.push(writtenLine(action))
        } catch (error: unknown) {
          skipped.push(isDuplicateMemory(error)
            ? `${writtenLine(action)}：已记得，无需重记`
            : failedLine(action, error))
        }
        continue
      }
      if (action.kind === 'delete-mails') {
        // ADR-0034 决定 5: the agent nominated, the human ticked; the knife
        // itself is the controller's human-channel-only delete verb. One mail
        // per call keeps the report per-row — a batch miss marks only its own
        // row, not the group.
        const deleter = target.deleteMails
        if (deleter === undefined) {
          skipped.push(`${writtenLine(action)}：这条通道没有挂删除刀`)
          continue
        }
        const outcome: KbMailDeleteResult = await deleter([action.entryId])
        if (outcome.moved.includes(action.entryId)) {
          written.push(writtenLine(action))
        } else if (outcome.missing.includes(action.entryId)) {
          skipped.push(`${writtenLine(action)}：邮箱里找不到这封邮件（可能已被移走）`)
        } else {
          const failure = outcome.failed.find(entry => entry.id === action.entryId)
          skipped.push(`${writtenLine(action)}：${failure?.message ?? '未知原因'}`)
        }
        continue
      }
      if (action.kind === 'edit-section') {
        // Domain data, not UI copy: `## 流水` is the glossary's append-only
        // section; the UI channel must not become its bypass (ADR-0029).
        const heading = action.section.startsWith('#') ? action.section : `## ${action.section}`
        if (heading === '## 流水') {
          skipped.push(`${writtenLine(action)}：流水只增不改`)
          continue
        }
        // A create-following edit lands in the freshly created entity; an
        // unticked or failed create leaves nothing to edit.
        let path = action.path
        if (path === '' && action.afterCreate !== undefined) {
          const fresh = resolveAfterCreate(action.afterCreate)
          if (fresh === undefined) {
            skipped.push(`${writtenLine(action)}：前置的新建「${action.afterCreate}」没有落地`)
            continue
          }
          path = fresh
        }
        // Re-read at apply time: the proposal's `before` may be stale — the
        // section is re-located in the current file, never snapshot-written.
        const content = await target.read(path)
        await target.write(path, replaceSection(content, heading, action.after))
        written.push(writtenLine(action))
        continue
      }
      if (action.kind === 'append-section') {
        // Same iron law as edit-section: the UI channel never becomes the
        // 流水 bypass (ADR-0029).
        const heading = action.section.startsWith('#') ? action.section : `## ${action.section}`
        if (heading === '## 流水') {
          skipped.push(`${writtenLine(action)}：流水只增不改`)
          continue
        }
        let path = action.path
        if (path === '' && action.afterCreate !== undefined) {
          const fresh = resolveAfterCreate(action.afterCreate)
          if (fresh === undefined) {
            skipped.push(`${writtenLine(action)}：前置的新建「${action.afterCreate}」没有落地`)
            continue
          }
          path = fresh
        }
        if (path === '') {
          skipped.push(`${writtenLine(action)}：知识库里没有这个实体`)
          continue
        }
        // Re-read at apply time and append at the section's end: enrichment
        // adds to what the section holds, it never replaces (ADR-0034 决定 4).
        const content = await target.read(path)
        await target.write(path, insertIntoSection(content, heading, action.text))
        written.push(writtenLine(action))
        continue
      }
      // The entity-bodied kinds: an unresolved path is reported, not written.
      let entityPath = action.entityPath
      if (entityPath === '' && 'afterCreate' in action && typeof action.afterCreate === 'string') {
        const fresh = resolveAfterCreate(action.afterCreate)
        if (fresh === undefined) {
          skipped.push(`${writtenLine(action)}：前置的新建「${action.afterCreate}」没有落地`)
          continue
        }
        entityPath = fresh
      }
      if (entityPath === '') {
        skipped.push(`实体 ${action.entityName}：知识库里没有这个实体`)
        continue
      }
      const content = await target.read(entityPath)
      if (action.kind === 'append-log') {
        await target.write(entityPath, appendLog(content, action.text))
      } else {
        // Domain data, not UI copy: `## 状态` is the KB's own section heading
        // (the glossary's 状态), independent of the workbench locale.
        const stateSection = '## 状态'
        const line = action.kind === 'create-link' ? action.link : action.text
        await target.write(entityPath, insertIntoSection(content, stateSection, line))
      }
      written.push(writtenLine(action))
    } catch (error) {
      // One failed action is marked, not fatal: the rest of the human's
      // ticks still land (ADR-0029 决定 4).
      skipped.push(failedLine(action, error))
    }
  }

  if (todos.length > 0) {
    try {
      const current: KbTodosResult = await target.todos()
      const items: readonly KbTodoItem[] = todos.map(todo => ({
        done: false,
        title: todo.title,
        body: todo.body,
        extra: [],
        ...todo.due !== undefined ? { due: todo.due } : {},
      }))
      const result: KbWriteTodosResult = await target.writeTodos({
        items: [...current.items, ...items],
        expectedText: current.text,
      })
      written.push(`待办 ${todos.length} 条（${result.path}）`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      skipped.push(`待办 ${todos.length} 条：${message}`)
    }
  }

  return { written, skipped }
}
