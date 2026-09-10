/**
 * The yantaoKb Remote controller: the workbench UI's direct KB channel.
 * `intakeTree` shapes the input side (resources, meetings, todos) and
 * `workspaceTree` the workspace side (projects, areas, people);
 * `read`/`write` address single files by KB-relative path, always confined
 * to the kbRoot the yantao-kb plugin publishes as the `yantaoKb` service —
 * one configuration point, no duplicated config. `root`/`setRoot` answer and
 * choose that root — the service persists the choice under `~/.dsh` — and `createEntity`
 * files a new note from the KB's canonical template. The UI is the human
 * channel, so `write` is a full-file write; the ADR-0004 trust boundary
 * binds only the agent's kb_ tools, never this surface.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller
 */

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  createEntity, entityDisplayPath, initKb, KbError, linksOf, listEntities, parseFrontmatter,
  parseTodoFile, PERSON_RELATIONS, readKbRootOverride, readMailWatermark, resolveWithinKb, serializeTodoFile,
  todayStamp, writeMailWatermark,
} from '@deepseek-ai/dsh-yantao-kb'
import type { EntityType } from '@deepseek-ai/dsh-yantao-kb'
import { fetchMail, MailFetchError } from './mail/fetch.ts'
import { hasScheme, isOpenable, openWithDesktop } from './open.ts'
import { KbRevision } from './watch.ts'
import type {
  KbCreateEntityArgs,
  KbCreateEntityResult,
  KbDeleteFileResult,
  KbFileContent,
  KbLinksResult,
  KbMailFetchArgs,
  KbMailFetchResult,
  KbMailMarkReadArgs,
  KbMailMarkReadResult,
  KbOpenExternalResult,
  KbRevisionResult,
  KbRootResult,
  KbSetRelationArgs,
  KbSetRelationResult,
  KbSetRootResult,
  KbTodosResult,
  KbTree,
  KbTreeFile,
  KbTreeSection,
  KbWriteResult,
  KbWriteTodosArgs,
  KbWriteTodosResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    yantaoKbController: YantaoKbController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The named KB-relative path does not name an existing file. */
    'yantao-kb/not-found': { readonly path: string }
    /** The controller refused the operation (path escape, non-file target, I/O failure). */
    'yantao-kb/rejected': { readonly path: string }
    /** The mail connector failed (ADR-0019); `kind` is one of its failure kinds. */
    'yantao-kb/mail': { readonly kind: string; readonly hint: string }
  }
}

/** Entity sections of the intake tree, in display order, mapped to their entity type. */
const INTAKE_ENTITY_SECTIONS = [
  { id: 'meetings', type: 'meeting' },
  { id: 'todos', type: 'todo' },
] as const satisfies readonly { id: KbTreeSection['id']; type: EntityType }[]

/** Entity sections of the workspace tree, in display order, mapped to their entity type. */
const WORKSPACE_ENTITY_SECTIONS = [
  { id: 'projects', type: 'project' },
  { id: 'areas', type: 'area' },
  { id: 'people', type: 'person' },
] as const satisfies readonly { id: KbTreeSection['id']; type: EntityType }[]

/** KB-relative path of the todo singleton (ADR-0018); a singleton kind resolves whatever its name. */
const TODOS_PATH = entityDisplayPath('todo', 'todos')

/** How many mails one `mailFetch` returns (ADR-0019). */
const MAIL_LIMIT = 50

/** How old a mail watermark may be before the read is called stale (ADR-0019). */
const MAIL_STALE_DAYS = 30

/**
 * The bound a first `mailFetch` uses when there is no watermark: a fresh
 * connector must not answer by walking a decade of inbox.
 * @returns an ISO 8601 stamp `MAIL_STALE_DAYS` days ago.
 */
function defaultSince(): string {
  const then = new Date()
  then.setDate(then.getDate() - MAIL_STALE_DAYS)
  return then.toISOString()
}

/**
 * Whether a watermark leaves room for a gap: no watermark means the connector
 * has never run, and an old one means the stretch since it was taken has never
 * been read. The UI asks what to do; neither case is filled in silently.
 * @param lastReadAt - the watermark, when there is one.
 * @returns true when the UI should warn.
 */
function isStale(lastReadAt: string | undefined): boolean {
  if (lastReadAt === undefined) return true
  const then = Date.parse(lastReadAt)
  if (Number.isNaN(then)) return true
  return Date.now() - then > MAIL_STALE_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Rewrite one scalar field of a KB file's frontmatter, adding it just above
 * the closing fence when the file does not carry it yet.
 *
 * The envelope is parsed first — the file is the human's document, so an
 * unreadable one is reported rather than repaired — and the splice is a line
 * edit, never a YAML round trip: a re-emitted mapping would drop the comments
 * and the ordering the human wrote.
 * @param content - the file's complete content.
 * @param displayPath - the KB-relative path, for error prose.
 * @param key - the field to write.
 * @param value - the field's new value.
 * @returns the new content.
 */
function withFrontmatterField(content: string, displayPath: string, key: string, value: string): string {
  parseFrontmatter(content, displayPath)
  const lines = content.split('\n')
  const closing = lines.findIndex((line, at) => at > 0 && /^---[ \t\r]*$/.test(line))
  if (closing < 0) throw new KbError('malformed-frontmatter', `文件 ${displayPath} 的 frontmatter 没有闭合`)
  const field = lines.findIndex((line, at) => at > 0 && at < closing && new RegExp(`^${key}:`).test(line))
  const next = [...lines]
  if (field >= 0) next[field] = `${key}: ${value}`
  else next.splice(closing, 0, `${key}: ${value}`)
  return next.join('\n')
}

/** Read a directory's file names, answering an empty list when the directory is absent. */
async function readdirFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries.filter(entry => entry.isFile()).map(entry => entry.name)
}

/** UI-direct KB operations over the `yantaoKb` Remote namespace. */
export class YantaoKbController extends TypertRemoteService {
  /** The one KB root, provided by the mounted yantao-kb plugin. */
  static inject = ['yantaoKb']

  /** The KB's change counter (ADR-0017); pointed at the live root on each poll. */
  private readonly revisionWatch = new KbRevision()

  constructor(ctx: Context) {
    super(ctx, 'yantaoKbController', { namespace: 'yantaoKb' })
    this.ctx.effect(() => () => {
      this.revisionWatch.close()
    })
  }

  /** The one KB root, read per call so a re-chosen root takes effect at once. */
  private get kbRoot(): string {
    return this.ctx.yantaoKb.root
  }

  /** Confine one wire path to the KB root, classifying an escape as `yantao-kb/rejected`. */
  private confine(path: string, display: string): string {
    try {
      return resolveWithinKb(this.kbRoot, path)
    } catch (error) {
      if (error instanceof KbError) {
        throw new RemoteError('yantao-kb/rejected', error.message, { path: display }, { cause: error })
      }
      throw error
    }
  }

  /**
   * The intake side of the KB: resources, meetings, and the todo singleton.
   * Every section is present even when its directory is absent or empty.
   * @returns the three intake sections in display order; resource rows pair their shadow notes.
   */
  @Remote('intakeTree')
  async intakeTree(): Promise<KbTree> {
    return { sections: [await this.resourceSection(), ...await this.entitySections(INTAKE_ENTITY_SECTIONS)] }
  }

  /**
   * The workspace side of the KB: projects, areas, people.
   * @returns the three workspace sections in display order, entity rows carrying archive and relation flags.
   */
  @Remote('workspaceTree')
  async workspaceTree(): Promise<KbTree> {
    return { sections: await this.entitySections(WORKSPACE_ENTITY_SECTIONS) }
  }

  /**
   * The `resources` section: originals with their shadow-note pairing, plus a
   * note that has no original beside it — a mail analysis saves its resources
   * as `resources/<name>.md`, and a note nobody else owns is a row of its own
   * rather than a shadow nobody can see.
   *
   * Every row keeps its file name's suffix, so `周报.eml` and `周报.eml.md`
   * can never be mistaken for one another on screen.
   */
  private async resourceSection(): Promise<KbTreeSection> {
    const resourceNames = await readdirFiles(join(this.kbRoot, 'resources'))
    const resourceSet = new Set(resourceNames)
    const resources: KbTreeFile[] = []
    for (const name of resourceNames) {
      if (!name.endsWith('.md')) {
        resources.push({
          name,
          path: `resources/${name}`,
          ...resourceSet.has(`${name}.md`) ? { notePath: `resources/${name}.md` } : {},
        })
        continue
      }
      // A note with its original beside it is that original's shadow, not a row.
      if (resourceSet.has(name.slice(0, -'.md'.length))) continue
      resources.push({ name, path: `resources/${name}` })
    }
    return { id: 'resources', files: resources }
  }

  /** The entity sections of one side of the KB, listed with archived entities included. */
  private async entitySections(
    sections: readonly { readonly id: KbTreeSection['id']; readonly type: EntityType }[],
  ): Promise<KbTreeSection[]> {
    const built: KbTreeSection[] = []
    for (const { id, type } of sections) {
      const { entities } = await listEntities(this.kbRoot, type, true)
      built.push({
        id,
        files: entities.map(entity => ({
          name: entity.name,
          path: entityDisplayPath(type, entity.name),
          ...entity.archived ? { archived: true } : {},
          ...entity.relation !== undefined ? { relation: entity.relation } : {},
        })),
      })
    }
    return built
  }

  /**
   * Read one KB file's complete content.
   * @param path - KB-relative path with forward slashes.
   * @returns the path and the file's complete UTF-8 content.
   */
  @Remote('read')
  async read(path: string): Promise<KbFileContent> {
    const target = this.confine(path, path)
    try {
      return { path, content: await readFile(target, 'utf8') }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new RemoteError('yantao-kb/not-found', `找不到知识库文件：${path}`, { path }, { cause: error })
      }
      throw new RemoteError('yantao-kb/rejected', `无法读取知识库文件 ${path}：${(error as Error).message}`, { path }, { cause: error })
    }
  }

  /**
   * Both halves of one file's `[[…]]` link graph (ADR-0015): what it links out
   * to, resolved to entity files, and which files link back into it.
   *
   * The scan lives here rather than in the Client because it reads every
   * entity note — one round trip instead of one per file — and because
   * resolution is a host-side rule (`类型:名字` locators, dated meetings).
   * @param path - KB-relative path with forward slashes.
   * @returns the file's outgoing and incoming links.
   */
  @Remote('links')
  async links(path: string): Promise<KbLinksResult> {
    this.confine(path, path)
    return linksOf(this.kbRoot, path)
  }

  /**
   * The live KB root and whether the human has chosen one yet.
   * @returns the root in force and `configured` — true when a persisted root override exists.
   */
  @Remote('root')
  root(): Promise<KbRootResult> {
    return Promise.resolve({ root: this.kbRoot, configured: this.ctx.yantaoKb.configured })
  }

  /**
   * Choose the knowledge base: initialize `path` as a KB and hand it to the
   * `yantaoKb` service, which makes it the live root for every host-side
   * consumer and persists it as the root override.
   * @param path - absolute path of the knowledge-base root directory.
   * @returns the root now in force plus what the initialization created or found.
   */
  @Remote('setRoot')
  async setRoot(path: string): Promise<KbSetRootResult> {
    const target = path.trim()
    if (target === '' || !isAbsolute(target)) {
      throw new RemoteError('yantao-kb/rejected', `知识库根目录必须是绝对路径：${path}`, { path })
    }
    try {
      const { kbRoot, created, existing } = await initKb(target)
      this.ctx.yantaoKb.setRoot(kbRoot)
      return { root: kbRoot, configured: true, created, existing }
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法把 ${target} 初始化为知识库：${(error as Error).message}`,
        { path: target },
        { cause: error },
      )
    }
  }

  /**
   * Create one entity note from the canonical template.
   * @param args - the entity kind, its display name, the meeting's own date,
   *   and the person's relation to the KB's owner.
   * @returns the KB-relative path of the created file.
   */
  @Remote('createEntity')
  async createEntity(args: KbCreateEntityArgs): Promise<KbCreateEntityResult> {
    const display = entityDisplayPath(args.type, args.name)
    try {
      return await createEntity(this.kbRoot, args.type, args.name, {
        meetingDate: args.date ?? todayStamp(),
        ...args.relation !== undefined ? { relation: args.relation } : {},
      })
    } catch (error) {
      const message = error instanceof KbError
        ? error.message
        : `无法创建实体「${args.name}」：${(error as Error).message}`
      throw new RemoteError('yantao-kb/rejected', message, { path: display }, { cause: error })
    }
  }

  /**
   * Write one KB file's complete content (the human channel's full-file
   * write; missing parent directories are created). The file is not
   * validated — the human owns its structure, and the agent's tools
   * re-validate on their next read.
   * @param path - KB-relative path with forward slashes.
   * @param content - the complete new UTF-8 content.
   * @returns the written path.
   */
  @Remote('write')
  async write(path: string, content: string): Promise<KbWriteResult> {
    const target = this.confine(path, path)
    try {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
      return { path }
    } catch (error) {
      throw new RemoteError('yantao-kb/rejected', `无法写入知识库文件 ${path}：${(error as Error).message}`, { path }, { cause: error })
    }
  }

  /**
   * Rewrite one person entity's `relation` — the workbench's right-click
   * 「关系」 on a 人物 row.
   *
   * Only a person carries the field, so anything else is refused rather than
   * silently given one: the relation is how the KB knows who somebody is to
   * its owner, and a project with a `relation:` line is a mistake a later
   * reader would have to guess about. The value is checked against the
   * domain's five, and the write is a line splice inside the frontmatter —
   * the rest of the document, human-written, is left byte-identical.
   * @param args - the entity's path and the relation to write.
   * @returns the path and the relation it now carries.
   */
  @Remote('setRelation')
  async setRelation(args: KbSetRelationArgs): Promise<KbSetRelationResult> {
    const target = this.confine(args.path, args.path)
    if (!(PERSON_RELATIONS as readonly string[]).includes(args.relation)) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法识别的人物关系「${args.relation}」；可用关系：${PERSON_RELATIONS.join(' / ')}`,
        { path: args.path },
      )
    }
    let content: string
    try {
      content = await readFile(target, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new RemoteError('yantao-kb/not-found', `找不到知识库文件：${args.path}`, { path: args.path }, { cause: error })
      }
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法读取知识库文件 ${args.path}：${(error as Error).message}`,
        { path: args.path },
        { cause: error },
      )
    }
    let patched: string
    try {
      const { data } = parseFrontmatter(content, args.path)
      if (data.type !== 'person') {
        throw new KbError('not-a-person', `只有人物实体才有关系：${args.path}`)
      }
      patched = withFrontmatterField(content, args.path, 'relation', args.relation)
    } catch (error) {
      const message = error instanceof KbError
        ? error.message
        : `无法改写 ${args.path} 的关系：${(error as Error).message}`
      throw new RemoteError('yantao-kb/rejected', message, { path: args.path }, { cause: error })
    }
    try {
      await writeFile(target, patched, 'utf8')
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法写入知识库文件 ${args.path}：${(error as Error).message}`,
        { path: args.path },
        { cause: error },
      )
    }
    return { path: args.path, relation: args.relation }
  }

  /**
   * Delete one KB file — the workbench's right-click 「删除」 on an entity row.
   *
   * The human channel owns the KB's files, so this is a real unlink and not an
   * archive: a row the human created and no longer wants is gone. The path is
   * confined like every other one, and a missing file is
   * `yantao-kb/not-found` rather than a silent success, so the UI can tell
   * "already deleted" from "deleted just now".
   * @param path - KB-relative path with forward slashes.
   * @returns the deleted path.
   */
  @Remote('deleteFile')
  async deleteFile(path: string): Promise<KbDeleteFileResult> {
    const target = this.confine(path, path)
    try {
      await unlink(target)
      return { path }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new RemoteError('yantao-kb/not-found', `找不到知识库文件：${path}`, { path }, { cause: error })
      }
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法删除知识库文件 ${path}：${(error as Error).message}`,
        { path },
        { cause: error },
      )
    }
  }

  /**
   * Refuse the mail connector while no KB root has been chosen (ADR-0019): the
   * cursor is persisted next to the root, so with no root there is nowhere to
   * keep it — and a mail analysis writes into that KB.
   * @throws a `yantao-kb/mail` error when `~/.dsh/yantao-kb.json` holds no root.
   */
  private requireKbRootState(): void {
    if (readKbRootOverride() === undefined) {
      throw new RemoteError(
        'yantao-kb/mail',
        '还没有选择知识库目录，邮件的读取断点无处记录。',
        { kind: 'no-root', hint: '先选择一次知识库目录，再来读邮件。' },
      )
    }
  }

  /**
   * The todo singleton's current text. A missing file reads as empty: a fresh
   * KB, or one whose `todos.md` was deleted, still renders an empty board
   * instead of failing the panel.
   * @param path - the singleton's KB-relative path.
   * @param target - the confined absolute path to read.
   * @returns the file's content, or `''` when there is no file.
   */
  private async readTodosText(path: string, target: string): Promise<string> {
    try {
      return await readFile(target, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法读取待办清单 ${path}：${(error as Error).message}`,
        { path },
        { cause: error },
      )
    }
  }

  /**
   * The structured todo board (ADR-0018): the `entities/todos.md` singleton
   * parsed into items, plus the file's exact text — the UI echoes that text
   * back as `writeTodos`'s `expectedText`, which is what makes the board's
   * optimistic concurrency work. The parse lives here because the Client
   * cannot import the kb package's values (bundle purity).
   * @returns the singleton's path, its exact current text, and its items in file order.
   */
  @Remote('todos')
  async todos(): Promise<KbTodosResult> {
    const path = TODOS_PATH
    const target = this.confine(path, path)
    const text = await this.readTodosText(path, target)
    return { path, text, items: parseTodoFile(text).items }
  }

  /**
   * Write the whole todo list back (ADR-0018), replacing the file's items but
   * keeping its preamble: a heading the human wrote above the checklist is
   * theirs, and the UI sends items only.
   *
   * `expectedText` is the optimistic-concurrency check — the same pre-save
   * comparison the editor's autosave uses (ADR-0012), not a second model: a
   * stale value means somebody else (Obsidian, an agent, another tab) got
   * there first, and the UI refreshes rather than clobbering.
   * @param args - the new item list and the text the caller last read.
   * @returns the singleton's path and what is on disk now.
   */
  @Remote('writeTodos')
  async writeTodos(args: KbWriteTodosArgs): Promise<KbWriteTodosResult> {
    const path = TODOS_PATH
    const target = this.confine(path, path)
    const current = await this.readTodosText(path, target)
    if (current !== args.expectedText) {
      throw new RemoteError('yantao-kb/rejected', '待办清单已被别处修改，请刷新后重试', { path })
    }
    const { preamble } = parseTodoFile(current)
    let text: string
    try {
      text = serializeTodoFile({ preamble, items: args.items })
    } catch (error) {
      const message = error instanceof KbError
        ? error.message
        : `无法写入待办清单：${(error as Error).message}`
      throw new RemoteError('yantao-kb/rejected', message, { path }, { cause: error })
    }
    try {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, text, 'utf8')
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法写入知识库文件 ${path}：${(error as Error).message}`,
        { path },
        { cause: error },
      )
    }
    return { path, text }
  }

  /**
   * The KB's change counter (ADR-0017). The UI compares it across polls to learn
   * that something changed **outside** the workbench — an edit in Obsidian, a
   * `git checkout`, an agent write. An edit made inside the workbench does not
   * move it, because the UI already knows about those.
   *
   * The watcher is (re-)pointed at the live root on every call: the root is
   * mutable through `setRoot`, and a watcher left behind would watch a
   * directory nobody edits any more.
   * @returns the root being watched and the counter's current value.
   */
  @Remote('revision')
  revision(): Promise<KbRevisionResult> {
    const root = this.kbRoot
    this.revisionWatch.follow(root)
    return Promise.resolve({ root, revision: this.revisionWatch.revision })
  }

  /**
   * Hand one target to the desktop's own handler (ADR-0017) — the whole
   * "borrow Obsidian" bridge.
   *
   * `target` is either a KB-relative path (opened with whatever the desktop
   * associates with `.md`) or a URI of an allowlisted scheme, which is how the
   * UI asks for `obsidian://open?path=…`. Anything else is refused: an
   * open-ended "run this string on the host" would be a shell, not a bridge,
   * and the trust boundary is the whole point of this project.
   * @param target - a KB-relative path, or a URI (see `open.ts`).
   * @returns the target that was opened.
   */
  @Remote('openExternal')
  openExternal(target: string): Promise<KbOpenExternalResult> {
    // Every failure leaves as a rejected promise, never a synchronous throw:
    // the caller awaits this, and `confine` itself throws. Not `async`, so the
    // rule that wants an `await` in every async body does not apply.
    try {
      const trimmed = target.trim()
      if (!isOpenable(trimmed)) {
        throw new RemoteError(
          'yantao-kb/rejected',
          `不能在外部打开这个目标（只允许知识库内的路径，或 obsidian:/vscode:/http(s):/mailto: 开头的地址）：${trimmed}`,
          { path: trimmed },
        )
      }
      const resolved = hasScheme(trimmed) ? trimmed : this.confine(trimmed, trimmed)
      openWithDesktop(resolved)
      return Promise.resolve({ target: trimmed })
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Read the newest mails in the window `[since, until)` (ADR-0019).
   *
   * The lower bound defaults to that watermark, and to 30 days ago when there
   * is none — a first run must not walk a whole inbox over COM. `until` is the
   * upper bound the panel uses to page 往前: without it a read always lands on
   * the newest mails, so going back in time would be impossible. The read only
   * ever says whether it filled its page (`hasMore`), never how many mails are
   * left: an exact total would mean touching every item in the folder.
   *
   * Every failure leaves as a `yantao-kb/mail` error carrying the script's own
   * message *and* its remedy, because the useful answer to "Outlook is not
   * answering" is what to install, not that the fetch failed.
   * @param args - an explicit `since` and `until` (to re-read an older
   *   stretch), and a cap.
   * @returns the bounds used, the watermark before the read, whether a gap may
   *   have opened, the mails, and whether more are waiting.
   */
  @Remote('mailFetch')
  async mailFetch(args: KbMailFetchArgs): Promise<KbMailFetchResult> {
    this.requireKbRootState()
    const lastReadAt = readMailWatermark()
    const since = args.since ?? lastReadAt ?? defaultSince()
    const until = args.until
    const limit = args.limit ?? MAIL_LIMIT
    let messages
    try {
      messages = await fetchMail({ since, until, limit })
    } catch (error: unknown) {
      const failure = error instanceof MailFetchError ? error : undefined
      throw new RemoteError(
        'yantao-kb/mail',
        failure?.message ?? '读取 Outlook 邮件失败。',
        { kind: failure?.kind ?? 'other', hint: failure?.hint ?? '请查看服务端日志了解详情。' },
        { cause: error },
      )
    }
    return {
      since,
      ...until !== undefined ? { until } : {},
      ...lastReadAt !== undefined ? { lastReadAt } : {},
      stale: isStale(lastReadAt),
      messages,
      hasMore: messages.length >= limit,
    }
  }

  /**
   * Move the mail connector's watermark (ADR-0019): everything at or before
   * `lastReadAt` has been seen, so the next `mailFetch` starts after it.
   *
   * The cursor lives in `~/.dsh`, next to the KB root it was read for, and
   * never in the KB itself — that is markdown for humans.
   * @param args - the stamp to store; defaults to now.
   * @returns the watermark as it now stands.
   */
  @Remote('mailMarkRead')
  async mailMarkRead(args: KbMailMarkReadArgs): Promise<KbMailMarkReadResult> {
    this.requireKbRootState()
    const lastReadAt = args.lastReadAt ?? new Date().toISOString()
    await writeMailWatermark(lastReadAt)
    return { lastReadAt }
  }
}

export default YantaoKbController
