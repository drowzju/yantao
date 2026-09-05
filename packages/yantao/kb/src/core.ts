/**
 * The six KB operations behind the kb_ tool family. Each takes the resolved
 * kbRoot explicitly and is transport-free, so tests drive them directly.
 * Writes are confined to kbRoot and follow the trust boundary: entity files
 * are created from the canonical template once, and afterwards only the
 * `## 流水` section may grow — everything else about a file is read-only.
 * @module @deepseek-ai/dsh-yantao-kb/core
 */

import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { parseFrontmatter } from './frontmatter.ts'
import { entityFilePath, resolveEntityLocator, resolveWithinKb, sanitizeFileName, todayStamp } from './paths.ts'
import { appendToLogSection, logBullet } from './splice.ts'
import { entityFileContent, KB_README, shadowNoteContent } from './templates.ts'
import type { EntityType, PersonRelation } from './types.ts'
import { ENTITY_DIRS, ENTITY_TYPES, KbError } from './types.ts'

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
 * (only when absent), and the owner entity `entities/people/我自己.md`
 * (only when no person carries `relation: self`).
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
    await writeFile(selfPath, entityFileContent('person', '我自己', todayStamp(), 'self'), 'utf8')
    created.push('entities/people/我自己.md')
  }
  return { kbRoot: root, created, existing }
}

/** Create one entity file from the canonical template, refusing to overwrite. */
export async function createEntity(
  kbRoot: string,
  type: EntityType,
  name: string,
  relation?: PersonRelation,
): Promise<{ path: string }> {
  const root = resolveWithinKb(kbRoot)
  const target = entityFilePath(root, type, name)
  const display = displayPath(root, target)
  if (existsSync(target)) {
    throw new KbError('entity-exists', `实体「${name}」已存在（${display}）；如需补充请使用 kb_append_log`)
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, entityFileContent(type, name, todayStamp(), relation), 'utf8')
  return { path: display }
}

/**
 * Append one dated bullet to an entity's `## 流水` section. The entity is
 * located by `type:name` or by path; the frontmatter must parse and the
 * anchor must exist exactly once — everything else about the file stays
 * byte-for-byte intact.
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

/** Return one entity file's complete content. */
export async function readEntity(kbRoot: string, type: EntityType, name: string): Promise<{ path: string; content: string }> {
  const root = resolveWithinKb(kbRoot)
  const { content, display } = await readEntityFile(root, entityFilePath(root, type, name))
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

/**
 * List entity display names (file basename minus `.md`), newest-frontmatter-
 * first per directory read order. Entities whose frontmatter carries
 * `archive: true` are hidden unless `includeArchived` is set.
 */
export async function listEntities(kbRoot: string, type?: EntityType, includeArchived = false): Promise<{ entities: ListedEntity[] }> {
  const root = resolveWithinKb(kbRoot)
  const types = type === undefined ? ENTITY_TYPES : [type]
  const entities: ListedEntity[] = []
  for (const current of types) {
    const dir = join(root, 'entities', ENTITY_DIRS[current])
    let files: string[]
    try {
      files = await readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const display = `entities/${ENTITY_DIRS[current]}/${file}`
      let data: Record<string, unknown>
      try {
        data = parseFrontmatter(await readFile(join(dir, file), 'utf8'), display).data
      } catch (error) {
        if (error instanceof KbError) continue
        throw error
      }
      const archived = data.archive === true
      if (archived && !includeArchived) continue
      const entry: ListedEntity = { type: current, name: file.slice(0, -'.md'.length), archived }
      if (current === 'person' && typeof data.relation === 'string') entry.relation = data.relation
      entities.push(entry)
    }
  }
  return { entities }
}

/**
 * Register one original material: copy it into `resources/` under its
 * sanitized basename (never overwriting) and write its shadow-note skeleton
 * beside it. The source path must name an existing regular file.
 */
export async function registerResource(kbRoot: string, absolutePath: string): Promise<{ resource: string; note: string }> {
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
  const resourceTarget = resolveWithinKb(root, 'resources', base)
  const noteTarget = resolveWithinKb(root, 'resources', `${base}.md`)
  if (existsSync(resourceTarget) || existsSync(noteTarget)) {
    throw new KbError('resource-exists', `资源「${base}」已登记过（resources/${base}）；resources/ 下的原始材料不覆盖`)
  }
  await mkdir(dirname(resourceTarget), { recursive: true })
  await copyFile(absolutePath, resourceTarget)
  await writeFile(noteTarget, shadowNoteContent(base, todayStamp()), 'utf8')
  return { resource: displayPath(root, resourceTarget), note: displayPath(root, noteTarget) }
}
