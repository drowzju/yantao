/**
 * The yantaoKb Remote controller: the workbench UI's direct KB channel.
 * `tree` shapes the five-section KB tree (resources, projects, areas,
 * people, sessions); `read`/`write` address single files by KB-relative
 * path, always confined to the kbRoot the yantao-kb plugin publishes as the
 * `yantaoKb` service — one configuration point, no duplicated config. The UI
 * is the human channel, so `write` is a full-file write; the ADR-0004 trust
 * boundary binds only the agent's kb_ tools, never this surface.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ENTITY_DIRS, KbError, listEntities, resolveWithinKb } from '@deepseek-ai/dsh-yantao-kb'
import type { EntityType } from '@deepseek-ai/dsh-yantao-kb'
import type { KbFileContent, KbTree, KbTreeFile, KbTreeSection, KbWriteResult } from './types.ts'

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
  }
}

/** Entity sections of the tree, in display order, mapped to their entity type. */
const ENTITY_SECTIONS = [
  { id: 'projects', type: 'project' },
  { id: 'areas', type: 'area' },
  { id: 'people', type: 'person' },
] as const satisfies readonly { id: KbTreeSection['id']; type: EntityType }[]

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

  constructor(ctx: Context) {
    super(ctx, 'yantaoKbController', { namespace: 'yantaoKb' })
  }

  private get root(): string {
    return this.ctx.yantaoKb.root
  }

  /** Confine one wire path to the KB root, classifying an escape as `yantao-kb/rejected`. */
  private confine(path: string, display: string): string {
    try {
      return resolveWithinKb(this.root, path)
    } catch (error) {
      if (error instanceof KbError) {
        throw new RemoteError('yantao-kb/rejected', error.message, { path: display }, { cause: error })
      }
      throw error
    }
  }

  /** The five-section KB tree; every section is present even when its directory is absent or empty.
   * @returns the five sections in display order, resource rows pairing their shadow notes and entity rows carrying flags.
   */
  @Remote('tree')
  async tree(): Promise<KbTree> {
    const root = this.root
    const sections: KbTreeSection[] = []
    const resourceNames = await readdirFiles(join(root, 'resources'))
    const resourceSet = new Set(resourceNames)
    const resources: KbTreeFile[] = resourceNames
      .filter(name => !name.endsWith('.md'))
      .map(name => ({
        name,
        path: `resources/${name}`,
        ...resourceSet.has(`${name}.md`) ? { notePath: `resources/${name}.md` } : {},
      }))
    sections.push({ id: 'resources', files: resources })
    for (const { id, type } of ENTITY_SECTIONS) {
      const { entities } = await listEntities(root, type, true)
      sections.push({
        id,
        files: entities.map(entity => ({
          name: entity.name,
          path: `entities/${ENTITY_DIRS[type]}/${entity.name}.md`,
          ...entity.archived ? { archived: true } : {},
          ...entity.relation !== undefined ? { relation: entity.relation } : {},
        })),
      })
    }
    const sessionNames = await readdirFiles(join(root, 'sessions'))
    sections.push({ id: 'sessions', files: sessionNames.map(name => ({ name, path: `sessions/${name}` })) })
    return { sections }
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
}

export default YantaoKbController
