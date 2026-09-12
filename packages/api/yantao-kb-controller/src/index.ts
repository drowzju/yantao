/**
 * The yantaoKb Remote controller: the workbench UI's direct KB channel.
 * `intakeTree` shapes the input side (resources, meetings, todos) and
 * `workspaceTree` the workspace side (projects, areas, people);
 * `read`/`write` address single files by KB-relative path, always confined
 * one configuration point, no duplicated config. `root`/`setRoot` answer and
 * choose that root — the service persists the choice under `~/.dsh` — and `createEntity`
 * files a new note from the KB's canonical template; `registerResource` is the
 * reading-project intake (ADR-0020): a dropped file is copied into `resources/`.
 * The capability surface (ADR-0021) is `capabilityList`/`capabilityRun`/
 * `capabilityRegisterDir`/`capabilityCreate`: a capability is a dsh skill
 * directory declaring a host entry, and this controller seeds the shipped
 * ones, lists them, runs them, writes their artifacts, and persists their
 * state. The UI is the human
 * channel, so `write` is a full-file write; the ADR-0004 trust boundary
 * binds only the agent's kb_ tools, never this surface.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller
 */

import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  createEntity, entityDisplayPath, initKb, KbError, linksOf, listEntities, parseFrontmatter,
  parseTodoFile, PERSON_RELATIONS, readCapabilityDirs, readCapabilityRecord, readCapabilityState,
  readKbRootOverride, registerResourceContent, resolveWithinKb, serializeTodoFile, todayStamp,
  writeCapabilityDir, writeCapabilityState, writeMailWatermark,
} from '@deepseek-ai/dsh-yantao-kb'
import type { EntityType } from '@deepseek-ai/dsh-yantao-kb'
import { ensureBuiltinCapabilities } from './capability/builtin.ts'
import { CAPABILITY_HINTS, CapabilityError, manifestOf, resolveEntry, runCapability } from './capability/run.ts'
import type { CapabilityManifest } from './capability/run.ts'
import { hasScheme, isOpenable, openWithDesktop } from './open.ts'
import { KbRevision } from './watch.ts'
import type {
  KbCreateEntityArgs,
  KbCreateEntityResult,
  KbCapabilityCreateArgs,
  KbCapabilityCreateResult,
  KbCapabilityListResult,
  KbCapabilityRegisterDirResult,
  KbCapabilityRunArgs,
  KbCapabilityRunResult,
  KbCapabilitySummary,
  KbDeleteFileResult,
  KbFileContent,
  KbLinksResult,
  KbMailMarkReadArgs,
  KbMailMarkReadResult,
  KbOpenExternalResult,
  KbRegisterResourceArgs,
  KbRegisterResourceResult,
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
    /** The file is binary, so there is no text preview to read (ADR-0020). */
    'yantao-kb/binary': { readonly path: string }
    /** The mail connector failed (ADR-0019); `kind` is one of its failure kinds. */
    'yantao-kb/mail': { readonly kind: string; readonly hint: string }
    /** A capability run failed (ADR-0021); `kind` is one of its failure kinds. */
    'yantao-kb/capability': { readonly kind: string; readonly hint: string }
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
  /** The one KB root, provided by the mounted yantao-kb plugin; `skills` resolves capability directories (ADR-0021). */
  static inject = ['yantaoKb', 'skills']

  /** The KB's change counter (ADR-0017); pointed at the live root on each poll. */
  private readonly revisionWatch = new KbRevision()

  /** Disposer of the one provider over the human-added capability directories (ADR-0021 决定 8). */
  private capabilityDirsDispose: (() => void) | undefined

  constructor(ctx: Context) {
    super(ctx, 'yantaoKbController', { namespace: 'yantaoKb' })
    this.ctx.effect(() => () => {
      this.revisionWatch.close()
    })
    const dirs = readCapabilityDirs()
    if (dirs.length > 0) this.registerCapabilityDirs(dirs)
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
   * @returns the three intake sections in display order; a resource row pairs its companion note when one exists.
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
   * The `resources` section: originals listed as plain files, plus the
   * mail-analysis notes saved as `resources/<name>.md` — a note whose
   * original sits beside it pairs with that original (its `notePath`)
   * instead of being a row of its own.
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
   *
   * A resource original is often binary (pdf/epub/…). Decoding it as UTF-8
   * yields a mojibake string the size of the file, which the RPC channel then
   * serializes and the workbench renders — the freeze behind left-clicking a
   * pdf row. A NUL byte is the cheapest reliable marker: every format the
   * extractor (ADR-0020) calls binary carries one, while no note does. A
   * binary file is refused instead; its text route is the extract.
   * @param path - KB-relative path with forward slashes.
   * @returns the path and the file's complete UTF-8 content.
   */
  @Remote('read')
  async read(path: string): Promise<KbFileContent> {
    const target = this.confine(path, path)
    let bytes: Buffer
    try {
      bytes = await readFile(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new RemoteError('yantao-kb/not-found', `找不到知识库文件：${path}`, { path }, { cause: error })
      }
      throw new RemoteError('yantao-kb/rejected', `无法读取知识库文件 ${path}：${(error as Error).message}`, { path }, { cause: error })
    }
    if (bytes.includes(0)) {
      throw new RemoteError(
        'yantao-kb/binary',
        `「${path}」是二进制文件，工作台不直接预览原文；可用右键「创建读书项目」提取文本。`,
        { path },
      )
    }
    return { path, content: bytes.toString('utf8') }
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
   *   the person's relation to the KB's owner, and — for a reading project —
   *   the resource it reads (ADR-0020), written into the frontmatter as `source:`.
   * @returns the KB-relative path of the created file.
   */
  @Remote('createEntity')
  async createEntity(args: KbCreateEntityArgs): Promise<KbCreateEntityResult> {
    const display = entityDisplayPath(args.type, args.name)
    try {
      return await createEntity(this.kbRoot, args.type, args.name, {
        meetingDate: args.date ?? todayStamp(),
        ...args.relation !== undefined ? { relation: args.relation } : {},
        ...args.source !== undefined ? { source: args.source } : {},
      })
    } catch (error) {
      const message = error instanceof KbError
        ? error.message
        : `无法创建实体「${args.name}」：${(error as Error).message}`
      throw new RemoteError('yantao-kb/rejected', message, { path: display }, { cause: error })
    }
  }

  /**
   * Copy one dropped file into `resources/` (ADR-0020) — the drag-and-drop
   * intake. The browser cannot hand over a filesystem path, so the content
   * arrives base64-encoded and is decoded here; the copy is pure (no shadow
   * note), and an existing resource is refused rather than overwritten.
   * @param args - the file's name and its base64-encoded content.
   * @returns the KB-relative path of the copied resource.
   */
  @Remote('registerResource')
  async registerResource(args: KbRegisterResourceArgs): Promise<KbRegisterResourceResult> {
    const content = Buffer.from(args.contentBase64, 'base64')
    try {
      return await registerResourceContent(this.kbRoot, args.name, content)
    } catch (error) {
      const message = error instanceof KbError
        ? error.message
        : `无法登记资源「${args.name}」：${(error as Error).message}`
      throw new RemoteError(
        'yantao-kb/rejected',
        message,
        { path: `resources/${args.name}` },
        { cause: error },
      )
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
   * (Re-)register the single provider over the human-added capability
   * directories (ADR-0021 决定 8). The directories live in
   * `~/.dsh/yantao-kb.json` — there is no runtime write channel into the
   * skill-filesystem config — so this controller owns one
   * `FileSystemSkillProvider` instance and disposes + re-registers it when
   * the list changes; a second provider with the same name would throw.
   * @param dirs - the absolute directories to expose as skill roots.
   */
  private registerCapabilityDirs(dirs: readonly string[]): void {
    this.capabilityDirsDispose?.()
    this.capabilityDirsDispose = undefined
    if (dirs.length === 0) return
    this.capabilityDirsDispose = this.ctx.skills.registerProvider(
      control => new FileSystemSkillProvider(this.ctx, control, {
        providerName: 'yantao-capability-dirs',
        includeDefaultRoots: false,
        customSkillDirs: [...dirs],
      }),
    )
  }

  /**
   * Wait out the skill-filesystem watcher's invalidation lag: writing a new
   * skill directory queues an asynchronous cache invalidation, so a `list`
   * issued immediately after may not see it yet. Bounded — the names are
   * usually visible on the first probe, and the caller's own error handling
   * covers the pathological case.
   * @param names - skill names that must be visible before proceeding.
   */
  private async settleSkills(names: readonly string[]): Promise<void> {
    if (names.length === 0) return
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const summaries = await this.ctx.skills.list({ cwd: this.kbRoot })
      const known = new Set(summaries.map(summary => summary.name))
      if (names.every(name => known.has(name))) return
      await new Promise(resolve => setTimeout(resolve, 200))
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

  /**
   * Run one capability's host entry (ADR-0021) — the human channel's execution
   * seam, the mail connector's and the extractor's subprocess pattern
   * generalized. The capability is resolved through `ctx.skills` (the
   * skill-filesystem provider discovers the directories; this controller only
   * consumes the winner), its `metadata.yantao` declaration picks the entry
   * script, and the run is one Python subprocess with a JSON stdin/stdout
   * contract (`capability/run.ts`).
   *
   * The controller, not the script, owns every write: artifacts land under
   * `.yantao/capabilities/<name>/` at paths the script cannot choose, and the
   * returned state is persisted under `capabilities.<name>.state` in
   * `~/.dsh/yantao-kb.json` — metadata outside the KB, which stays markdown
   * for humans. Execution exists only here, before a session: the agent gets
   * no `kb_run_capability` tool (ADR-0021 取舍台账第 2 条).
   * @param args - the capability's skill name and the caller's input, handed
   *   to the entry script verbatim.
   * @returns what the run answered, when it ran, and which artifact paths were written.
   */
  @Remote('capabilityRun')
  async capabilityRun(args: KbCapabilityRunArgs): Promise<KbCapabilityRunResult> {
    if (readKbRootOverride() === undefined) {
      throw new RemoteError(
        'yantao-kb/capability',
        '还没有选择知识库目录，能力的状态无处记录。',
        { kind: 'no-root', hint: '先选择一次知识库目录，再运行能力。' },
      )
    }
    // Seed the shipped capabilities before resolving: a first run on a fresh
    // KB would otherwise answer "not found" for a capability that is about to
    // be copied in.
    await this.settleSkills(ensureBuiltinCapabilities(this.kbRoot))
    const name = args.name
    const definition = await this.ctx.skills.get(name, { cwd: this.kbRoot })
    if (definition === undefined) {
      throw new RemoteError(
        'yantao-kb/capability',
        `找不到能力「${name}」。`,
        { kind: 'not-found', hint: CAPABILITY_HINTS['not-found'] },
      )
    }
    let directory: string
    let entryPath: string
    try {
      const resolved = resolveEntry(definition)
      directory = resolved.directory
      entryPath = resolved.entryPath
    } catch (error: unknown) {
      const failure = error instanceof CapabilityError ? error : undefined
      throw new RemoteError(
        'yantao-kb/capability',
        failure?.message ?? '能力声明无效。',
        { kind: failure?.kind ?? 'bad-manifest', hint: failure?.hint ?? CAPABILITY_HINTS['bad-manifest'] },
        { cause: error },
      )
    }
    const kbRoot = this.kbRoot
    let output
    try {
      output = await runCapability({
        name,
        directory,
        entryPath,
        kbRoot,
        input: args.input,
        state: readCapabilityState(name),
      })
    } catch (error: unknown) {
      const failure = error instanceof CapabilityError ? error : undefined
      throw new RemoteError(
        'yantao-kb/capability',
        failure?.message ?? '能力执行失败。',
        { kind: failure?.kind ?? 'other', hint: failure?.hint ?? CAPABILITY_HINTS.other },
        { cause: error },
      )
    }
    const written: string[] = []
    try {
      for (const artifact of output.artifacts ?? []) {
        const dir = join(kbRoot, '.yantao', 'capabilities', name)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, artifact.name), Buffer.from(artifact.contentBase64, 'base64'))
        written.push(`.yantao/capabilities/${name}/${artifact.name}`)
      }
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/capability',
        `无法写入能力的产物文件：${(error as Error).message}`,
        { kind: 'other', hint: CAPABILITY_HINTS.other },
        { cause: error },
      )
    }
    if (output.state !== undefined) await writeCapabilityState(name, output.state)
    return {
      name,
      runAt: new Date().toISOString(),
      ...output.result !== undefined ? { result: output.result as JsonValue } : {},
      artifacts: written,
    }
  }

  /**
   * List the capabilities the workbench's 能力 tab shows (ADR-0021 决定 8):
   * every skill `ctx.skills` discovers at the KB root that declares a
   * `metadata.yantao` entry — plain skills without one are not capabilities
   * and are skipped, not errors. Shipped capabilities are seeded first, so a
   * fresh KB answers with 邮件 and 读书 on its very first open.
   *
   * Each row merges the skill's declaration with the persisted record
   * (`capabilities.<name>` in `~/.dsh/yantao-kb.json`): when it last ran and
   * the state that run left behind, so the panel can show a real 断点 without
   * running anything.
   * @returns the capability summaries, in discovery order.
   */
  @Remote('capabilityList')
  async capabilityList(): Promise<KbCapabilityListResult> {
    const kbRoot = this.kbRoot
    await this.settleSkills(ensureBuiltinCapabilities(kbRoot))
    const summaries = await this.ctx.skills.list({ cwd: kbRoot })
    const capabilities: KbCapabilitySummary[] = []
    for (const summary of summaries) {
      let definition: SkillDefinition | undefined
      try {
        definition = await this.ctx.skills.get(summary.name, { cwd: kbRoot })
      } catch {
        definition = undefined
      }
      if (definition === undefined) continue
      let manifest: CapabilityManifest
      try {
        manifest = manifestOf(definition)
      } catch {
        // A skill without a (valid) yantao declaration is a skill, not a capability.
        continue
      }
      const record = readCapabilityRecord(summary.name)
      capabilities.push({
        name: summary.name,
        description: summary.description,
        source: summary.source,
        ...summary.resourceBase?.kind === 'directory' ? { directory: summary.resourceBase.path } : {},
        entry: manifest.entry,
        runtime: manifest.runtime,
        ...manifest.appliesTo !== undefined ? { appliesTo: manifest.appliesTo } : {},
        ...record?.lastRunAt !== undefined ? { lastRunAt: record.lastRunAt } : {},
        ...record?.state !== undefined ? { state: record.state as JsonValue } : {},
      })
    }
    return { capabilities }
  }

  /**
   * Add one directory to the capability search path (ADR-0021 决定 8's
   * 「添加目录」): the human points the workbench at a folder of capability
   * directories they manage outside the KB, and from then on `ctx.skills`
   * discovers them like any other root.
   *
   * The list persists in `~/.dsh/yantao-kb.json` (`capabilityDirs`) and this
   * controller re-registers its single provider over it — see
   * `registerCapabilityDirs` for why there is exactly one.
   * @param path - absolute path of the directory to add.
   * @returns the full list of registered directories as it now stands.
   */
  @Remote('capabilityRegisterDir')
  async capabilityRegisterDir(path: string): Promise<KbCapabilityRegisterDirResult> {
    const target = path.trim()
    if (target === '' || !isAbsolute(target)) {
      throw new RemoteError('yantao-kb/rejected', `能力目录必须是绝对路径：${path}`, { path })
    }
    let info
    try {
      info = await stat(target)
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `目录不存在或无法访问：${target}`,
        { path: target },
        { cause: error },
      )
    }
    if (!info.isDirectory()) {
      throw new RemoteError('yantao-kb/rejected', `能力目录必须是一个目录：${target}`, { path: target })
    }
    const dirs = await writeCapabilityDir(target)
    this.registerCapabilityDirs(dirs)
    return { directories: [...dirs] }
  }

  /**
   * Scaffold a new capability directory (ADR-0021 决定 8's 「新建能力」):
   * `<kbRoot>/.dsh/skills/<name>/` with a SKILL.md frontmatter that already
   * declares the host entry, and an entry script that speaks the run protocol
   * and echoes its input — a working capability on the first run, for the
   * human to grow into theirs.
   * @param args - the capability's name (kebab-case; it becomes the skill name).
   * @returns the KB-relative path of the scaffolded directory.
   */
  @Remote('capabilityCreate')
  async capabilityCreate(args: KbCapabilityCreateArgs): Promise<KbCapabilityCreateResult> {
    const name = args.name.trim()
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `能力名只能用小写字母、数字和连字符，且以字母开头：${args.name}`,
        { path: args.name },
      )
    }
    const directory = join(this.kbRoot, '.dsh', 'skills', name)
    const exists = await stat(directory).then(() => true, () => false)
    if (exists) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `能力目录已存在：.dsh/skills/${name}`,
        { path: name },
      )
    }
    const skillMd = [
      '---',
      `name: ${name}`,
      'description: （一句话说明这个能力做什么。）',
      'disable-model-invocation: true',
      'metadata:',
      '  yantao:',
      '    entry: scripts/entry.py',
      '    runtime: python',
      '    version: 1',
      '---',
      '',
      `# ${name}`,
      '',
      '（这里写给人类看：这个能力做什么、怎么用、有什么前提。）',
      '',
      '## 执行契约',
      '',
      '入口是 `scripts/entry.py`，由工作台以子进程调用：stdin 收一个 JSON 对象',
      '`{name, kbRoot, input, state}`，stdout 回一个 JSON 对象。',
      '',
      '- 成功：`{ok: true, result: …}`，可选带 `state`（持久化到下次运行）和',
      '  `artifacts`（`[{"name": "文件名", "contentBase64": "…"}]`，由工作台落盘到',
      '  `.yantao/capabilities/<name>/`）。',
      '- 失败：`{ok: false, kind, message, hint}`。',
      '',
    ].join('\n')
    const entryPy = [
      `"""${name} 的入口脚本（ADR-0021 能力协议）。"""`,
      'import json',
      'import sys',
      '',
      '',
      'def run(name, kb_root, caller_input, state):',
      '    """一次能力执行，返回协议 JSON 对象。',
      '',
      '    - caller_input：调用方传入的 input（可能为 None）。',
      '    - state：上次运行持久化的状态（可能为 None），只读；要更新就随',
      '      输出带回一个 "state" 字段。',
      '    """',
      '    return {"ok": True, "result": {"input": caller_input}}',
      '',
      '',
      'def main():',
      '    payload = json.load(sys.stdin)',
      '    output = run(payload["name"], payload["kbRoot"], payload.get("input"), payload.get("state"))',
      '    json.dump(output, sys.stdout, ensure_ascii=False)',
      '',
      '',
      'if __name__ == "__main__":',
      '    main()',
      '',
    ].join('\n')
    try {
      await mkdir(join(directory, 'scripts'), { recursive: true })
      await writeFile(join(directory, 'SKILL.md'), skillMd, 'utf8')
      await writeFile(join(directory, 'scripts', 'entry.py'), entryPy, 'utf8')
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法创建能力目录：${(error as Error).message}`,
        { path: name },
        { cause: error },
      )
    }
    await this.settleSkills([name])
    return { path: `.dsh/skills/${name}` }
  }
}

export default YantaoKbController
