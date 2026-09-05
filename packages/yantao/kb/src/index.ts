/**
 * The yantao KB cordis plugin: registers the six kb_ tools that are the
 * agent's ONLY write path into the knowledge base. The plugin owns no
 * service and no state beyond the resolved kbRoot; every operation re-reads
 * the files it touches, so a human editing the same KB between calls always
 * wins. Pair with the yantao profile patch, which removes the generic write
 * tools (shell, editor) — this family is deliberately all that remains.
 * @module @deepseek-ai/dsh-yantao-kb
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendLog, createEntity, initKb, listEntities, readEntity, registerResource } from './core.ts'
import { PERSON_RELATIONS } from './types.ts'

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

const ENTITY_TYPE_PARAM = {
  type: 'string',
  enum: ['project', 'area', 'person'],
  description: '实体类型：project（项目）/ area（领域）/ person（人物）',
} as const

/** Register the six kb_ tools; disposal of the plugin fiber unregisters them. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig

  ctx.tools.register(defineTool({
    name: 'kb_init',
    description:
      '初始化知识库目录结构：resources/、entities/{projects,areas,people}/、sessions/、根 README，'
      + '以及人物实体「我自己」（relation: self，仅当不存在时创建）。幂等——已存在的内容不会被改动。'
      + '首次使用知识库前调用一次。',
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
    execute: () => initKb(resolved.kbRoot),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_create_entity',
    description:
      '创建一个实体笔记文件（type + name）。实体名会转换为安全文件名；同名实体已存在时拒绝——'
      + '之后的一切补充都通过 kb_append_log 追加。relation 仅对 person 有意义，默认 subordinate。',
    parameters: {
      type: { ...ENTITY_TYPE_PARAM, required: true },
      name: { type: 'string', required: true, description: '实体显示名，例如「dsh 学习」' },
      relation: {
        type: 'string',
        enum: PERSON_RELATIONS,
        description: '人物与库主的关系（仅 person 使用）：self / subordinate / superior / peer / external',
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
    execute: args => createEntity(resolved.kbRoot, args.type, args.name, args.relation),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_append_log',
    description:
      '向实体文件的『流水』区末尾追加一条日志（自动冠以今日日期 - YYYY-MM-DD）；多行文本的后续行会缩进两格，'
      + '保持列表连续。这是修改实体文件的唯一途径：『状态』区是人类专属，绝不改动；缺少『流水』锚点会报错而不是重建。'
      + 'entity 形如 "project:dsh 学习"（也接受 projects/areas/people 拼写或实体文件路径）。',
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
    execute: args => appendLog(resolved.kbRoot, args.entity, args.text),
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
    execute: args => readEntity(resolved.kbRoot, args.type, args.name),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_list_entities',
    description:
      '列出知识库中的实体名。type 省略时列出 project/area/person 三类；frontmatter 含 archive: true '
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
    execute: args => listEntities(resolved.kbRoot, args.type, args.includeArchived ?? false),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_register_resource',
    description:
      '把一份原始材料登记进知识库：按原名（经安全文件名处理）复制到 resources/，并在旁边创建同名 .md 影子笔记。'
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
          note: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已登记资源：${value.resource}\n影子笔记：${value.note}` }],
    },
    execute: args => registerResource(resolved.kbRoot, args.path),
  }))
}
