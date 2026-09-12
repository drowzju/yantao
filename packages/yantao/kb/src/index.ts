/**
 * The yantao KB cordis plugin: registers the kb_ tools that are the
 * agent's ONLY write path into the knowledge base. The plugin owns no
 * service and no state beyond the live kbRoot (the persisted override when
 * the workbench has chosen one, otherwise the config default); every operation re-reads
 * the files it touches, so a human editing the same KB between calls always
 * wins. Pair with the yantao profile patch, which removes the generic write
 * tools (shell, editor) — this family is deliberately all that remains.
 * @module @deepseek-ai/dsh-yantao-kb
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { appendLog, createEntity, initKb, listEntities, readEntity, readResourceChunk, registerResource, writeState } from './core.ts'
import { kbMentions, renderKbMentions } from './mentions.ts'
import { readKbRootOverride, writeKbRootOverride } from './root-store.ts'
import { ENTITY_TYPES, PERSON_RELATIONS } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'yantao-kb'

/** Services required by the KB tool family. */
export const inject = ['tools']

/** Plugin config; `kbRoot` is the only knob. */
export interface Config {
  /** Knowledge-base root directory (created by kb_init). Defaults to `~/yantao-kb`. */
  kbRoot?: string
}

export const Config: z<Config> = z.object({
  kbRoot: z.string().default(join(homedir(), 'yantao-kb')),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/**
 * The live KB root, published while the yantao-kb plugin is mounted so
 * host-side consumers (the yantao-kb-controller Remote) share this one
 * configuration point instead of duplicating it. The root starts as the
 * persisted override when the workbench has chosen one, and otherwise as the
 * config default; `setRoot` retargets the whole host at a new root.
 */
export interface YantaoKbService {
  /** Resolved knowledge-base root directory. */
  readonly root: string
  /** True when the root comes from a persisted override rather than the config default. */
  readonly configured: boolean
  /**
   * Retarget the live KB at `next` and persist it as the override.
   * @param next - the new knowledge-base root directory (absolute).
   */
  setRoot(next: string): void
}

/**
 * The live root: the persisted override when there is one, the config
 * default otherwise, and always the one value every host-side consumer
 * reads. Persisting a new root is fire-and-forget — the in-process root is
 * already correct, and a failed write only costs the next boot.
 */
class LiveKbRoot implements YantaoKbService {
  constructor(
    private current: string,
    private persisted: boolean,
    private readonly onPersistFailure: (message: string) => void,
  ) {}

  get root(): string {
    return this.current
  }

  get configured(): boolean {
    return this.persisted
  }

  setRoot(next: string): void {
    this.current = next
    this.persisted = true
    void writeKbRootOverride(next).catch((error: unknown) => {
      this.onPersistFailure((error as Error).message)
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Resolved KB root, provided by the mounted yantao-kb plugin. */
    yantaoKb: YantaoKbService
  }
}

const ENTITY_TYPE_PARAM = {
  type: 'string',
  enum: [...ENTITY_TYPES],
  description: '实体类型：project（项目）/ area（领域）/ person（人物）/ meeting（会议）/ todo（待办单例）',
} as const

/** The kinds an agent may create — singleton kinds (`todo`) belong to kb_init. */
const CREATABLE_ENTITY_TYPE_PARAM = {
  ...ENTITY_TYPE_PARAM,
  enum: ['project', 'area', 'person', 'meeting'],
  description: '实体类型：project（项目）/ area（领域）/ person（人物）/ meeting（会议）；todo 是单例，由 kb_init 创建',
} as const

/** One cited file that read successfully. */
interface CitedFile {
  /** KB-relative path. */
  readonly path: string
  /** The file's content. */
  readonly content: string
}

/**
 * Read the KB files a turn cited, skipping anything that is not a readable
 * file inside the root. A cited file that vanished costs the citation, not
 * the turn.
 * @param root - the live KB root.
 * @param paths - KB-relative paths from {@link kbMentions}.
 * @returns the files that read, in citation order.
 */
async function readCitedFiles(root: string, paths: readonly string[]): Promise<CitedFile[]> {
  const cited: CitedFile[] = []
  for (const path of paths) {
    const absolute = join(root, path)
    // Defense in depth: kbMentions already refuses escaping paths, and this
    // keeps the read inside the root even if that check ever loosens.
    if (relative(root, absolute).startsWith('..')) continue
    try {
      cited.push({ path, content: await readFile(absolute, 'utf8') })
    } catch {
      continue
    }
  }
  return cited
}

/** Register the kb_ tools and publish the resolved KB root; disposal unregisters both. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig

  const override = readKbRootOverride()
  const liveRoot = new LiveKbRoot(
    override ?? resolved.kbRoot,
    override !== undefined,
    (message) => {
      ctx.logger.warn(`yantao-kb: 无法持久化知识库根目录：${message}`)
    },
  )

  ctx.effect(
    () => ctx.provide('yantaoKb', liveRoot satisfies YantaoKbService),
    'yantao-kb: provide KB root service',
  )

  // `@` mentions: the composer inserts a KB-relative path, and nothing else in
  // this profile tells the model what one is. Read the cited files and hand
  // the model their content as one context message ahead of the turn.
  ctx.on('agent/pre-step', async (_event, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const messages = decision.messages
    const last = messages[messages.length - 1]
    if (last === undefined || last.source.kind !== 'user') return decision
    const text = last.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const cited = await readCitedFiles(liveRoot.root, kbMentions(text))
    if (cited.length === 0) return decision
    return {
      ...decision,
      messages: [...messages, createUserMessage({
        source: { kind: 'plugin', plugin: 'dsh-yantao-kb', form: 'recall' },
        content: [{ type: 'text', text: renderKbMentions(cited) }],
      })],
    }
  })

  ctx.tools.register(defineTool({
    name: 'kb_init',
    description:
      '初始化知识库目录结构：resources/、entities/{projects,areas,people,meetings}/、sessions/、根 README，'
      + '以及人物实体「我自己」（relation: self，仅当不存在时创建）和待办单例 entities/todos.md。'
      + '幂等——已存在的内容不会被改动。首次使用知识库前调用一次。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kbRoot: { type: 'string', required: true },
          created: { type: 'array', items: { type: 'string' }, required: true },
          existing: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `知识库已就绪：${value.kbRoot}\n新建 ${value.created.length} 项（${value.created.join('、') || '无'}）；`
          + `已存在 ${value.existing.length} 项`,
      }],
    },
    execute: () => initKb(liveRoot.root),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_create_entity',
    description:
      '创建一个实体笔记文件（type + name）。实体名会转换为安全文件名；同名实体已存在时拒绝——'
      + '之后的一切补充都通过 kb_append_log 追加或 kb_write_state 改写状态。'
      + 'relation 仅对 person 有意义，默认 subordinate；date 仅对 meeting 有意义，是该会议的日期，默认今天。'
      + 'todo 是单例，不能用此工具创建。',
    parameters: {
      type: { ...CREATABLE_ENTITY_TYPE_PARAM, required: true },
      name: { type: 'string', required: true, description: '实体显示名，例如「dsh 学习」或「周会」' },
      relation: {
        type: 'string',
        enum: PERSON_RELATIONS,
        description: '人物与库主的关系（仅 person 使用）：self / subordinate / superior / peer / external',
      },
      date: {
        type: 'string',
        description: '会议日期 YYYY-MM-DD（仅 meeting 使用，默认今天）；写入 frontmatter 的 date 字段',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已创建实体：${value.path}` }],
    },
    execute: args => createEntity(liveRoot.root, args.type, args.name, {
      ...args.relation !== undefined ? { relation: args.relation } : {},
      ...args.date !== undefined ? { meetingDate: args.date } : {},
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_append_log',
    description:
      '向实体文件的『流水』区末尾追加一条日志（自动冠以今日日期 - YYYY-MM-DD）；多行文本的后续行会缩进两格，'
      + '保持列表连续。流水区只追加、不改写，其余内容原样保留；改写『状态』区请用 kb_write_state。'
      + '缺少『流水』锚点会报错而不是重建（todo 单例没有区段，不能用此工具）。'
      + 'entity 形如 "project:dsh 学习"（也接受各类复数拼写或实体文件路径）。',
    parameters: {
      entity: { type: 'string', required: true, description: '实体定位："type:name"（如 "project:dsh 学习"）或实体文件路径' },
      text: { type: 'string', required: true, description: '日志内容；多行时后续行作为该条目的缩进续行' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          appended: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已追加到 ${value.path} 的『流水』区：\n${value.appended}` }],
    },
    execute: args => appendLog(liveRoot.root, args.entity, args.text),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_write_state',
    description:
      '整体改写实体文件的『状态』区（该区由人和 agent 共同维护）：用 text 替换原状态内容，'
      + '可写入多行 markdown。『流水』区与 frontmatter 原样保留，不会被本工具改动——追加流水请用 kb_append_log。'
      + 'text 为空字符串即清空状态区。缺少或重复『状态』锚点会报错而不是重建。'
      + 'entity 形如 "project:dsh 学习"（也接受各类复数拼写或实体文件路径）。',
    parameters: {
      entity: { type: 'string', required: true, description: '实体定位："type:name"（如 "project:dsh 学习"）或实体文件路径' },
      text: { type: 'string', required: true, description: '新的『状态』区正文（markdown）；留空表示清空' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          state: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已更新 ${value.path} 的『状态』区：\n${value.state}` }],
    },
    execute: args => writeState(liveRoot.root, args.entity, args.text),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_read_entity',
    description: '读取一个实体笔记的完整内容（frontmatter、『状态』区与『流水』区原文）。',
    parameters: {
      type: { ...ENTITY_TYPE_PARAM, required: true },
      name: { type: 'string', required: true, description: '实体显示名（文件名，不含 .md）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    execute: args => readEntity(liveRoot.root, args.type, args.name),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_list_entities',
    description:
      '列出知识库中的实体名。type 省略时列出 project/area/person/meeting/todo 五类；frontmatter 含 archive: true '
      + '的实体默认不列出，includeArchived 为 true 时一并列出并标注。',
    parameters: {
      type: { ...ENTITY_TYPE_PARAM, description: '只列出该类型；省略则列出全部三类' },
      includeArchived: { type: 'boolean', description: '同时列出 frontmatter 标记 archive: true 的实体（默认 false）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string', required: true },
                name: { type: 'string', required: true },
                archived: { type: 'boolean', required: true },
                relation: { type: 'string' },
              },
            },
            required: true,
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entities.length === 0
          ? '（没有符合条件的实体）'
          : value.entities
            .map(entry => `- [${entry.type}] ${entry.name}${entry.archived ? '（已归档）' : ''}${entry.relation !== undefined ? ` — ${entry.relation}` : ''}`)
            .join('\n'),
      }],
    },
    execute: args => listEntities(liveRoot.root, args.type, args.includeArchived ?? false),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_register_resource',
    description:
      '把一份原始材料登记进知识库：按原名（经安全文件名处理）复制到 resources/。'
      + '原始材料永不改写、不覆盖；同名资源已登记时会拒绝。path 必须是已存在文件的绝对路径。',
    parameters: {
      path: { type: 'string', required: true, description: '要登记的文件绝对路径（如 C:\\Users\\…\\周报.eml）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resource: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已登记资源：${value.resource}` }],
    },
    execute: args => registerResource(liveRoot.root, args.path),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_read_resource',
    description:
      '分页读取一份资源的抽取文本（ADR-0020）：一本书几十万字，用 offset/length 一块块读完，'
      + '每次返回 chunk 与 hasMore，读完为止。资源必须先经工作台的「创建读书项目」完成文本抽取'
      + '（缓存在 .yantao/extracts/）；未抽取的资源会报错。path 形如 "resources/三体.epub"。',
    parameters: {
      path: { type: 'string', required: true, description: '资源的 KB 相对路径（resources/ 下）' },
      offset: { type: 'number', description: '起始字符偏移（默认 0）' },
      length: { type: 'number', description: '本次返回的字符数（默认 20000）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resource: { type: 'string', required: true },
          total: { type: 'number', required: true },
          offset: { type: 'number', required: true },
          chunk: { type: 'string', required: true },
          hasMore: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `【${value.resource}】第 ${value.offset + 1}–${value.offset + value.chunk.length} 字 / 共 ${value.total} 字`
          + `${value.hasMore ? '（未完，续读请增大 offset）' : '（全文完）'}\n\n${value.chunk}`,
      }],
    },
    execute: args => readResourceChunk(liveRoot.root, args.path, args.offset, args.length),
  }))
}

// Host-side consumers (the yantao-kb-controller Remote) reuse the filesystem
// operations and path confinement through these public re-exports; the
// plugin above remains the model-facing shell over the same operations.
export { appendLog, createEntity, extractPaths, initKb, listEntities, readEntity, readResourceChunk, registerResource, registerResourceContent, writeState } from './core.ts'
export type { InitKbResult, ListedEntity, ResourceChunk } from './core.ts'
export { RESOURCE_CHUNK_LENGTH } from './core.ts'
export { entityDisplayPath, resolveWithinKb, sanitizeFileName, todayStamp } from './paths.ts'
export {
  kbRootStatePath, readCapabilityState, readKbRootOverride, readMailWatermark,
  writeCapabilityState, writeKbRootOverride, writeMailWatermark,
} from './root-store.ts'
export { appendToLogSection, logBullet, replaceStateSection } from './splice.ts'
export { linksOf, resolveWikiLink, wikilinks } from './links.ts'
export type { KbLinkSource, KbLinkTarget, KbLinks, WikiLink } from './links.ts'
export { parseFrontmatter } from './frontmatter.ts'
export type { Frontmatter } from './frontmatter.ts'
export { addTodo, parseTodoFile, removeTodo, serializeTodoFile, toggleTodo, updateTodo } from './todo.ts'
export type { TodoDraft, TodoFile, TodoItem, TodoPatch } from './todo.ts'
export { entityFileContent, KB_README, todoFileContent } from './templates.ts'
export type { EntityTemplateOptions } from './templates.ts'
export { ENTITY_DIRS, ENTITY_TYPES, KbError, PERSON_RELATIONS, SINGLETON_FILES } from './types.ts'
export type { EntityType, PersonRelation } from './types.ts'
