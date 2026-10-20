/**
 * The yantao KB cordis plugin: registers the kb_ tools that are the
 * agent's ONLY write path into the knowledge base. The plugin owns no
 * service and no state beyond the live kbRoot (the settings-plane pointer
 * when one is recorded, otherwise the config default); every operation re-reads
 * the files it touches, so a human editing the same KB between calls always
 * wins. Pair with the yantao profile patch, which removes the generic write
 * tools (shell, editor) — this family is deliberately all that remains.
 * @module @deepseek-ai/dsh-yantao-kb
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: the Loader's `loader/volatile-update` event the KB pointer follows.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { readCitedEntries } from './cited.ts'
import { CAPABILITY_ARTIFACT_DIRS } from './capability-file.ts'
import { appendLog, createEntity, editSection, initKb, listEntities, readEntity, readResource, registerResource, writeResource, writeState } from './core.ts'
import { kbMentions, renderKbMentions } from './mentions.ts'
import { appendMemoryProposal, PROPOSAL_PENDING_SOFT_CAP } from './proposals.ts'
import { INBOX_PENDING_SOFT_CAP } from './proposal-inbox.ts'
import { importLegacyRootState } from './root-store.ts'
import { proposeSkillRewrite } from './skill-rewrite.ts'
import { registerBehaviorMemorySection, registerClockSection, registerFilesystemSection, registerPromptSections, registerPromptShortcutsSection } from './sections.ts'
import { ENTITY_TYPES, PERSON_RELATIONS } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'yantao-kb'

/**
 * Services required by the KB tool family and the prompt-section layer.
 * `settings` carries the KB pointer (ADR-0024 决定 3): `kbRoot` is this
 * plugin's own volatile config field, so the settings UI edits it through the
 * active profile's patch and Loader commits the change live.
 */
export const inject = ['tools', 'systemPrompt', 'settings']

/** The schema default every deployment starts from. */
const DEFAULT_KB_ROOT = join(homedir(), 'yantao-kb')

/** Plugin config; `kbRoot` is the only knob. */
export interface Config {
  /** Knowledge-base root directory (created by kb_init). Defaults to `~/yantao-kb`. */
  kbRoot: Volatile<string>
}

export const Config = z.object({
  kbRoot: z.string().default(DEFAULT_KB_ROOT).volatile(),
})

/**
 * The live KB root, published while the yantao-kb plugin is mounted so
 * host-side consumers (the yantao-kb-controller Remote) share this one
 * configuration point instead of duplicating it. The root starts as the
 * settings-plane pointer when one is recorded (an imported legacy pointer
 * included), and otherwise as the config default; `setRoot` retargets the
 * whole host at a new root by writing the settings namespace, and an external
 * edit of that namespace retargets the live root through the watcher.
 */
export interface YantaoKbService {
  /** Resolved knowledge-base root directory. */
  readonly root: string
  /** True when the root comes from the settings plane (or an imported pointer) rather than the config default. */
  readonly configured: boolean
  /**
   * Retarget the live KB at `next` and persist it as the settings-plane pointer.
   * @param next - the new knowledge-base root directory (absolute).
   */
  setRoot(next: string): void
}

/**
 * The live root: the settings-plane pointer when there is one, the config
 * default otherwise, and always the one value every host-side consumer
 * reads. Persisting a new root is fire-and-forget — the in-process root is
 * already correct, and a failed write only costs the next boot.
 */
class LiveKbRoot implements YantaoKbService {
  constructor(
    private current: string,
    private persisted: boolean,
    private readonly persist: (next: string) => void,
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
    this.persist(next)
  }

  /** Adopt a root that was committed outside this object (settings write or import). */
  retarget(next: string): void {
    this.current = next
    this.persisted = true
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Resolved KB root, provided by the mounted yantao-kb plugin. */
    yantaoKb: YantaoKbService
  }
}

/**
 * Durable source for the `@`-mention injection: the composer inserts a
 * KB-relative path, and the pre-step hook hands the model the cited files'
 * content as one `recall`-form context message ahead of the turn.
 */
export interface YantaoKbMentionSource {
  readonly kind: 'yantao-kb'
  /** Cited KB files are background material for the turn. */
  readonly form: 'recall'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** KB `@`-mention material injected by the yantao-kb plugin. */
    'yantao-kb': YantaoKbMentionSource
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

/** Register the kb_ tools and publish the resolved KB root; disposal unregisters both. */
export function apply(ctx: Context, config: Config): void {
  // The KB pointer lives in the settings plane (ADR-0024 决定 3) as this
  // plugin's own volatile config field: the settings UI edits it through the
  // active profile's patch, Loader commits the change live, and this plugin
  // follows through `loader/volatile-update`. One-time import of the retired
  // `~/.dsh/yantao-kb.json` (ADR-0024 决定 2): capability states move into the
  // KB, and the legacy pointer seeds the patch exactly when the human has not
  // recorded one there yet.
  const importedRoot = importLegacyRootState()

  const persistRoot = (next: string): void => {
    void ctx.settings.update(name, { kbRoot: next }).catch((error: unknown) => {
      ctx.logger.warn(`yantao-kb: 无法持久化知识库根目录：${(error as Error).message}`)
    })
  }
  const initialRoot = config.kbRoot.get()
  // 显式配置压过一次性 legacy 导入：操作者已在 profile patch / 设置面钉了根，
  // 就不能再被 `~/.dsh/yantao-kb.json` 的旧指针顶掉（导入只在人类还没记录过时播种）。
  const explicit = initialRoot !== DEFAULT_KB_ROOT
  const liveRoot = new LiveKbRoot(
    explicit ? initialRoot : importedRoot ?? initialRoot,
    importedRoot !== undefined || explicit,
    persistRoot,
  )
  if (importedRoot !== undefined && !explicit) persistRoot(importedRoot)

  ctx.effect(
    () => ctx.provide('yantaoKb', liveRoot satisfies YantaoKbService),
    'yantao-kb: provide KB root service',
  )

  // An externally committed pointer (the settings UI, another workbench tab,
  // a hand edit of the profile patch) retargets the live root.
  ctx.on('loader/volatile-update', () => {
    const next = config.kbRoot.get()
    if (next !== liveRoot.root) liveRoot.retarget(next)
  })

  // The prompt-section layer (ADR-0022): yantao's domain disciplines as
  // named sections over dsh's registry, sourced from prompt/sections/*.md.
  // The filesystem discipline is dynamic (ADR-0042): `{{kbRoot}}` resolves
  // against the live root on every assembly.
  registerPromptSections(ctx)
  registerFilesystemSection(ctx, () => liveRoot.root)

  // The clock section: one date line re-evaluated per assembly, so the agent
  // can resolve relative dates («今晚») into calendar days.
  registerClockSection(ctx)

  // The dynamic section (ADR-0032 批次②): the global behavior memory rides
  // the system prompt, re-read from the KB on every assembly.
  registerBehaviorMemorySection(ctx, () => liveRoot.root)

  // The prompt-shortcuts section (ADR-0040 决定 5): the human's favorite slash
  // aliases, the agent-side expansion authority for every entry point.
  registerPromptShortcutsSection(ctx, () => liveRoot.root)

  // `@` mentions: the composer inserts a KB-relative path, and nothing else in
  // this profile tells the model what one is. Read the cited files and hand
  // the model their content as one context message ahead of the turn.
  ctx.on('agent/pre-step', async (event, next): Promise<PreStepDecision> => {
    // Gate on the claimed batch, not the downstream decision: the built-in
    // innermost `next` appends the runtime-context snapshot after the user's
    // gesture, and inner listeners (yantao-kb-controller's per-turn catalog /
    // notice) append theirs too — a decision-last check would see their
    // sources and silently drop the recall.
    const claimedLast = event.messages[event.messages.length - 1]
    if (claimedLast === undefined || claimedLast.source.kind !== 'user') return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const messages = decision.messages
    const text = claimedLast.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const cited = await readCitedEntries(liveRoot.root, kbMentions(text))
    if (cited.length === 0) return decision
    return {
      ...decision,
      messages: [...messages, createUserMessage({
        source: { kind: 'yantao-kb', form: 'recall' },
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
          notice: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `知识库已就绪：${value.kbRoot}\n新建 ${value.created.length} 项（${value.created.join('、') || '无'}）；`
          + `已存在 ${value.existing.length} 项${value.notice !== undefined ? `\n${value.notice}` : ''}`,
      }],
    },
    execute: () => initKb(liveRoot.root),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_create_entity',
    description:
      '创建实体笔记（type+name）：实体名转安全文件名，同名已存在则拒绝——后续补充走 kb_append_log/kb_write_state。'
      + '骨架取自 .dsh/yantao/templates/<type>.md（缺省内置模板）；「流水」区必存在，「状态」区以模板为准。'
      + 'relation/email 仅 person（relation 默认 subordinate）；date 仅 meeting（默认今天）。todo 是单例，不能用本工具创建。',
    parameters: {
      type: { ...CREATABLE_ENTITY_TYPE_PARAM, required: true },
      name: { type: 'string', required: true, description: '实体显示名，例如「dsh 学习」或「周会」' },
      relation: {
        type: 'string',
        enum: PERSON_RELATIONS,
        description: '人物与库主的关系（仅 person 使用）：self / subordinate / superior / peer / external',
      },
      email: {
        type: 'string',
        description: '人物的电子邮箱地址（仅 person 使用）；邮件分析用它把发件人匹配到这个人',
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
          notice: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已创建实体：${value.path}${value.notice !== undefined ? `\n${value.notice}` : ''}`,
      }],
    },
    execute: args => createEntity(liveRoot.root, args.type, args.name, {
      ...args.relation !== undefined ? { relation: args.relation } : {},
      ...args.email !== undefined ? { email: args.email } : {},
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
    name: 'kb_edit_section',
    description:
      '整体改写实体文件正文的任意『## 区段』（如 目标、下一步、标准、检视）：用 text 替换该区段的全部内容，'
      + '可写入多行 markdown，区段其余部分与 frontmatter 原样保留。'
      + '『流水』区只追加、拒绝改写——追加日志请用 kb_append_log；改写『状态』区用 kb_write_state 亦可。'
      + '区段锚点缺失或重复会报错而不是重建；todo 单例没有区段，不能用此工具。'
      + 'entity 形如 "project:dsh 学习"（也接受各类复数拼写或实体文件路径）。',
    parameters: {
      entity: { type: 'string', required: true, description: '实体定位："type:name"（如 "project:dsh 学习"）或实体文件路径' },
      section: { type: 'string', required: true, description: '区段锚点名，如 "目标" 或 "## 目标"' },
      text: { type: 'string', required: true, description: '新的区段正文（markdown）；留空表示清空该区段' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          section: { type: 'string', required: true },
          state: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已更新 ${value.path} 的『${value.section}』区：\n${value.state}`,
      }],
    },
    execute: args => editSection(liveRoot.root, args.entity, args.section, args.text),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_read_entity',
    description: '读取一个实体笔记的原文（frontmatter、『状态』区与『流水』区）。'
      + 'maxChars 只回尾部：实体的最新记录在『流水』末尾，长实体不必整份读入。',
    parameters: {
      type: { ...ENTITY_TYPE_PARAM, required: true },
      name: { type: 'string', required: true, description: '实体显示名（文件名，不含 .md）' },
      maxChars: { type: 'integer', description: '只回最后 N 字（从行首开始，省略的前文会标注）；省略=全文' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
          truncated: { type: 'boolean', description: '是否只回了尾部' },
          omittedChars: { type: 'integer', description: '被省略的前文字数' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.truncated === true
          ? `（已省略前 ${value.omittedChars ?? 0} 字，只回最后 ${value.content.length} 字；要全文就去掉 maxChars 再读一次）\n\n${value.content}`
          : value.content,
      }],
    },
    execute: args => readEntity(liveRoot.root, args.type, args.name, args.maxChars),
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
                // person 条目可能携带（core.ts 附给 person）；漏声明会让
                // additionalProperties:false 在存在带邮箱的人时拒掉全量列举
                email: { type: 'string' },
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
    name: 'kb_write_resource',
    description:
      '在 resources/ 下新建一个文本文件（可含尚不存在的子目录）：把 content 写入 path 指向的新文件。'
      + 'path 是知识库内路径，必须以 resources/ 开头（如 resources/报告/2026-09/周报.md）。'
      + '目标已存在时拒绝：resources/ 下的原始材料不覆盖、也不静默改名，请换一个名字。'
      + '本工具只做新建、不做编辑——修改已有资源请由人完成。',
    parameters: {
      path: { type: 'string', required: true, description: '知识库内目标路径，以 resources/ 开头（如 resources/报告/周报.md）' },
      content: { type: 'string', required: true, description: '文件的文本内容（UTF-8）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resource: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已新建资源：${value.resource}` }],
    },
    execute: args => writeResource(liveRoot.root, args.path, args.content),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_read_resource',
    description:
      '读取 resources/ 下的资源。path 是知识库内路径，必须以 resources/ 开头（如 resources/报告/2026-09/周报.md）。'
      + 'path 指向文件时返回其 UTF-8 全文；.pdf 自动抽取文本、.eml 自动解析为头部与正文（ADR-0046），'
      + '其余二进制文件（含 NUL 字节）会拒绝并报大小，不注入乱码。'
      + 'path 指向目录时返回递归清单（每项路径与字节大小，最多 100 项，超出标注 truncated）——'
      + '清单不带内容，看中哪个文件再逐个读取。目录超过百项时传 prefix 只回路径包含该子串的条目。',
    parameters: {
      path: { type: 'string', required: true, description: '知识库内资源路径，以 resources/ 开头（文件或目录）' },
      prefix: { type: 'string', description: '目录模式下的名称过滤（相对路径包含该子串，不区分大小写）；文件模式忽略' },
      latest: { type: 'boolean', description: '目录模式下先逐层下钻到「最新一期」子目录（名字日期优先，时间戳兜底）再列清单；用于「最新周报」这类不想关心目录名的场景' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['file', 'dir'], required: true },
          path: { type: 'string', required: true },
          content: { type: 'string' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                size: { type: 'number', required: true },
              },
            },
          },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'dir'
          ? [
            `目录 ${value.path} 共 ${value.entries?.length ?? 0} 项${value.truncated === true ? '（已截断，仅显示前 100 项）' : ''}：`,
            ...(value.entries ?? []).map(entry => `- ${entry.path}（${entry.size} 字节）`),
          ].join('\n')
          : value.content ?? '',
      }],
    },
    execute: args => readResource(liveRoot.root, args.path, args.prefix, args.latest === true),
  }))

  ctx.tools.register(defineTool({
    name: 'kb_propose_memory',
    description:
      '把这次任务中学到的经验提案为行为记忆，供人批准后沉淀（ADR-0044）。礼仪：'
      + '只有非显然的教训才值得提——踩过的坑、绕过办法、环境怪癖、用户给出的纠正；'
      + '平淡顺利的运行不要提；通常在任务收尾时集中提。'
      + '提案不立即生效：进入提案队列等待人批准，批准后才成为行为记忆；'
      + `队列每作用域最多 ${PROPOSAL_PENDING_SOFT_CAP} 条，满了会拒绝。`
      + 'scope 是 global（工作台级经验）或能力名（该能力的专属经验）；'
      + '与现有记忆或在途提案文字重复时会被拒绝。'
      + 'source 可选，注明经验来源（如「会话」或一次运行的摘要），帮助人判断是否采纳。',
    parameters: {
      scope: { type: 'string', required: true, description: '记忆作用域：global 或能力名（如 mail-analysis）' },
      text: { type: 'string', required: true, description: '凝练的经验正文，一句话说清规则本身' },
      source: { type: 'string', description: '可选来源注记，如「会话」或「运行 mail-analysis 失败：退出码 1」' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string', required: true },
          pending: { type: 'number', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `已记入提案队列（作用域 ${value.scope}，待批准 ${value.pending} 条）：${args.text}`
          + '\n提案尚未生效——人批准后才沉淀为行为记忆。',
      }],
    },
    execute: (args) => {
      const scope = appendMemoryProposal(liveRoot.root, args.scope, args.text, args.source)
      return scope.then(queue => ({ scope: queue.scope, pending: queue.entries.length }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kb_propose_skill_rewrite',
    description:
      '提名改写一个已注册能力目录里的文本文件（ADR-0054）——包括能力的 SKILL.md 说明书本身。礼仪：'
      + '提名的是改进，不是重写——错字、失效步骤、缺失的注意事项值得提；推倒重来不值得；'
      + '一次任务里的顺手小修通常不值得打断人，攒到收尾或有实据时再提。'
      + '提名不立即生效：带着 original + new 的 diff 信封进入提议队列，人批准后由工作台写回；'
      + '批准即刻生效（下一次调用就读到新说明书），无需重启。'
      + 'SKILL.md frontmatter 里的 metadata.yantao.version 不归你管——批准时会自动还原为原值，改了也白改。'
      + `运行产物目录（${[...CAPABILITY_ARTIFACT_DIRS].map(dir => `${dir}/`).join('、')}）与二进制文件不接受提名。`
      + 'original 必须逐字取自你最近一次实读的内容：可以是全文，也可以是文件中唯一出现的一段原文——改大脚本时提名涉及的段落即可，不必背全文；批准时按这段原文在文件中唯一匹配替换，段落消失（文件被改动）或不唯一都会被拒绝，重读后再提。'
      + `队列未决策提议最多 ${INBOX_PENDING_SOFT_CAP} 条，满了会拒绝。`,
    parameters: {
      name: { type: 'string', required: true, description: '能力名（中央路由 .dsh/skills/yantao.json 里的键）' },
      file: { type: 'string', required: true, description: '技能目录内的相对路径（如 SKILL.md 或 scripts/run.py）' },
      original: { type: 'string', required: true, description: '文件的现内容——你读到的原文，作为 diff 左侧' },
      new: { type: 'string', required: true, description: '提议的新内容，作为 diff 右侧' },
      why: { type: 'string', required: true, description: '为什么值得改，一句话说服人' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pending: { type: 'number', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `已提名改写 ${args.name}/${args.file}（待批准提议共 ${value.pending} 条）：${args.why}`
          + '\n提名尚未生效——人批准后才写回；批准即刻可用。',
      }],
    },
    execute: args => proposeSkillRewrite(liveRoot.root, args),
  }))
}

// Host-side consumers (the yantao-kb-controller Remote) reuse the filesystem
// operations and path confinement through these public re-exports; the
// plugin above remains the model-facing shell over the same operations.
export { appendLog, createEntity, editSection, initKb, listEntities, readEntity, readResource, registerResource, registerResourceContent, resolveEntityPath, setEntityArchived, writeResource, writeState } from './core.ts'
export type { InitKbResult, ListedEntity, ListedResource, ReadResourceResult } from './core.ts'
export { entityDisplayPath, isEntityLocatorPrefix, resolveWithinKb, sanitizeFileName, todayStamp } from './paths.ts'
export {
  capabilityStatePath, importLegacyRootState, readCapabilityRecord, readCapabilityState,
  recordCapabilityRun, writeCapabilityState, writeMailWatermark,
} from './root-store.ts'
export type { CapabilityRecord } from './root-store.ts'
export { appendToLogSection, logBullet, replaceSection, replaceStateSection } from './splice.ts'
export { locateUniqueSpan } from './skill-rewrite.ts'
export type { SpanLocate } from './skill-rewrite.ts'
export {
  appendMemoryEntry, assertMemoryScope, listMemoryScopes, MEMORY_GLOBAL_SCOPE, MEMORY_SCOPE_SOFT_CAP,
  memoryDisplayPath, memoryEntryId, memoryEntryLine, parseMemoryFile, readGlobalMemoryEntries,
  readMemoryScope, removeMemoryEntry, renderCapabilityMemoryBlock, renderGlobalMemorySection,
  serializeMemoryFile,
} from './memory.ts'
export type { MemoryEntry, MemoryFile, MemoryScope } from './memory.ts'
export {
  appendMemoryProposal, listProposalScopes, parseProposalFile, PROPOSAL_PENDING_SOFT_CAP,
  proposalDisplayPath, proposalEntryLine, readProposalScope, removeMemoryProposalByText,
  serializeProposalFile,
} from './proposals.ts'
export type { MemoryProposal, MemoryProposalFile, MemoryProposalScope } from './proposals.ts'
export {
  normalizePromptShortcuts, PROMPT_SHORTCUTS_DISPLAY_PATH, PROMPT_SHORTCUTS_SOFT_CAP,
  readPromptShortcuts, renderPromptShortcutsSection, writePromptShortcuts,
} from './prompt-shortcuts.ts'
export type { PromptShortcut, PromptShortcutFile } from './prompt-shortcuts.ts'
export {
  cronShapeError, markSchedule, newScheduleId, normalizeSchedules, readSchedules,
  SCHEDULES_DISPLAY_PATH, SCHEDULES_SOFT_CAP, writeSchedules,
} from './schedules.ts'
export type { Schedule, ScheduleFile, ScheduleStampsPatch } from './schedules.ts'
export { cronMatchesAt, cronNextAfter, parseCron } from './cron.ts'
export type { CronSchedule } from './cron.ts'
export {
  markInstruction, newInstructionId, newWorkspaceId, normalizeWorkspaces, readWorkspaces,
  setInstructionSchedule, WORKSPACES_DISPLAY_PATH, WORKSPACES_SOFT_CAP, writeWorkspaces,
} from './workspaces.ts'
export type { InstructionSchedulePatch, InstructionStampsPatch, WorkspaceDef, WorkspaceFile, WorkspaceInstruction } from './workspaces.ts'
export {
  appendScheduleRun, appendWorkspaceRun, clearWorkspaceRuns, deleteWorkspaceRun, finalizeInterruptedRuns, newRunId, normalizeWorkspaceRuns,
  patchWorkspaceRun, readWorkspaceRuns, RUN_HISTORY_CAP, runLogPath, WORKSPACE_RUN_LOG_DIR,
  WORKSPACE_RUNS_DISPLAY_PATH,
} from './workspace-runs.ts'
export type { ScheduleRunSeed, WorkspaceRun, WorkspaceRunPatch, WorkspaceRunSeed, WorkspaceRunStep, WorkspaceRunsFile } from './workspace-runs.ts'
export {
  annotateProposalInboxEntry, enqueueProposal, INBOX_PENDING_SOFT_CAP, newProposalInboxId, normalizeInboxEntries,
  PROPOSAL_INBOX_DISPLAY_PATH, readProposalInbox, resolveProposalInboxEntry, writeProposalInbox,
} from './proposal-inbox.ts'
export type { InboxAnnotation, InboxEnqueueInput, ProposalApplyRecord, ProposalInboxFile, QueuedProposal } from './proposal-inbox.ts'
export { linksOf, linkGraphOf, resolveWikiLink, wikilinks } from './links.ts'
export type { KbGraph, KbGraphEdge, KbLinkSource, KbLinkTarget, KbLinks, WikiLink } from './links.ts'
export { relationGraphOf } from './relations.ts'
export type { KbRelationEdge, KbRelationGraph, RelationKind } from './relations.ts'
export { extractPdfText, parseEml, renderEmlText } from './resource-content.ts'
export type { EmlAttachment, EmlParsed } from './resource-content.ts'
// The prompt-section layer's vocabulary, for host-side consumers that price
// the yantao injection (the controller's context meter): the section roster
// and its text loader are the exact source the plugin registers from.
export { BEHAVIOR_MEMORY_SECTION, CLOCK_SECTION, FILESYSTEM_SECTION, PROMPT_SHORTCUTS_SECTION, loadSectionText, renderClockLine, YANTAO_SECTIONS } from './sections.ts'
export type { YantaoSection } from './sections.ts'
export { parseFrontmatter } from './frontmatter.ts'
export type { Frontmatter } from './frontmatter.ts'
export {
  CAPABILITY_ARTIFACT_DIRS, CapabilityFileError, confineCapabilityFile, readCapabilityTextFile,
} from './capability-file.ts'
export type { CapabilityFileRejection } from './capability-file.ts'
export { addTodo, parseTodoFile, removeTodo, serializeTodoFile, toggleTodo, updateTodo } from './todo.ts'
export type { TodoDraft, TodoFile, TodoItem, TodoPatch } from './todo.ts'
export { entityFileContent, KB_README, todoFileContent } from './templates.ts'
export type { EntityTemplateOptions } from './templates.ts'
export { ENTITY_DIRS, ENTITY_TYPES, KbError, PERSON_RELATIONS, SINGLETON_FILES } from './types.ts'
export type { EntityType, PersonRelation } from './types.ts'
