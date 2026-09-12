/**
 * The KB operations behind the kb_ tool family. Each takes the resolved
 * kbRoot explicitly and is transport-free, so tests drive them directly.
 * Writes are confined to kbRoot and follow the trust boundary: entity files
 * are created from the canonical template once, and afterwards the agent may
 * only rewrite the `## 状态` section and append to the `## 流水` section —
 * every other byte of a file is read-only for the tool layer.
 * @module @deepseek-ai/dsh-yantao-kb/core
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { parseFrontmatter } from './frontmatter.ts'
import { entityFilePath, resolveEntityLocator, resolveWithinKb, sanitizeFileName, todayStamp } from './paths.ts'
import { appendToLogSection, logBullet, replaceStateSection } from './splice.ts'
import type { EntityTemplateOptions } from './templates.ts'
import { entityFileContent, KB_README, todoFileContent } from './templates.ts'
import type { EntityType } from './types.ts'
import { ENTITY_DIRS, ENTITY_TYPES, KbError, SINGLETON_FILES } from './types.ts'

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
    await writeFile(selfPath, entityFileContent('person', '我自己', todayStamp(), { relation: 'self' }), 'utf8')
    created.push('entities/people/我自己.md')
  }
  const todoPath = join(root, 'entities', 'todos.md')
  if (existsSync(todoPath)) {
    existing.push('entities/todos.md')
  } else {
    await writeFile(todoPath, todoFileContent(todayStamp()), 'utf8')
    created.push('entities/todos.md')
  }
  return { kbRoot: root, created, existing }
}

/** Create one entity file from the canonical template, refusing to overwrite.
 * @param kbRoot - the knowledge-base root the entity lives under.
 * @param type - the entity kind; singleton kinds (`todo`) are refused — `kb_init` owns them.
 * @param name - the entity display name (sanitized before it becomes the file name); a meeting's
 *   file name is prefixed with its own date, `<YYYY-MM-DD> <name>`, while the frontmatter keeps
 *   `title: <name>`.
 * @param options - person relation and meeting date, as the template defines them.
 * @returns the KB-relative path of the created file.
 */
export async function createEntity(
  kbRoot: string,
  type: EntityType,
  name: string,
  options: EntityTemplateOptions = {},
): Promise<{ path: string }> {
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
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, entityFileContent(type, name, todayStamp(), options), 'utf8')
  return { path: display }
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
 * The extraction-cache paths for one resource (ADR-0020): the paged-read
 * text and its self-describing metadata live under `.yantao/extracts/` —
 * machine bookkeeping beside the KB, invisible to the trees and never
 * inside `resources/` (originals are never written).
 * @param kbRoot - the knowledge-base root the resource lives under.
 * @param resourcePath - the resource's KB-relative path (`resources/<name>`).
 * @returns the KB-relative display paths of the extracted text and its metadata.
 */
export function extractPaths(kbRoot: string, resourcePath: string): { text: string; meta: string } {
  resolveWithinKb(kbRoot)
  const base = sanitizeFileName(resourcePath.split(/[\\/]/).pop() ?? '')
  if (base === '') throw new KbError('resource-not-found', `资源路径不合法：${resourcePath}`)
  return {
    text: `.yantao/extracts/${base}.txt`,
    meta: `.yantao/extracts/${base}.json`,
  }
}

/** One paged read of an extracted resource text (ADR-0020). */
export interface ResourceChunk {
  /** The resource's KB-relative path as requested. */
  resource: string
  /** The extract's total character count. */
  total: number
  /** The requested offset (characters). */
  offset: number
  /** The returned text chunk. */
  chunk: string
  /** True when more text follows this chunk. */
  hasMore: boolean
}

/** The default chunk size of {@link readResourceChunk}, in characters. */
export const RESOURCE_CHUNK_LENGTH = 20000

/**
 * Return one chunk of a resource's extracted text, for the agent to page
 * through a whole book without blowing the context (ADR-0020). The resource
 * must live under `resources/`; its extract must exist — run the
 * extraction (the `ebook` capability, via the workbench) first.
 * @param kbRoot - the knowledge-base root the resource lives under.
 * @param resourcePath - the resource's KB-relative path (`resources/<name>`).
 * @param offset - character offset to read from (default 0).
 * @param length - chunk size in characters (default {@link RESOURCE_CHUNK_LENGTH}).
 * @returns the chunk with paging bookkeeping.
 */
export async function readResourceChunk(
  kbRoot: string,
  resourcePath: string,
  offset = 0,
  length = RESOURCE_CHUNK_LENGTH,
): Promise<ResourceChunk> {
  const root = resolveWithinKb(kbRoot)
  const absolute = resolveWithinKb(root, resourcePath)
  const display = displayPath(root, absolute)
  if (display !== 'resources' && !display.startsWith('resources/')) {
    throw new KbError('resource-outside', `kb_read_resource 只读 resources/ 下的资源：${resourcePath}`)
  }
  const { text } = extractPaths(root, resourcePath)
  let content: string
  try {
    content = await readFile(join(root, text), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KbError('extract-missing', `资源「${resourcePath}」还没有文本抽取缓存；请先在工作台创建读书项目触发抽取`)
    }
    throw error
  }
  const start = Math.max(0, Math.floor(offset))
  const chunk = content.slice(start, start + Math.max(1, Math.floor(length)))
  return {
    resource: display,
    total: content.length,
    offset: start,
    chunk,
    hasMore: start + chunk.length < content.length,
  }
}
