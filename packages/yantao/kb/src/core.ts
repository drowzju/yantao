/**
 * The KB operations behind the kb_ tool family. Each takes the resolved
 * kbRoot explicitly and is transport-free, so tests drive them directly.
 * Writes are confined to kbRoot and follow the trust boundary: entity files
 * are created from the canonical template once, and afterwards the agent may
 * rewrite any `## ` section except `## 流水` (append-only) and never the
 * frontmatter; resources/ accepts creation only, never overwrite.
 * @module @deepseek-ai/dsh-yantao-kb/core
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parseFrontmatter } from './frontmatter.ts'
import { entityFilePath, resolveEntityLocator, resolveWithinKb, sanitizeFileName, todayStamp } from './paths.ts'
import { appendToLogSection, logBullet, replaceSection, replaceStateSection } from './splice.ts'
import type { EntityTemplateOptions } from './templates.ts'
import { assembleEntityFile, builtinEntityBody, entityFrontmatter, KB_README, templateBodyOf, todoFileContent } from './templates.ts'
import type { EntityType } from './types.ts'
import { ENTITY_DIRS, ENTITY_TYPES, KbError, SINGLETON_FILES } from './types.ts'
import { MAX_DIR_ENTRIES } from './mentions.ts'

/** KB-relative path with forward slashes, for model- and human-facing output. */
function displayPath(kbRoot: string, absolute: string): string {
  return relative(kbRoot, absolute).split(sep).join('/')
}

async function readEntityFile(kbRoot: string, absolute: string): Promise<{ content: string; display: string }> {
  const display = displayPath(kbRoot, absolute)
  let content: string
  try {
    content = await readFile(absolute, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KbError('entity-not-found', `找不到实体文件 ${display}；可用 kb_list_entities 查看现有实体`)
    }
    throw error
  }
  return { content, display }
}

/** Outcome of {@link initKb}: what the run created versus what was already there. */
export interface InitKbResult {
  kbRoot: string
  created: string[]
  existing: string[]
  /** Present when the owner entity fell back from a broken custom template to the built-in one. */
  notice?: string
}

/**
 * Create the KB layout (idempotent): the directory tree, the root README
 * (only when absent), the owner entity `entities/people/我自己.md`
 * (only when no person carries `relation: self`), and the todo singleton
 * `entities/todos.md` (only when absent).
 * @param kbRoot - the knowledge-base root directory to initialize.
 * @returns the resolved root with the paths this run created versus those already present.
 */
export async function initKb(kbRoot: string): Promise<InitKbResult> {
  const root = resolveWithinKb(kbRoot)
  const created: string[] = []
  const existing: string[] = []
  let notice: string | undefined
  const directories = [
    '',
    'resources',
    'entities',
    join('entities', 'projects'),
    join('entities', 'areas'),
    join('entities', 'people'),
    join('entities', 'meetings'),
    'sessions',
  ]
  for (const dir of directories) {
    const absolute = join(root, dir)
    const had = existsSync(absolute)
    await mkdir(absolute, { recursive: true })
    ;(had ? existing : created).push(dir === '' ? '.' : dir.split(sep).join('/'))
  }
  const readmePath = join(root, 'README.md')
  if (existsSync(readmePath)) {
    existing.push('README.md')
  } else {
    await writeFile(readmePath, KB_README, 'utf8')
    created.push('README.md')
  }
  // The owner entity exists iff any person file declares `relation: self`.
  const peopleDir = join(root, 'entities', 'people')
  let hasSelf = false
  for (const file of await readdir(peopleDir)) {
    if (!file.endsWith('.md')) continue
    try {
      const { data } = parseFrontmatter(await readFile(join(peopleDir, file), 'utf8'), `entities/people/${file}`)
      if (data.relation === 'self') {
        hasSelf = true
        break
      }
    } catch (error) {
      if (error instanceof KbError) continue
      throw error
    }
  }
  if (hasSelf) {
    existing.push('entities/people/我自己.md')
  } else {
    const selfPath = join(peopleDir, '我自己.md')
    const built = buildEntityFile(root, 'person', '我自己', todayStamp(), { relation: 'self' })
    await writeFile(selfPath, built.content, 'utf8')
    created.push('entities/people/我自己.md')
    notice = built.notice
  }
  const todoPath = join(root, 'entities', 'todos.md')
  if (existsSync(todoPath)) {
    existing.push('entities/todos.md')
  } else {
    await writeFile(todoPath, todoFileContent(todayStamp()), 'utf8')
    created.push('entities/todos.md')
  }
  return { kbRoot: root, created, existing, ...(notice !== undefined ? { notice } : {}) }
}

/**
 * Assemble one entity file's content: code-generated frontmatter, the body
 * skeleton from the user's template file when one exists (the built-in
 * skeleton otherwise), and the mechanically guaranteed `## 流水` section
 * (ADR-0026 决定 1). 状态 is the template's call — whatever sections its body
 * carries are what the entity gets; 流水 is the mechanism's — a body without
 * one gets the section appended at the end. A template whose `## 流水` anchor
 * repeats cannot be located uniquely by the splicer, so the built-in skeleton
 * replaces it and the notice says so.
 * @param root - the resolved knowledge-base root.
 * @param type - the entity kind (never a singleton — callers refuse those first).
 * @param name - the entity display name.
 * @param date - the creation date stamp.
 * @param options - kind-specific frontmatter knobs.
 * @returns the file content plus a user-facing notice when the template fell back.
 */
function buildEntityFile(
  root: string,
  type: EntityType,
  name: string,
  date: string,
  options: EntityTemplateOptions = {},
): { content: string; notice: string | undefined } {
  const frontmatter = entityFrontmatter(type, name, date, options)
  const templatePath = join(root, '.dsh', 'yantao', 'templates', `${type}.md`)
  let body = builtinEntityBody(type)
  let notice: string | undefined
  if (existsSync(templatePath)) {
    let text: string
    try {
      text = readFileSync(templatePath, 'utf8')
    } catch (error) {
      text = ''
      notice = `自定义模板 .dsh/yantao/templates/${type}.md 无法读取（${(error as Error).message}），已回落内置模板`
    }
    if (notice === undefined) {
      const parsed = templateBodyOf(text)
      if (parsed.kind === 'duplicate-log') {
        notice = `自定义模板 .dsh/yantao/templates/${type}.md 含多个『## 流水』区段，锚点无法唯一定位，已回落内置模板`
      } else {
        body = parsed.body
      }
    }
  }
  return { content: assembleEntityFile(frontmatter, body, date, name), notice }
}

/** Create one entity file from the canonical template, refusing to overwrite.
 * @param kbRoot - the knowledge-base root the entity lives under.
 * @param type - the entity kind; singleton kinds (`todo`) are refused — `kb_init` owns them.
 * @param name - the entity display name (sanitized before it becomes the file name); a meeting's
 *   file name is prefixed with its own date, `<YYYY-MM-DD> <name>`, while the frontmatter keeps
 *   `title: <name>`.
 * @param options - person relation and meeting date, as the template defines them.
 * @returns the KB-relative path of the created file, plus a notice when the custom template fell back.
 */
export async function createEntity(
  kbRoot: string,
  type: EntityType,
  name: string,
  options: EntityTemplateOptions = {},
): Promise<{ path: string; notice?: string }> {
  const root = resolveWithinKb(kbRoot)
  const singleton = SINGLETON_FILES[type]
  if (singleton !== undefined) {
    throw new KbError(
      'singleton-entity',
      `「${type}」是单例实体（entities/${singleton}），由 kb_init 创建，不能用 kb_create_entity 新建`,
    )
  }
  // Meeting notes are filed under `<date> <name>` so the directory reads as a
  // timeline; the frontmatter title and the creation bullet keep the clean name.
  const stamp = options.meetingDate ?? todayStamp()
  const target = entityFilePath(root, type, type === 'meeting' ? `${stamp} ${name}` : name)
  const display = displayPath(root, target)
  if (existsSync(target)) {
    throw new KbError('entity-exists', `实体「${name}」已存在（${display}）；如需补充请使用 kb_append_log`)
  }
  const built = buildEntityFile(root, type, name, todayStamp(), options)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, built.content, 'utf8')
  return built.notice === undefined ? { path: display } : { path: display, notice: built.notice }
}

/**
 * Append one dated bullet to an entity's `## 流水` section. The entity is
 * located by `type:name` or by path; the frontmatter must parse and the
 * anchor must exist exactly once — everything else about the file stays
 * byte-for-byte intact.
 * @param kbRoot - the knowledge-base root the entity lives under.
 * @param locator - entity locator: `type:name` (plural spellings accepted) or an entity file path.
 * @param text - the log text; continuation lines are indented two spaces.
 * @returns the KB-relative path and the exact inserted bullet block.
 */
export async function appendLog(kbRoot: string, locator: string, text: string): Promise<{ path: string; appended: string }> {
  const root = resolveWithinKb(kbRoot)
  const target = resolveEntityLocator(root, locator)
  const { content, display } = await readEntityFile(root, target)
  parseFrontmatter(content, display)
  if (text.trim() === '') throw new KbError('empty-append', '追加的日志文本不能为空')
  const bullet = logBullet(todayStamp(), text)
  const next = appendToLogSection(content, bullet, display)
  await writeFile(target, next, 'utf8')
  return { path: display, appended: bullet.join('\n') }
}

/**
 * Replace an entity's `## 状态` section body with `text` — the one section
 * the agent may rewrite (ADR-0004 as revised by ADR-0010). The entity is
 * located like {@link appendLog}; the frontmatter must parse and the anchor
 * must exist exactly once. The `## 流水` section below and everything above
 * the anchor survive byte-for-byte; an empty `text` empties the section.
 * @param kbRoot - the knowledge-base root the entity lives under.
 * @param locator - entity locator: `type:name` (plural spellings accepted) or an entity file path.
 * @param text - the new State section body; newlines become plain markdown lines.
 * @returns the KB-relative path and the text written.
 */
export async function writeState(kbRoot: string, locator: string, text: string): Promise<{ path: string; state: string }> {
  const root = resolveWithinKb(kbRoot)
  const target = resolveEntityLocator(root, locator)
  const { content, display } = await readEntityFile(root, target)
  parseFrontmatter(content, display)
  const next = replaceStateSection(content, text, display)
  await writeFile(target, next, 'utf8')
  return { path: display, state: text }
}

/**
 * Replace the whole body of any `## ` section in an entity file — the
 * agent's section-addressed edit surface (ADR-0026 决定 2, generalizing the
 * ADR-0010 state-section seam). The `## 流水` section is refused at this tool
 * layer: history is append-only for every writer, and `kb_append_log` is its
 * only door. The frontmatter is never touched; a missing or duplicated anchor
 * is an error, never a rebuild; the todo singleton has no sections at all.
 * @param kbRoot - the knowledge-base root the entity lives under.
 * @param locator - entity locator: `type:name` (plural spellings accepted) or an entity file path.
 * @param section - the section anchor, `目标` or `## 目标` form.
 * @param text - the new section body; newlines become plain markdown lines, empty text empties the section.
 * @returns the KB-relative path, the section anchor as given, and the text written.
 */
export async function editSection(kbRoot: string, locator: string, section: string, text: string): Promise<{
  path: string
  section: string
  state: string
}> {
  const root = resolveWithinKb(kbRoot)
  const target = resolveEntityLocator(root, locator)
  const { content, display } = await readEntityFile(root, target)
  for (const singleton of Object.values(SINGLETON_FILES)) {
    if (display === `entities/${singleton}`) {
      throw new KbError('singleton-entity', `「${display}」是单例文件，没有区段结构，不能用区段工具编辑`)
    }
  }
  parseFrontmatter(content, display)
  const next = replaceSection(content, section, text, display)
  await writeFile(target, next, 'utf8')
  return { path: display, section: section.trim(), state: text }
}

/**
 * Return one entity file's complete content. The entity is located like
 * {@link appendLog}, so a meeting is found by its bare name even though its
 * file carries the meeting's own date as a prefix.
 * @param kbRoot - the knowledge-base root the entity lives under.
 * @param type - the entity kind.
 * @param name - the entity display name (file basename, without `.md`); a meeting's file
 *   basename is `<YYYY-MM-DD> <name>`, which this lookup also matches.
 * @returns the KB-relative path and the file's complete content.
 */
export async function readEntity(kbRoot: string, type: EntityType, name: string): Promise<{ path: string; content: string }> {
  const root = resolveWithinKb(kbRoot)
  const { content, display } = await readEntityFile(root, resolveEntityLocator(root, `${type}:${name}`))
  parseFrontmatter(content, display)
  return { path: display, content }
}

/** One listed entity row. */
export interface ListedEntity {
  type: EntityType
  name: string
  archived: boolean
  relation?: string
  email?: string
}

/** One entity file to inspect: its KB-relative display path, absolute path, and display name. */
interface EntityFileEntry {
  display: string
  absolute: string
  name: string
}

/**
 * The candidate `.md` files of one entity kind: a singleton kind contributes
 * its single file (when it exists), every other kind the notes in its
 * directory (empty when the directory is absent).
 * @param root - the resolved knowledge-base root.
 * @param type - the entity kind to collect.
 * @returns the candidate files in directory read order.
 */
async function entityFilesOf(root: string, type: EntityType): Promise<EntityFileEntry[]> {
  const singleton = SINGLETON_FILES[type]
  if (singleton !== undefined) {
    const absolute = join(root, 'entities', singleton)
    if (!existsSync(absolute)) return []
    return [{ display: `entities/${singleton}`, absolute, name: singleton.slice(0, -'.md'.length) }]
  }
  const dir = join(root, 'entities', ENTITY_DIRS[type])
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return files
    .filter(file => file.endsWith('.md'))
    .map(file => ({
      display: `entities/${ENTITY_DIRS[type]}/${file}`,
      absolute: join(dir, file),
      name: file.slice(0, -'.md'.length),
    }))
}

/**
 * List entity display names (file basename minus `.md`), newest-frontmatter-
 * first per directory read order. Entities whose frontmatter carries
 * `archive: true` are hidden unless `includeArchived` is set. Singleton
 * kinds list their one file when it exists.
 * @param kbRoot - the knowledge-base root to list.
 * @param type - restrict to one entity kind; omit to list every kind.
 * @param includeArchived - also list entities whose frontmatter declares `archive: true`.
 * @returns the listed entity rows with archive flags (and person relations).
 */
export async function listEntities(kbRoot: string, type?: EntityType, includeArchived = false): Promise<{ entities: ListedEntity[] }> {
  const root = resolveWithinKb(kbRoot)
  const types = type === undefined ? ENTITY_TYPES : [type]
  const entities: ListedEntity[] = []
  for (const current of types) {
    for (const entry of await entityFilesOf(root, current)) {
      let data: Record<string, unknown>
      try {
        data = parseFrontmatter(await readFile(entry.absolute, 'utf8'), entry.display).data
      } catch (error) {
        if (error instanceof KbError) continue
        throw error
      }
      const archived = data.archive === true
      if (archived && !includeArchived) continue
      const listed: ListedEntity = { type: current, name: entry.name, archived }
      if (current === 'person' && typeof data.relation === 'string') listed.relation = data.relation
      if (current === 'person' && typeof data.email === 'string') listed.email = data.email
      entities.push(listed)
    }
  }
  return { entities }
}

/**
 * Register one original material: copy it into `resources/` under its
 * sanitized basename (never overwriting). The source path must name an
 * existing regular file. Since ADR-0020 registration is a pure copy — no
 * shadow note is generated beside the resource.
 * @param kbRoot - the knowledge-base root the resource is registered into.
 * @param absolutePath - absolute path of the source file to copy.
 * @returns the KB-relative path of the copied resource.
 */
export async function registerResource(kbRoot: string, absolutePath: string): Promise<{ resource: string }> {
  const root = resolveWithinKb(kbRoot)
  let sourceStat
  try {
    sourceStat = await stat(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KbError('resource-not-found', `找不到要登记的文件：${absolutePath}`)
    }
    throw error
  }
  if (!sourceStat.isFile()) {
    throw new KbError('resource-not-file', `要登记的路径不是一个普通文件：${absolutePath}`)
  }
  const base = sanitizeFileName(absolutePath.split(/[\\/]/).pop() ?? '')
  return { resource: await writeResourceFile(root, base, await readFile(absolutePath)) }
}

/**
 * Register one original material from in-memory bytes — the drag-and-drop
 * intake path (ADR-0020), where the browser hands over the file's content
 * rather than a path. The name is sanitized into `resources/` and an
 * existing resource is refused, exactly like {@link registerResource}.
 * @param kbRoot - the knowledge-base root the resource is registered into.
 * @param name - the file's name as dropped (sanitized before it lands).
 * @param content - the file's bytes.
 * @returns the KB-relative path of the copied resource.
 */
export async function registerResourceContent(kbRoot: string, name: string, content: Uint8Array): Promise<{ resource: string }> {
  const root = resolveWithinKb(kbRoot)
  const base = sanitizeFileName(name)
  return { resource: await writeResourceFile(root, base, content) }
}

/** Write one resource file into `resources/` under a sanitized name, refusing to overwrite. */
async function writeResourceFile(root: string, base: string, content: Uint8Array): Promise<string> {
  if (base === '') throw new KbError('resource-invalid-name', '资源名不能为空')
  const resourceTarget = resolveWithinKb(root, 'resources', base)
  if (existsSync(resourceTarget)) {
    throw new KbError('resource-exists', `资源「${base}」已登记过（resources/${base}）；resources/ 下的原始材料不覆盖`)
  }
  await mkdir(dirname(resourceTarget), { recursive: true })
  await writeFile(resourceTarget, content)
  return displayPath(root, resourceTarget)
}

/**
 * Create one new text file under `resources/` — the agent's door into the
 * resource plane (ADR-0026 决定 3). The path is KB-relative and must land
 * under `resources/`, possibly inside not-yet-existing subdirectories; every
 * segment is sanitized and `.`/`..` are refused outright. An existing target
 * is refused — never overwritten, never silently renamed — the same collision
 * semantics as {@link registerResource}. Only creation is offered: editing a
 * resource stays a human act, preserving resources/' 原始材料 semantics. The
 * workbench tree learns of the new file through the ADR-0017 revision watch,
 * so no extra notification channel exists or is needed.
 * @param kbRoot - the knowledge-base root to write into.
 * @param path - KB-relative target path, e.g. `resources/reports/周报.md`.
 * @param content - the file's text, written as UTF-8.
 * @returns the KB-relative path of the created resource.
 */
export async function writeResource(kbRoot: string, path: string, content: string): Promise<{ resource: string }> {
  const root = resolveWithinKb(kbRoot)
  const segments = path.split(/[\\/]/).filter(segment => segment !== '')
  if (segments[0] !== 'resources') {
    throw new KbError('resource-outside-plane', `目标必须在 resources/ 下（形如 resources/报告/周报.md），收到的是「${path}」`)
  }
  const rest = segments.slice(1)
  if (rest.length === 0) {
    throw new KbError('resource-invalid-name', '资源名不能为空；请给出形如 resources/周报.md 的目标路径')
  }
  for (const segment of rest) {
    if (segment === '.' || segment === '..') {
      throw new KbError('resource-invalid-name', `资源路径段「${segment}」不合法；不允许相对目录段`)
    }
  }
  const resourceTarget = resolveWithinKb(root, 'resources', ...rest.map(segment => sanitizeFileName(segment)))
  if (existsSync(resourceTarget)) {
    const display = displayPath(root, resourceTarget)
    throw new KbError('resource-exists', `资源「${display}」已存在；resources/ 下的原始材料不覆盖，请换一个名字`)
  }
  await mkdir(dirname(resourceTarget), { recursive: true })
  await writeFile(resourceTarget, content, 'utf8')
  return { resource: displayPath(root, resourceTarget) }
}

/** One listed resource row: KB-relative path and byte size. */
export interface ListedResource {
  path: string
  size: number
}

/** The result of reading one resource: a file's full text, or a directory listing. */
export type ReadResourceResult =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'dir'; path: string; entries: ListedResource[]; truncated?: boolean }

/**
 * Read one entry under `resources/` — the read half of the resource plane
 * (ADR-0028 决定 1), closing the write-only asymmetry ADR-0026 left behind.
 * The path gate mirrors {@link writeResource} minus sanitization: a read
 * must name the file exactly as it sits on disk, so segments are only
 * checked (resources/ prefix, no `.`/`..`), never rewritten. A file answers
 * its UTF-8 full text; NUL bytes mark it binary and the read is refused with
 * the size rather than injecting mojibake. A directory answers a recursive
 * listing of path + size, capped at {@link MAX_DIR_ENTRIES} with a
 * `truncated` flag — the listing carries no content, and the agent reads
 * files from it one call at a time.
 * @param kbRoot - the knowledge-base root to read from.
 * @param path - KB-relative resource path, e.g. `resources/报告/周报.md` or `resources/报告`.
 * @returns the file's text, or the directory's recursive listing.
 */
export async function readResource(kbRoot: string, path: string): Promise<ReadResourceResult> {
  const root = resolveWithinKb(kbRoot)
  const segments = path.split(/[\\/]/).filter(segment => segment !== '')
  if (segments[0] !== 'resources') {
    throw new KbError('resource-outside-plane', `只能读取 resources/ 下的资源（形如 resources/报告/周报.md），收到的是「${path}」`)
  }
  const rest = segments.slice(1)
  if (rest.length === 0) {
    throw new KbError('resource-invalid-name', '资源路径不能为空；请给出形如 resources/周报.md 的路径')
  }
  for (const segment of rest) {
    if (segment === '.' || segment === '..') {
      throw new KbError('resource-invalid-name', `资源路径段「${segment}」不合法；不允许相对目录段`)
    }
  }
  const target = resolveWithinKb(root, 'resources', ...rest)
  const display = displayPath(root, target)
  let info
  try {
    info = await stat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KbError('resource-not-found', `找不到资源「${display}」；目录路径会返回递归清单`)
    }
    throw error
  }
  if (info.isDirectory()) {
    const entries: ListedResource[] = []
    // Walk one directory level; answers whether the entry cap ended the listing.
    const walk = async (dir: string, prefix: string): Promise<boolean> => {
      const dirents = await readdir(dir, { withFileTypes: true })
      dirents.sort((left, right) => left.name.localeCompare(right.name))
      for (const dirent of dirents) {
        if (entries.length >= MAX_DIR_ENTRIES) return true
        if (dirent.isDirectory()) {
          if (await walk(join(dir, dirent.name), `${prefix}${dirent.name}/`)) return true
        } else if (dirent.isFile()) {
          const fileStat = await stat(join(dir, dirent.name))
          entries.push({ path: `${prefix}${dirent.name}`, size: fileStat.size })
        }
      }
      return false
    }
    const truncated = await walk(target, '')
    return { kind: 'dir', path: display, entries, ...(truncated ? { truncated: true } : {}) }
  }
  if (!info.isFile()) {
    throw new KbError('resource-not-file', `「${display}」既不是普通文件也不是目录`)
  }
  const buffer = await readFile(target)
  if (buffer.includes(0)) {
    throw new KbError('resource-binary', `「${display}」是二进制文件（${buffer.length} 字节）；不注入二进制内容`)
  }
  return { kind: 'file', path: display, content: buffer.toString('utf8') }
}
