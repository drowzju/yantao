/**
 * Applying a mail analysis (ADR-0019): the only place where mail becomes KB
 * content, and it runs strictly after the human has ticked the rows.
 *
 * Four kinds of write, each the smallest thing that lands the verdict:
 * a person becomes an entity file, a todo joins the singleton's item list
 * under optimistic concurrency, a project note is appended to that entity's
 * 流水 (the append-only section — never rewritten), and a chosen mail becomes
 * a resource note under `resources/`.
 * @module @deepseek-ai/dsh-client-ui-yantao/mail-apply
 */
import type {
  KbTodoItem, KbTreeFile, KbTreeSection, KbTodosResult, KbWriteTodosResult,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { EntityCreator, FileReader, FileWriter, TodoLoader, TodoWriter } from './remote.ts'
import type { MailAnalysis } from './mail-analysis.ts'

/** What the writes need of the KB: the same seams the panes already use. */
export interface MailWriteTarget {
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
}

/** Which rows the human ticked, by index into each block. */
export interface MailSelection {
  readonly people: readonly number[]
  readonly todos: readonly number[]
  readonly projects: readonly number[]
  readonly resources: readonly number[]
}

/** The workspace side of the KB, in the shape the connector needs. */
export interface MailEntities {
  /** Existing project and area names, offered to the model. */
  readonly projects: readonly string[]
  /** Existing person names, offered to the model. */
  readonly people: readonly string[]
  /** The project files themselves, so a chosen name resolves to a path. */
  readonly files: readonly KbTreeFile[]
}

/** What one confirmed review produced. */
export interface MailApplyResult {
  /** One line per thing written, for the panel's summary. */
  readonly written: readonly string[]
  /** Rows that could not be written, with the reason. */
  readonly skipped: readonly string[]
}

/** Today as a YYYY-MM-DD stamp, in the human's own timezone. */
function stamp(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const date = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

/**
 * Read the workspace tree as the connector's entity picture: names for the
 * prompt, files for the writes.
 * @param tree - the workspace tree's sections.
 * @returns the entity names and the project files.
 */
export function entitiesOfTree(tree: readonly KbTreeSection[]): MailEntities {
  const section = (id: string): readonly KbTreeFile[] =>
    tree.find(entry => entry.id === id)?.files ?? []
  const projects = section('projects')
  return {
    projects: [...projects, ...section('areas')].map(file => file.name),
    people: section('people').map(file => file.name),
    files: projects,
  }
}

/** Characters a file name may not carry on Windows; a mail subject has all of them. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim().replace(/^\.+/, '')
}

/**
 * One resource note: the same skeleton a registered resource gets, with the
 * summary the model wrote filled in.
 * @param name - the resource's title.
 * @param summary - the model's summary.
 * @returns the note's content.
 */
function resourceNote(name: string, summary: string): string {
  return `---\ntype: resource\nsource: mail\ncreated: ${stamp()}\ntags: []\n---\n\n## 摘要\n\n${summary}\n\n## 提炼记录\n\n- ${stamp()} 由邮件分析留存：${name}\n`
}

/**
 * Append one bullet to an entity's 流水 — the append-only section, which is
 * why this is an append and not a rewrite.
 * @param content - the file's current content.
 * @param note - the line to add.
 * @returns the new content.
 */
function appendLog(content: string, note: string): string {
  return `${content.replace(/\s*$/, '')}\n- ${stamp()} ${note}\n`
}

/**
 * Write everything the human ticked.
 *
 * Todos go through one `writeTodos` call carrying the text the board last
 * read, so a concurrent edit in Obsidian is reported rather than clobbered
 * (ADR-0018). A project the model named but the KB does not hold is skipped,
 * not created: the prompt told it to match existing names, and guessing a
 * filename is worse than reporting the miss.
 * @param options - the verdict, the ticked rows, the KB seams, and the files.
 * @returns what was written and what was skipped.
 */
export async function applyAnalysis(options: {
  readonly analysis: MailAnalysis
  readonly selection: MailSelection
  readonly target: MailWriteTarget
  readonly entities: MailEntities
}): Promise<MailApplyResult> {
  const { analysis, selection, target, entities } = options
  const written: string[] = []
  const skipped: string[] = []

  for (const index of selection.people) {
    const person = analysis.people[index]
    if (person === undefined) continue
    await target.createEntity('person', person.name)
    written.push(`人物 ${person.name}`)
  }

  const todos = selection.todos
    .map(index => analysis.todos[index])
    .filter((todo): todo is NonNullable<typeof todo> => todo !== undefined)
  if (todos.length > 0) {
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
  }

  for (const index of selection.projects) {
    const note = analysis.projects[index]
    if (note === undefined) continue
    const file = entities.files.find(entry => entry.name === note.name)
    if (file === undefined) {
      skipped.push(`项目 ${note.name}：知识库里没有这个实体`)
      continue
    }
    const content = await target.read(file.path)
    await target.write(file.path, appendLog(content, note.note))
    written.push(`项目动态 ${note.name}`)
  }

  for (const index of selection.resources) {
    const resource = analysis.resources[index]
    if (resource === undefined) continue
    const name = safeName(resource.name)
    if (name === '') {
      skipped.push(`资源「${resource.name}」：名字不能作为文件名`)
      continue
    }
    const path = `resources/${name}.md`
    await target.write(path, resourceNote(resource.name, resource.summary))
    written.push(`资源 ${path}`)
  }

  return { written, skipped }
}
