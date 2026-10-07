/**
 * The yantaoKb Remote controller: the workbench UI's direct KB channel.
 * `intakeTree` shapes the input side (resources, todos) and
 * `workspaceTree` the workspace side (projects, areas, people, meetings);
 * `read`/`write` address single files by KB-relative path, always confined
 * one configuration point, no duplicated config. `root`/`setRoot` answer and
 * choose that root — the service persists the choice in the settings plane
 * (ADR-0024) — and `createEntity`
 * files a new note from the KB's canonical template; `registerResource` is the
 * drag-and-drop intake (ADR-0020): a dropped file is copied into `resources/`.
 * The capability surface (ADR-0021) is `capabilityList`/`capabilityRun`/
 * `capabilityCreate`/`capabilityAdopt`/`capabilityRegister` (ADR-0025) —
 * plus `capabilityDeclaration` (ADR-0043 决定 7), the parsed-declaration
 * introspection the 能力 tab renders: a
 * capability is a dsh skill directory declaring a host entry — in a
 * `yantao.json` sidecar, or in the central routing file
 * `.dsh/skills/yantao.json` that registration writes (ADR-0025 落地注记二) —
 * and this controller seeds the shipped
 * ones, lists them, runs them, writes their artifacts, and persists their
 * state. The memory store (ADR-0032) is `memoryList`/`memoryAdd`/`memoryDelete`:
 * behavior rules as markdown files under `.dsh/yantao/memory/`, written only
 * through the human channel; the proposal queue (ADR-0044) is
 * `memoryProposalList`/`memoryProposalApprove`/`memoryProposalDiscard` — the
 * holding pen an agent's `kb_propose_memory` fills and only a human drains.
 * The UI is the human
 * channel, so `write` is a full-file write; the ADR-0004 trust boundary
 * binds only the agent's kb_ tools, never this surface.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller
 */

import { mkdir, readdir, readFile, rm, stat, writeFile, cp } from 'node:fs/promises'
import { existsSync, type Dirent } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SkillDefinition, SkillInvocationSource, SkillSummary } from '@deepseek-ai/dsh-skill'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { createUserMessage, type TextBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  createEntity, entityDisplayPath, initKb, KbError, linkGraphOf, linksOf, listEntities, parseEml, parseFrontmatter,
  parseTodoFile, PERSON_RELATIONS, readCapabilityRecord, readCapabilityState,
  registerResourceContent, relationGraphOf, resolveWithinKb, serializeTodoFile, setEntityArchived, todayStamp,
  writeCapabilityState, writeMailWatermark,
  appendMemoryEntry, listMemoryScopes, readMemoryScope, removeMemoryEntry, renderCapabilityMemoryBlock,
  listProposalScopes, proposalDisplayPath, removeMemoryProposalByText,
  loadSectionText, renderGlobalMemorySection, readGlobalMemoryEntries, YANTAO_SECTIONS,
  readPromptShortcuts, writePromptShortcuts, PROMPT_SHORTCUTS_DISPLAY_PATH,
  readSchedules, writeSchedules, markSchedule, SCHEDULES_DISPLAY_PATH,
  enqueueProposal, readProposalInbox, resolveProposalInboxEntry, PROPOSAL_INBOX_DISPLAY_PATH,
} from '@deepseek-ai/dsh-yantao-kb'
import type { EntityType } from '@deepseek-ai/dsh-yantao-kb'
import { ensureBuiltinCapabilities } from './capability/builtin.ts'
import { CAPABILITY_HINTS, CapabilityError, entryCandidatesOf, manifestOf, resolveEntry, runCapability } from './capability/run.ts'
import type { CapabilityInvoker, CapabilityManifest } from './capability/run.ts'
import { CAPABILITY_ENVIRONMENT_NOTE, execCapabilityScript } from './capability/exec.ts'
import { addRoutes, readRoutes, routedSkill, ROUTES_PATH } from './capability/routing.ts'
import type { CapabilityRoute } from './capability/routing.ts'
import { hasScheme, isOpenable, openWithDesktop } from './open.ts'
import { KbRevision } from './watch.ts'
import type {
  KbCapabilityAdoptArgs,
  KbCapabilityAdoptResult,
  KbCreateEntityArgs,
  KbCreateEntityResult,
  KbDeleteResourceResult,
  KbCapabilityCreateArgs,
  KbCapabilityCreateResult,
  KbCapabilityDeclarationArgs,
  KbCapabilityDeclarationResult,
  KbCapabilityListResult,
  KbCapabilityRegisterArgs,
  KbCapabilityRegisterResult,
  KbCapabilityResolvedDeclaration,
  KbCapabilityRouteAnswer,
  KbCapabilityRunArgs,
  KbCapabilityRunResult,
  KbCapabilitySidecarAnswer,
  KbCapabilitySummary,
  KbFileContent,
  KbGraphResult,
  KbLinksResult,
  KbMailMarkReadArgs,
  KbMailMarkReadResult,
  KbMemoryAddArgs,
  KbMemoryAddResult,
  KbMemoryDeleteArgs,
  KbMemoryDeleteResult,
  KbPromptShortcutListResult,
  KbPromptShortcutSaveArgs,
  KbPromptShortcutSaveResult,
  KbProposalInboxEnqueueArgs,
  KbProposalInboxEnqueueResult,
  KbProposalInboxListResult,
  KbProposalInboxResolveArgs,
  KbProposalInboxResolveResult,
  KbQueuedProposal,
  KbRelationGraphResult,
  KbScheduleListResult,
  KbScheduleMarkArgs,
  KbScheduleMarkResult,
  KbScheduleSaveArgs,
  KbScheduleSaveResult,
  KbMemoryListResult,
  KbMemoryProposalApproveArgs,
  KbMemoryProposalApproveResult,
  KbMemoryProposalDiscardArgs,
  KbMemoryProposalDiscardResult,
  KbMemoryProposalListResult,
  KbOpenExternalResult,
  KbPromptInjectionResult,
  KbRegisterResourceArgs,
  KbResourceBinary,
  KbResourceView,
  KbRegisterResourceResult,
  KbRevisionResult,
  KbRootResult,
  KbSetEntityArchivedResult,
  KbSetRelationArgs,
  KbSetRelationResult,
  KbSetRootResult,
  KbTodosResult,
  KbTree,
  KbTreeFile,
  KbTreeSection,
  KbUnregisteredSkill,
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
  { id: 'todos', type: 'todo' },
] as const satisfies readonly { id: KbTreeSection['id']; type: EntityType }[]

/** Entity sections of the workspace tree, in display order, mapped to their entity type. */
const WORKSPACE_ENTITY_SECTIONS = [
  { id: 'projects', type: 'project' },
  { id: 'areas', type: 'area' },
  { id: 'people', type: 'person' },
  { id: 'meetings', type: 'meeting' },
] as const satisfies readonly { id: KbTreeSection['id']; type: EntityType }[]

/** KB-relative path of the todo singleton (ADR-0018); a singleton kind resolves whatever its name. */
const TODOS_PATH = entityDisplayPath('todo', 'todos')

/**
 * Image extensions `readResourceBinary` serves (ADR-0048 决定 3), mapped to
 * their MIME types. The reading view's image pathway is the sole caller;
 * bounding the answer to pictures keeps the RPC from becoming a general
 * binary read.
 */
const IMAGE_MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
])

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

/** Read a directory's entries, answering an empty list when the directory is absent. */
async function readEntries(dir: string): Promise<Dirent[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries
}

/**
 * Render the agent-facing capability catalog (ADR-0023 决定 5). The same rows
 * ride the message source as `entries`, so the workbench renders the
 * injection structurally; this prose is what the model reads.
 */
function renderCapabilityCatalog(entries: readonly { name: string; description: string }[]): string {
  return '当前对 agent 开放的知识库能力（用 kb_run_capability 调用，name 取自下表；'
    + '指令型能力返回指令正文，照其行事）：\n'
    + entries.map(entry => `- ${entry.name}: ${entry.description}`).join('\n')
}

/** Re-throw a capability-declaration failure as the Remote channel's bad-manifest error. */
function badManifestError(error: unknown): RemoteError {
  const failure = error instanceof CapabilityError ? error : undefined
  return new RemoteError(
    'yantao-kb/capability',
    failure?.message ?? '能力声明无效。',
    { kind: failure?.kind ?? 'bad-manifest', hint: failure?.hint ?? CAPABILITY_HINTS['bad-manifest'] },
    { cause: error },
  )
}

/**
 * The agent gate's shared refusal shapes (ADR-0043): one code, the kind/hint
 * pair following the gate that closed, the message naming the name and — for
 * not-invocable — the channel whose `invocation` stayed shut.
 */
function capabilityNotFound(name: string): RemoteError {
  return new RemoteError(
    'yantao-kb/capability',
    `找不到能力「${name}」。`,
    { kind: 'not-found', hint: CAPABILITY_HINTS['not-found'] },
  )
}

/** The declaration location is stated bare — the template owns the phrasing around it, so callers never encode separators. */
function capabilityNotInvocable(name: string, channel: string): RemoteError {
  return new RemoteError(
    'yantao-kb/capability',
    `能力「${name}」没有对 agent 开放（声明于 ${channel}，未声明 "invocation": ["agent"]）。`,
    { kind: 'not-invocable', hint: CAPABILITY_HINTS['not-invocable'] },
  )
}

/** The stated problem for a failed declaration: the CapabilityError's own message, else the stringified cause. */
function capabilityProblemText(error: unknown): string {
  return error instanceof CapabilityError ? error.message : String(error)
}

/**
 * The dual gate's verdict (ADR-0043): which declaration channel answers for
 * one capability name. A valid sidecar wins; the central routing file
 * answers otherwise. The failure registers stay separable — a broken sidecar
 * is not an absent one, and a broken routing file is carried alongside so
 * the run paths can rethrow it while the declaration view reports it. Every
 * variant except `routed` (which is itself the route) carries the routing
 * channel's answer, so callers never re-read the routing file to see it.
 */
type CapabilityResolution =
  | {
    /** The skill's own declaration resolved: the sidecar channel wins. */
    readonly channel: 'declared'
    readonly definition: SkillDefinition
    readonly manifest: CapabilityManifest
    /** The sidecar's raw text, when the directory carried a `yantao.json`. */
    readonly raw?: string
    /** The central route, carried for introspection; the declared channel wins regardless. */
    readonly route?: CapabilityRoute
    /** Why the routing file itself could not be read, when it is broken. */
    readonly routeError?: unknown
  }
  | {
    /** No KB-sidecar declaration; the central route claims the name. */
    readonly channel: 'routed'
    readonly route: CapabilityRoute
    /** Structurally impossible here — the route was read to reach this verdict — but kept so the routing answer stays uniform. */
    readonly routeError?: unknown
  }
  | {
    /** The sidecar is missing or malformed; the route may still claim the name. */
    readonly channel: 'broken-sidecar'
    readonly definition: SkillDefinition
    readonly raw?: string
    /** Why the sidecar failed to declare. */
    readonly error: unknown
    /** The central route, when it claims the name despite the broken sidecar. */
    readonly route?: CapabilityRoute
    /** Why the routing file itself could not be read, when it is broken. */
    readonly routeError?: unknown
  }
  | {
    /** Neither channel answers for the name. */
    readonly channel: 'absent'
    /** Never populated on this variant; present so the routing answer reads uniformly across variants. */
    readonly route?: CapabilityRoute
    /** Why the routing file itself could not be read, when it is broken. */
    readonly routeError?: unknown
  }

/**
 * The resolved form of one valid capability declaration (ADR-0043 决定 7):
 * instruction or script, the declared fields flat, and — for a script — the
 * entry's candidate absolute paths (skill directory first, then the `.dsh/`
 * adapter plane) and the first one that exists on disk.
 */
function resolvedDeclarationOf(
  definition: SkillDefinition,
  manifest: CapabilityManifest,
  dshRoot: string,
): KbCapabilityResolvedDeclaration {
  const metadata = definition.metadata as { version?: unknown } | undefined
  const version = typeof metadata?.version === 'string' || typeof metadata?.version === 'number'
    ? String(metadata.version)
    : undefined
  const shared = {
    invocation: manifest.invocation,
    ...version !== undefined ? { version } : {},
    ...manifest.appliesTo !== undefined ? { appliesTo: manifest.appliesTo } : {},
  }
  if (manifest.entry === undefined || definition.resourceBase?.kind !== 'directory') {
    return { kind: 'instruction', ...shared }
  }
  const candidates = entryCandidatesOf(definition.resourceBase.path, manifest.entry, dshRoot)
  const entryPath = candidates.find(candidate => existsSync(candidate))
  return {
    kind: 'script',
    entry: manifest.entry,
    ...manifest.runtime !== undefined ? { runtime: manifest.runtime } : {},
    ...shared,
    entryCandidates: candidates,
    ...entryPath !== undefined ? { entryPath } : {},
  }
}

/**
 * `/name` at the very start of a message — the yantao `/xxx` gesture
 * (ADR-0025 决定 3). Unlike upstream tool-skill's anywhere-in-the-sentence
 * scan, only the opening token counts: yantao's gesture means "run this
 * capability on what follows", not "mention this skill". Built-in commands
 * (`/compact` …) never reach here — the command registry resolves them
 * client-side before a line becomes a prompt, so it wins by construction.
 */
const CAPABILITY_GESTURE = /^\/([a-zA-Z0-9][a-zA-Z0-9._-]*)(?=\s|$)/

/** UI-direct KB operations over the `yantaoKb` Remote namespace. */
export class YantaoKbController extends TypertRemoteService {
  /**
   * The one KB root, provided by the mounted yantao-kb plugin; `skills`
   * resolves capability directories (ADR-0021); `tools` carries
   * `kb_run_capability` (ADR-0023).
   */
  static inject = ['yantaoKb', 'skills', 'tools']

  /** The KB's change counter (ADR-0017); pointed at the live root on each poll. */
  private readonly revisionWatch = new KbRevision()

  constructor(ctx: Context) {
    super(ctx, 'yantaoKbController', { namespace: 'yantaoKb' })
    this.ctx.effect(() => () => {
      this.revisionWatch.close()
    })
    // The agent-facing capability catalog (ADR-0023 决定 5): on a user-prompted
    // step, append one message listing the capabilities declared
    // `"invocation": ["agent", …]`. Nothing is hard-coded in any prompt —
    // capabilities are runtime-creatable, so the catalog is re-derived per
    // turn; with no agent-invocable capability the turn is untouched.
    // The `/xxx` gesture (ADR-0025 决定 3) rides the same hook: a message
    // opening with `/name` naming an instruction-type, human-invocable
    // capability injects its SKILL.md body as `skill-invocation` instructions
    // (upstream tool-skill's dual-message shape). The catalog is background
    // and lands first; the instructions the model must act on land last.
    this.ctx.effect(() => this.ctx.on('agent/pre-step', async (_event, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const messages = decision.messages
      // The pending prompt is the turn's last user message, not literally the
      // last message: on a session's first turn the system-prompt sandbox
      // snapshot (a plugin message) lands *after* the user's gesture and used
      // to swallow both the catalog and the `/xxx` injection. Skip trailing
      // plugin messages; any other kind (assistant, tool) after the user
      // spoke means the gesture is no longer the pending prompt.
      let last: UserMessage | undefined
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message === undefined) return decision
        if (message.source.kind === 'user') { last = message; break }
        if (message.source.kind !== 'plugin') return decision
      }
      if (last === undefined) return decision
      const injections: UserMessage[] = []
      const entries = await this.agentCapabilityCatalog()
      if (entries.length > 0) {
        injections.push(createUserMessage({
          source: {
            kind: 'plugin', plugin: 'yantao-kb-controller', form: 'catalog', entries,
          },
          content: [{ type: 'text', text: renderCapabilityCatalog(entries) }],
        }))
      }
      const invocation = await this.skillInvocationOf(last)
      if (invocation !== undefined) injections.push(invocation)
      if (injections.length === 0) return decision
      return { ...decision, messages: [...messages, ...injections] }
    }))
    this.ctx.tools.register(defineTool({
      name: 'kb_run_capability',
      description:
        '运行一个能力（capability）。可用能力以每轮注入的能力目录为准——目录里没有的不要猜。'
        + '能力是人安装并审定过的：普通能力执行其入口脚本（JSON stdin/stdout 子进程契约），'
        + '指令型能力返回其 SKILL.md 指令正文，你按指令行事。'
        + '只有声明了 "invocation": ["agent"] 的能力才能这样调用，其余会报 not-invocable。'
        + '返回末尾的【行为记忆·宿主转交】块是人批规则，可信且须遵守。',
      parameters: {
        name: { type: 'string', required: true, description: '能力名，取自注入的能力目录' },
        input: { type: 'object', additionalProperties: true, description: '交给能力的输入，按目录中该能力的说明构造；无要求时省略' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            runAt: { type: 'string', required: true },
            result: { type: 'json' },
            content: { type: 'string' },
            memory: { type: 'string' },
            artifacts: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: (value.content !== undefined
            ? `能力「${value.name}」是指令型，以下是它的指令正文：\n\n${CAPABILITY_ENVIRONMENT_NOTE}\n\n${value.content}`
            : `能力「${value.name}」已运行（${value.runAt}）`
              + (value.artifacts.length > 0 ? `，产物：${value.artifacts.join('、')}` : '')
              + '。'
              + (value.result !== undefined ? `\n结果：${JSON.stringify(value.result)}` : ''))
            + (value.memory !== undefined ? `\n\n${value.memory}` : ''),
        }],
      },
      execute: async ({ name, input }) => {
        const answer = await this.runByName(name, input, 'agent')
        // The wire schema declares a mutable artifacts array; the internal
        // result keeps it readonly. The exec envelope (ADR-0044 决定 6)
        // rides the human channel only — the agent sees the run's answer,
        // not the distill gesture's raw material.
        return {
          name: answer.name,
          runAt: answer.runAt,
          ...(answer.result !== undefined ? { result: answer.result } : {}),
          ...(answer.content !== undefined ? { content: answer.content } : {}),
          ...(answer.memory !== undefined ? { memory: answer.memory } : {}),
          artifacts: [...answer.artifacts],
        }
      },
    }))
    // The execution bridge (ADR-0043 决定 2, 路线二): run a script inside an
    // installed capability's own directory — the channel for an instruction
    // capability's mid-task "执行 python foo.py" steps and for a
    // capability's own CLI. cwd is pinned to the capability's skill
    // directory; the command text is not reviewed — installation is
    // authorization (ADR-0021), the directory is the only limit.
    this.ctx.tools.register(defineTool({
      name: 'kb_exec_capability_script',
      description:
        '在已安装能力的技能目录内执行一段脚本（ADR-0043 执行桥）。'
        + '用途：技能指令里「执行 python xxx」这类中途步骤，或直接运行能力自带的命令行。'
        + 'cwd 锁定该能力的目录（<知识库>/.dsh/skills/<name>，越出即拒绝）；命令本身不做内容审查——安装即授权。'
        + '信封经 KB_ROOT、CAPABILITY_NAME、CAPABILITY_CHANNEL=agent 环境变量与 stdin 的 JSON 送达，脚本可两通道复用。'
        + '能力的声明式入口调用仍走 kb_run_capability，两工具分工。',
      parameters: {
        name: { type: 'string', required: true, description: '能力名，取自注入的能力目录；必须对 agent 开放' },
        command: { type: 'string', required: true, description: '在该能力目录内经平台 shell 执行的命令行' },
        input: { type: 'string', description: '交给脚本的输入文本，装入 stdin 信封的 input 字段；无要求时省略' },
        timeoutMs: { type: 'integer', description: '超时毫秒数，超时杀进程；缺省 120000' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
            stdout: { type: 'string', required: true },
            stderr: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `脚本执行${value.ok ? '完成' : '未成功'}（退出码 ${value.exitCode ?? '无'}）`
            + (value.stdout === '' ? '' : `\nstdout：\n${value.stdout}`)
            + (value.stderr === '' ? '' : `\nstderr：\n${value.stderr}`),
        }],
      },
      execute: async ({ name, command, input, timeoutMs }) => {
        const skillsRoot = join(this.kbRoot, '.dsh', 'skills')
        const directory = await this.agentCapabilityDirectory(name)
        try {
          return await execCapabilityScript({
            name,
            skillsRoot,
            directory,
            command,
            kbRoot: this.kbRoot,
            ...input !== undefined ? { input } : {},
            ...timeoutMs !== undefined ? { timeoutMs } : {},
          })
        } catch (error: unknown) {
          throw badManifestError(error)
        }
      },
    }))
  }

  /** The one KB root, read per call so a re-chosen root takes effect at once. */
  private get kbRoot(): string {
    return this.ctx.yantaoKb.root
  }

  /**
   * The single-source rule (ADR-0024 决定 4): yantao only recognizes skills
   * whose directory sits under the KB's own `.dsh/skills/`. The skill
   * registry also discovers `~/.dsh/skills` and the nearest project's —
   * those belong to dsh, not to this KB, and a same-named one must not
   * shadow what the human installed in their KB.
   */
  private isKbSkill(skill: Pick<SkillSummary, 'resourceBase'>): boolean {
    const base = skill.resourceBase
    if (base?.kind !== 'directory') return false
    const root = resolve(this.kbRoot, '.dsh', 'skills')
    const directory = resolve(base.path)
    return directory === root || directory.startsWith(root + sep)
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
   * The intake side of the KB: resources and the todo singleton.
   * Every section is present even when its directory is absent or empty.
   * @returns the two intake sections in display order; a resource row pairs its companion note when one exists.
   */
  @Remote('intakeTree')
  async intakeTree(): Promise<KbTree> {
    return { sections: [await this.resourceSection(), ...await this.entitySections(INTAKE_ENTITY_SECTIONS)] }
  }

  /**
   * The workspace side of the KB: projects, areas, people, meetings.
   * @returns the four workspace sections in display order, entity rows carrying archive and relation flags.
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
   * can never be mistaken for one another on screen. The walk is recursive —
   * `kb_write_resource` may file resources into subdirectories — and a
   * nested file's display name is its path relative to `resources/`, so the
   * directory stays visible in the flat rail. Shadow-note pairing remains a
   * same-directory affair: `报告/录音.m4a` pairs with `报告/录音.m4a.md`.
   */
  private async resourceSection(): Promise<KbTreeSection> {
    const files: KbTreeFile[] = []
    const walk = async (relative: string): Promise<void> => {
      const entries = await readEntries(join(this.kbRoot, 'resources', relative))
      const prefix = relative === '' ? '' : `${relative}/`
      const names = new Set(entries.map(entry => entry.name))
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(relative === '' ? entry.name : `${relative}/${entry.name}`)
          continue
        }
        if (!entry.isFile()) continue
        const name = entry.name
        const display = `${prefix}${name}`
        if (!name.endsWith('.md')) {
          files.push({
            name: display,
            path: `resources/${display}`,
            ...names.has(`${name}.md`) ? { notePath: `resources/${display}.md` } : {},
          })
          continue
        }
        // A note with its original beside it is that original's shadow, not a row.
        if (names.has(name.slice(0, -'.md'.length))) continue
        files.push({ name: display, path: `resources/${display}` })
      }
    }
    await walk('')
    return { id: 'resources', files }
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
          ...entity.email !== undefined ? { email: entity.email } : {},
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
   * pdf row. A NUL byte is the cheapest reliable marker: every format ADR-0020
   * classifies as binary carries one, while no note does. A binary file is
   * refused instead.
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
   * The human render view of one read-only file (ADR-0046 决定 3): the
   * workbench's `ReadOnlyFile` picks its renderer from the answer's `kind`
   * instead of sniffing extensions again client-side. `.pdf` answers base64
   * bytes (the client turns them into a Blob URL for the built-in PDFium
   * viewer), `.html` its raw text (the client sandboxes it), `.eml` the
   * parsed mail (headline fields, bodies, attachment listing — never
   * attachment content), everything else plain text with the same NUL
   * refusal `read` has. The agent's read plane transpiles `.pdf`/`.eml`
   * through the same kernel functions (`@deepseek-ai/dsh-yantao-kb`'s
   * resource-content), so both faces agree on what a file "says".
   * @param path - KB-relative path with forward slashes.
   * @returns the discriminated render view.
   */
  @Remote('readResourceView')
  async readResourceView(path: string): Promise<KbResourceView> {
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
    const lower = path.toLowerCase()
    if (lower.endsWith('.pdf')) {
      return { kind: 'pdf', path, base64: bytes.toString('base64'), size: bytes.length }
    }
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      if (bytes.includes(0)) {
        throw new RemoteError('yantao-kb/binary', `「${path}」是二进制文件，工作台不直接预览原文。`, { path })
      }
      return { kind: 'html', path, content: bytes.toString('utf8') }
    }
    if (lower.endsWith('.eml')) {
      try {
        const mail = await parseEml(bytes)
        return { kind: 'eml', path, ...mail }
      } catch (error) {
        throw new RemoteError('yantao-kb/binary', `「${path}」解析失败：${(error as Error).message}`, { path }, { cause: error })
      }
    }
    if (bytes.includes(0)) {
      throw new RemoteError(
        'yantao-kb/binary',
        `「${path}」是二进制文件，工作台不直接预览原文。`,
        { path },
      )
    }
    return { kind: 'text', path, content: bytes.toString('utf8') }
  }

  /**
   * One image's complete bytes for the reading view (ADR-0048 决定 3): the
   * client turns the answer into a Blob URL for an `<img src>` — the same
   * base64-over-RPC pattern `readResourceView` established for PDFs (its
   * 决定 4 explains why no HTTP byte route exists). Image extensions only:
   * the reading view's image pathway is the sole caller, and bounding the
   * answer to pictures keeps this RPC from becoming a general binary read.
   * @param path - KB-relative path with forward slashes.
   * @returns the image's MIME type and base64 bytes.
   */
  @Remote('readResourceBinary')
  async readResourceBinary(path: string): Promise<KbResourceBinary> {
    const mime = IMAGE_MIME_BY_EXTENSION.get(path.slice(path.lastIndexOf('.')).toLowerCase())
    if (mime === undefined) {
      throw new RemoteError('yantao-kb/rejected', `「${path}」不是受支持的图片格式。`, { path })
    }
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
    return { path, mime, base64: bytes.toString('base64'), size: bytes.length }
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
   * The whole KB's `[[…]]` link graph in one payload (ADR-0035): every entity
   * file as a node, every link as an edge with its resolution. The scan lives
   * here for the same reason `links` does — it reads every entity note — and
   * the 实体校验 gesture consumes it for its deterministic pre-scan (orphans,
   * broken links); a future related-entities panel is its natural second
   * consumer.
   * @returns every entity path plus every resolved-or-not edge.
   */
  @Remote('graph')
  async graph(): Promise<KbGraphResult> {
    return linkGraphOf(this.kbRoot)
  }

  /**
   * The whole KB's typed relation graph (ADR-0049): the three relations the
   * 图谱 tab draws — person–project, area–project (the project frontmatter
   * `areas` list included), person–person — as one payload. Edges touching
   * meetings, the todo singleton, archived entities, or unresolved targets
   * never appear; the scan reuses `linkGraphOf` so the two graphs agree on
   * every resolution rule.
   * @returns every active entity path plus every deduplicated relation edge.
   */
  @Remote('relationGraph')
  async relationGraph(): Promise<KbRelationGraphResult> {
    return relationGraphOf(this.kbRoot)
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
   * The yantao layer's own share of the system prompt, for the workbench's
   * context meter (ADR-0039): the static discipline sections priced from
   * the same files the plugin registers, the filesystem discipline priced
   * as rendered (ADR-0042: `{{kbRoot}}` resolved against the live root),
   * plus the dynamic global behavior-memory section priced from the live
   * store. Priced with the meter's fixed density heuristic (4 characters
   * per token) so the figures speak the same vocabulary as the
   * `contextBreakdown` projection's system bucket, of which they are the
   * yantao-attributable slice.
   * @returns the static and behavior-memory shares, in heuristic tokens.
   */
  @Remote('promptInjection')
  promptInjection(): Promise<KbPromptInjectionResult> {
    const price = (text: string): number => Math.ceil(text.length / 4)
    const filesystemTokens = price(
      // Rendered exactly as the plugin's dynamic section renders it
      // (registerFilesystemSection): the live root unconditionally — the
      // meter must price what the prompt actually carries, and the live
      // root exists (a default or imported one) even before configuration.
      loadSectionText('filesystem.md').replaceAll('{{kbRoot}}', this.kbRoot),
    )
    const staticTokens = YANTAO_SECTIONS.reduce(
      (sum, section) => sum + price(loadSectionText(section.file)),
      filesystemTokens,
    )
    const behaviorMemoryTokens = this.ctx.yantaoKb.configured
      ? price(renderGlobalMemorySection(readGlobalMemoryEntries(this.kbRoot)))
      : 0
    return Promise.resolve({ staticTokens, behaviorMemoryTokens })
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
   *   and the person's relation to the KB's owner and e-mail address.
   * @returns the KB-relative path of the created file.
   */
  @Remote('createEntity')
  async createEntity(args: KbCreateEntityArgs): Promise<KbCreateEntityResult> {
    const display = entityDisplayPath(args.type, args.name)
    try {
      return await createEntity(this.kbRoot, args.type, args.name, {
        meetingDate: args.date ?? todayStamp(),
        ...args.relation !== undefined ? { relation: args.relation } : {},
        ...args.email !== undefined ? { email: args.email } : {},
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
   * Archive one entity — the workbench's 「归档」 gesture (ADR-0041 决定 6/8).
   *
   * Entities are never deleted: archiving flips the frontmatter's
   * `archive: true`, which retires the entity from the active roster
   * (`listEntities` hides it by default) while the file — and every link
   * into it — stays put. The kb layer appends one dated 「归档」 bullet to
   * the entity's own 流水 section; the flip is idempotent, so archiving an
   * archived entity writes nothing. The todo singleton has no archive
   * semantics and is refused (ADR-0041 决定 2).
   * @param locator - entity locator: `type:name` or an entity file path, resolved exactly like the kb layer's.
   * @returns the KB-relative path and the flag now in effect.
   */
  @Remote('archiveEntity')
  async archiveEntity(locator: string): Promise<KbSetEntityArchivedResult> {
    return this.setArchived(locator, true)
  }

  /**
   * Restore one archived entity — the same mechanism, the other direction
   * (ADR-0041 决定 6): the frontmatter flag comes off and the entity rejoins
   * the active roster, one dated 「还原」 bullet appended to its 流水.
   * Idempotent like archiving: restoring an active entity writes nothing.
   * @param locator - entity locator: `type:name` or an entity file path.
   * @returns the KB-relative path and the flag now in effect.
   */
  @Remote('restoreEntity')
  async restoreEntity(locator: string): Promise<KbSetEntityArchivedResult> {
    return this.setArchived(locator, false)
  }

  /** Flip an entity's archive flag through the kb layer, mapping its failures to the wire vocabulary. */
  private async setArchived(locator: string, archived: boolean): Promise<KbSetEntityArchivedResult> {
    try {
      return await setEntityArchived(this.kbRoot, locator, archived)
    } catch (error) {
      if (error instanceof KbError && error.code === 'entity-not-found') {
        throw new RemoteError('yantao-kb/not-found', `找不到知识库文件：${locator}`, { path: locator }, { cause: error })
      }
      const message = error instanceof KbError
        ? error.message
        : `无法${archived ? '归档' : '还原'}实体 ${locator}：${(error as Error).message}`
      throw new RemoteError('yantao-kb/rejected', message, { path: locator }, { cause: error })
    }
  }

  /**
   * Delete one resource file — the workbench's 「删除」 gesture on a resource
   * row. Resources are dumb raw material (ADR-0020): unlike entities (ADR-0041
   * 决定 8 — never deleted, only archived) a resource can go away for good.
   * The trust boundary is untouched: this lives on the UI's Remote namespace,
   * which the agent's tool layer never sees — the agent keeps its
   * creation-only / read-only resource tools (ADR-0028). Confined twice over:
   * the KB confinement, then a `resources/` prefix — entity notes, the todo
   * singleton and anything else in the KB are refused. The UI confirms
   * before invoking (the menu's armed second click); the server does not
   * second-guess a confirmed human gesture.
   * @param path - KB-relative path with forward slashes, under `resources/`.
   * @returns the deleted path.
   */
  @Remote('deleteResource')
  async deleteResource(path: string): Promise<KbDeleteResourceResult> {
    const target = this.confine(path, path)
    const relative = path.replaceAll('\\', '/')
    if (relative !== 'resources' && !relative.startsWith('resources/')) {
      throw new RemoteError('yantao-kb/rejected', `只能删除 resources/ 下的资源文件：${path}`, { path })
    }
    try {
      await rm(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new RemoteError('yantao-kb/not-found', `找不到知识库文件：${path}`, { path }, { cause: error })
      }
      throw new RemoteError('yantao-kb/rejected', `无法删除知识库文件 ${path}：${(error as Error).message}`, { path }, { cause: error })
    }
    return { path }
  }

  /**
   * Refuse the mail connector while no KB root has been chosen (ADR-0019): the
   * cursor is persisted inside the KB (ADR-0024), so with no root there is
   * nowhere to keep it — and a mail analysis writes into that KB.
   * @throws a `yantao-kb/mail` error while the KB pointer is unrecorded.
   */
  private requireKbRootState(): void {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/mail',
        '还没有选择知识库目录，邮件的读取断点无处记录。',
        { kind: 'no-root', hint: '先选择一次知识库目录，再来读邮件。' },
      )
    }
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
   * Move the mail capability's processed range (ADR-0019): everything at or
   * before `lastReadAt` has been seen, so the next `mailFetch` starts after
   * it; `firstReadAt` names the oldest mail of the batch just dealt with and
   * is kept as the minimum ever seen, so the UI can show the processed range
   * (e.g. 2025-12-31 到 2026-01-31) without re-deriving it.
   *
   * The cursor lives in the KB's `.dsh/yantao/state.json` (ADR-0024) — machine
   * state next to the KB it was read for, never in the KB's markdown.
   * @param args - the stamps to store; `lastReadAt` defaults to now.
   * @returns the processed range as it now stands.
   */
  @Remote('mailMarkRead')
  async mailMarkRead(args: KbMailMarkReadArgs): Promise<KbMailMarkReadResult> {
    this.requireKbRootState()
    const lastReadAt = args.lastReadAt ?? new Date().toISOString()
    return writeMailWatermark(this.kbRoot, lastReadAt, args.firstReadAt)
  }

  /**
   * The memory store's listing (ADR-0032): every scope that has a markdown
   * file under `.dsh/yantao/memory/` — `global.md` first, then the capability
   * scopes name-sorted — each with its exact text and parsed entries. The
   * scan is directory-driven, so a file the human created by hand is a scope
   * like any other. Injection (batch ②) reads the same files.
   * @returns the scopes, global first.
   */
  @Remote('memoryList')
  async memoryList(): Promise<KbMemoryListResult> {
    this.requireKbRootForMemory()
    return { groups: await listMemoryScopes(this.kbRoot) }
  }

  /**
   * Remember one behavior rule (ADR-0032): append a stamped `- ` bullet to the
   * scope's markdown file, creating the file with its heading when absent.
   * This is the human channel's write — the UI's `add-memory` proposal row
   * lands here after the human ticks it — and an already-remembered text is
   * refused rather than duplicated, so the caller shows the human what is
   * already there. The agent has no tool into this surface: its route is a
   * proposal the human approves, never a direct write.
   * @param args - the scope (`global` or a capability name) and the rule's text.
   * @returns the scope's path and the entry as written.
   */
  @Remote('memoryAdd')
  async memoryAdd(args: KbMemoryAddArgs): Promise<KbMemoryAddResult> {
    this.requireKbRootForMemory()
    try {
      const scope = await appendMemoryEntry(this.kbRoot, args.scope, args.text)
      const entry = scope.entries[scope.entries.length - 1]
      if (entry === undefined) throw new KbError('empty-memory-text', '记忆内容不能为空')
      return { path: scope.path, entry }
    } catch (error: unknown) {
      throw this.memoryError(error, args.scope)
    }
  }

  /**
   * Forget one behavior rule (ADR-0032): removal is human-only, addressed by
   * the entry's id. A stale id — the human edited the line meanwhile — is a
   * `not-found`, and the caller refreshes rather than guessing.
   * @param args - the scope and the entry's id.
   * @returns the scope's path.
   */
  @Remote('memoryDelete')
  async memoryDelete(args: KbMemoryDeleteArgs): Promise<KbMemoryDeleteResult> {
    this.requireKbRootForMemory()
    try {
      const scope = await removeMemoryEntry(this.kbRoot, args.scope, args.id)
      return { path: scope.path }
    } catch (error: unknown) {
      throw this.memoryError(error, args.scope)
    }
  }

  /** Refuse memory calls before a KB root exists — the store lives beside it. */
  private requireKbRootForMemory(): void {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，记忆无处存放。',
        { path: '.dsh/yantao/memory' },
      )
    }
  }

  /**
   * The proposal queue's listing (ADR-0044): every scope whose queue file
   * under `.dsh/yantao/memory/proposals/` still holds at least one pending
   * proposal — `global.md` first, then the capability scopes name-sorted —
   * each with its exact text and parsed pending proposals, source annotations
   * included for the human's judgment. A scope whose queue was fully approved
   * or discarded is not listed, so the answer is exactly the in-flight
   * proposals. The queue is never injected into any prompt; this listing and
   * the conversation approval cards are its only readers.
   * @returns the scopes, global first.
   */
  @Remote('memoryProposalList')
  async memoryProposalList(): Promise<KbMemoryProposalListResult> {
    this.requireKbRootForMemory()
    return { groups: await listProposalScopes(this.kbRoot) }
  }

  /**
   * Approve one pending proposal (ADR-0044 决定 7): the bare text lands in
   * the target scope's memory file through `appendMemoryEntry` — dedup,
   * ordering and line format come for free — and only then leaves the queue.
   * The target scope is re-judgeable per approval (default: the source
   * scope). An already-remembered text is refused (`duplicate-memory`) and
   * the pending copy stays for the human to discard explicitly; a stale text
   * (processed meanwhile) is a `not-found` and the caller refreshes.
   * @param args - the source scope, the proposal's text, and the optional re-judged target scope.
   * @returns the queue path, the memory path, and the entry as written.
   */
  @Remote('memoryProposalApprove')
  async memoryProposalApprove(args: KbMemoryProposalApproveArgs): Promise<KbMemoryProposalApproveResult> {
    this.requireKbRootForMemory()
    const targetScope = args.targetScope ?? args.scope
    try {
      const target = await appendMemoryEntry(this.kbRoot, targetScope, args.text)
      const entry = target.entries[target.entries.length - 1]
      if (entry === undefined) throw new KbError('empty-memory-text', '记忆内容不能为空')
      await removeMemoryProposalByText(this.kbRoot, args.scope, args.text)
      return { path: proposalDisplayPath(args.scope), targetPath: target.path, entry }
    } catch (error: unknown) {
      throw this.proposalError(error, args.scope)
    }
  }

  /**
   * Discard one pending proposal (ADR-0044 决定 7): the line leaves the
   * queue and nothing is remembered. Addressed by text — the conversation
   * approval card holds the tool args (scope+text), and per-scope dedup
   * makes text unique within a queue.
   * @param args - the source scope and the proposal's text.
   * @returns the queue path.
   */
  @Remote('memoryProposalDiscard')
  async memoryProposalDiscard(args: KbMemoryProposalDiscardArgs): Promise<KbMemoryProposalDiscardResult> {
    this.requireKbRootForMemory()
    try {
      const queue = await removeMemoryProposalByText(this.kbRoot, args.scope, args.text)
      return { path: queue.path }
    } catch (error: unknown) {
      throw this.proposalError(error, args.scope)
    }
  }

  /**
   * The prompt-shortcut store's listing (ADR-0040): the human's favorite
   * slash aliases in display order. The `/` menu's shortcut group and the
   * capability tab's home list both read through this; the agent's own view
   * is the injected prompt section, never this RPC.
   * @returns the shortcuts as stored.
   */
  @Remote('promptShortcutList')
  async promptShortcutList(): Promise<KbPromptShortcutListResult> {
    this.requireKbRootForShortcuts()
    try {
      return { shortcuts: await readPromptShortcuts(this.kbRoot) }
    } catch (error: unknown) {
      throw this.shortcutError(error)
    }
  }

  /**
   * Save the whole shortcut list (ADR-0040): the UI edits a handful of rows,
   * so a full-list replace keeps reorder and delete trivially correct.
   * Human-channel only — the agent has no tool into this surface. An alias
   * that would shadow a registered skill or capability is refused (ADR-0040
   * 决定 8): the host pre-step claims skill names first, so such a shortcut
   * could never fire, and a confusing duplicate is worse than a refusal.
   * @param args - the complete new list, in display order.
   * @returns the list as stored (normalized).
   */
  @Remote('promptShortcutSave')
  async promptShortcutSave(args: KbPromptShortcutSaveArgs): Promise<KbPromptShortcutSaveResult> {
    this.requireKbRootForShortcuts()
    const taken = new Set<string>((await this.ctx.skills.list({ cwd: this.kbRoot })).map(summary => summary.name))
    for (const shortcut of args.shortcuts) {
      if (typeof shortcut.alias === 'string' && taken.has(shortcut.alias)) {
        throw new RemoteError(
          'yantao-kb/rejected',
          `别名「${shortcut.alias}」已被技能占用，换一个名字。`,
          { path: PROMPT_SHORTCUTS_DISPLAY_PATH },
        )
      }
    }
    const shortcuts = args.shortcuts.map(shortcut => ({ alias: shortcut.alias, text: shortcut.text }))
    try {
      await writePromptShortcuts(this.kbRoot, shortcuts)
      return { shortcuts: await readPromptShortcuts(this.kbRoot), path: PROMPT_SHORTCUTS_DISPLAY_PATH }
    } catch (error: unknown) {
      throw this.shortcutError(error)
    }
  }

  /** Map a kb-side shortcut failure to a RemoteError the UI shows verbatim. */
  private shortcutError(error: unknown): RemoteError {
    if (error instanceof KbError) {
      return new RemoteError('yantao-kb/rejected', error.message, { path: PROMPT_SHORTCUTS_DISPLAY_PATH }, { cause: error })
    }
    return new RemoteError(
      'yantao-kb/rejected',
      `惯用提示词保存失败：${(error as Error).message}`,
      { path: PROMPT_SHORTCUTS_DISPLAY_PATH },
      { cause: error instanceof Error ? error : undefined },
    )
  }

  /** Refuse shortcut calls before a KB root exists — the store lives beside it. */
  private requireKbRootForShortcuts(): void {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，惯用提示词无处存放。',
        { path: PROMPT_SHORTCUTS_DISPLAY_PATH },
      )
    }
  }

  /**
   * The schedule store's listing (ADR-0045): the human's timed tasks in
   * display order. The 调度 tab and the frontend scheduler both read through
   * this; the agent has no tool into this surface at all (决定 4).
   * @returns the schedules as stored.
   */
  @Remote('scheduleList')
  async scheduleList(): Promise<KbScheduleListResult> {
    this.requireKbRootForSchedules()
    try {
      return { schedules: await readSchedules(this.kbRoot) }
    } catch (error: unknown) {
      throw this.scheduleError(error)
    }
  }

  /**
   * Save the whole schedule list (ADR-0045): the UI edits a handful of rows,
   * so a full-list replace keeps reorder and delete trivially correct.
   * Human-channel only. The scheduler-owned stamps (`lastFiredAt` /
   * `lastMissedAt`) never travel through this save: an editor's stale
   * snapshot must not rewind the bookkeeping, so existing rows keep the
   * stamps the store holds — the scheduler patches them through
   * `scheduleMark` instead.
   * @param args - the complete new list, in display order.
   * @returns the list as stored (normalized, stamps preserved).
   */
  @Remote('scheduleSave')
  async scheduleSave(args: KbScheduleSaveArgs): Promise<KbScheduleSaveResult> {
    this.requireKbRootForSchedules()
    try {
      const current = await readSchedules(this.kbRoot)
      const merged = args.schedules.map((row) => {
        const prev = current.find(candidate => candidate.id === row.id)
        return prev === undefined ? row : {
          ...row,
          ...prev.lastFiredAt !== undefined ? { lastFiredAt: prev.lastFiredAt } : {},
          ...prev.lastMissedAt !== undefined ? { lastMissedAt: prev.lastMissedAt } : {},
        }
      })
      await writeSchedules(this.kbRoot, merged)
      return { schedules: await readSchedules(this.kbRoot), path: SCHEDULES_DISPLAY_PATH }
    } catch (error: unknown) {
      throw this.scheduleError(error)
    }
  }

  /**
   * Patch one row's scheduler-owned stamps (ADR-0045): the scheduler's own
   * write path — single-row patches, so bookkeeping never rides (or races) a
   * full-list replace. `null` clears a stamp (a real fire clears the missed
   * mark); an absent field is left alone.
   * @param args - the row id and the stamp changes.
   * @returns the full list as stored after the patch.
   */
  @Remote('scheduleMark')
  async scheduleMark(args: KbScheduleMarkArgs): Promise<KbScheduleMarkResult> {
    this.requireKbRootForSchedules()
    try {
      const schedules = await markSchedule(this.kbRoot, args.id, {
        ...args.lastFiredAt !== undefined ? { lastFiredAt: args.lastFiredAt } : {},
        ...args.lastMissedAt !== undefined ? { lastMissedAt: args.lastMissedAt } : {},
      })
      return { schedules, path: SCHEDULES_DISPLAY_PATH }
    } catch (error: unknown) {
      throw this.scheduleError(error)
    }
  }

  /** Map a kb-side schedule failure to a RemoteError the UI shows verbatim. */
  private scheduleError(error: unknown): RemoteError {
    if (error instanceof KbError) {
      return new RemoteError('yantao-kb/rejected', error.message, { path: SCHEDULES_DISPLAY_PATH }, { cause: error })
    }
    return new RemoteError(
      'yantao-kb/rejected',
      `调度保存失败：${(error as Error).message}`,
      { path: SCHEDULES_DISPLAY_PATH },
      { cause: error instanceof Error ? error : undefined },
    )
  }

  /** Refuse schedule calls before a KB root exists — the store lives beside it. */
  private requireKbRootForSchedules(): void {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，调度无处存放。',
        { path: SCHEDULES_DISPLAY_PATH },
      )
    }
  }

  /**
   * The proposal inbox's listing (ADR-0047): structured proposals produced
   * outside a human-initiated card flow — today, a schedule's background
   * session — pending and decided alike, in enqueue order. The 提议 tab and
   * the frontend scheduler both read through this; the agent has no tool
   * into this surface (the scheduler is human-channel code).
   * @returns the entries as stored.
   */
  @Remote('proposalInboxList')
  async proposalInboxList(): Promise<KbProposalInboxListResult> {
    this.requireKbRootForInbox()
    try {
      // The store holds the payload as `unknown` (schema authority is the
      // client, ADR-0047); it entered as JSON and returns as JSON.
      const proposals = await readProposalInbox(this.kbRoot) as readonly KbQueuedProposal[]
      return { proposals, path: PROPOSAL_INBOX_DISPLAY_PATH }
    } catch (error: unknown) {
      throw this.inboxError(error)
    }
  }

  /**
   * Append one proposal to the inbox (ADR-0047): the producer's write path —
   * today the frontend scheduler, after a fired session's answer parsed into
   * a unified proposal. The store assigns the id, the enqueue stamp, and the
   * pending status; the payload rides opaquely (ADR-0021 决定 4's schema
   * authority stays with the client).
   * @param args - the proposal and its provenance.
   * @returns the full list as stored, plus the fresh entry's id.
   */
  @Remote('proposalInboxEnqueue')
  async proposalInboxEnqueue(args: KbProposalInboxEnqueueArgs): Promise<KbProposalInboxEnqueueResult> {
    this.requireKbRootForInbox()
    try {
      const stored = await enqueueProposal(this.kbRoot, args)
      const proposals = stored as readonly KbQueuedProposal[]
      const fresh = proposals.at(-1)
      return {
        proposals,
        id: fresh === undefined ? '' : fresh.id,
        path: PROPOSAL_INBOX_DISPLAY_PATH,
      }
    } catch (error: unknown) {
      throw this.inboxError(error)
    }
  }

  /**
   * Record the human's decision on one pending proposal (ADR-0047): approve
   * or discard. The apply itself is the UI's business (the human channel's
   * `applyProposal`), this only settles the row — a decision is final, an
   * already-decided entry refuses.
   * @param args - the entry id and the decision.
   * @returns the full list as stored after the resolve.
   */
  @Remote('proposalInboxResolve')
  async proposalInboxResolve(args: KbProposalInboxResolveArgs): Promise<KbProposalInboxResolveResult> {
    this.requireKbRootForInbox()
    try {
      const stored = await resolveProposalInboxEntry(this.kbRoot, args.id, args.status)
      return { proposals: stored as readonly KbQueuedProposal[], path: PROPOSAL_INBOX_DISPLAY_PATH }
    } catch (error: unknown) {
      throw this.inboxError(error)
    }
  }

  /** Map a kb-side inbox failure to a RemoteError the UI shows verbatim. */
  private inboxError(error: unknown): RemoteError {
    if (error instanceof KbError) {
      const notFound = error.code === 'inbox-entry-not-found'
      return new RemoteError(
        notFound ? 'yantao-kb/not-found' : 'yantao-kb/rejected',
        error.message,
        { path: PROPOSAL_INBOX_DISPLAY_PATH },
        { cause: error },
      )
    }
    return new RemoteError(
      'yantao-kb/rejected',
      `提议收件箱操作失败：${(error as Error).message}`,
      { path: PROPOSAL_INBOX_DISPLAY_PATH },
      { cause: error instanceof Error ? error : undefined },
    )
  }

  /** Refuse inbox calls before a KB root exists — the store lives beside it. */
  private requireKbRootForInbox(): void {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，提议收件箱无处存放。',
        { path: PROPOSAL_INBOX_DISPLAY_PATH },
      )
    }
  }

  /**
   * The capability scope's behavior memory (ADR-0032 决定 4), rendered for a
   * run context: `.dsh/yantao/memory/capabilities/<name>.md`'s entries under
   * the run-context header, undefined when the scope has none. Every failure
   * — an unsafe name, an unreadable file — degrades to undefined: memory
   * rides along, it never blocks a run.
   */
  private async capabilityMemory(name: string): Promise<string | undefined> {
    try {
      const scope = await readMemoryScope(this.kbRoot, name)
      return renderCapabilityMemoryBlock(name, scope.entries) || undefined
    } catch {
      return undefined
    }
  }

  /** Translate the kb package's memory failures into the Remote channel's classes. */
  private memoryError(error: unknown, scope: string): RemoteError {
    if (error instanceof KbError) {
      const notFound = error.code === 'memory-entry-not-found'
      return new RemoteError(
        notFound ? 'yantao-kb/not-found' : 'yantao-kb/rejected',
        error.message,
        { path: `.dsh/yantao/memory/${scope === 'global' ? 'global.md' : `capabilities/${scope}.md`}` },
        { cause: error },
      )
    }
    return new RemoteError(
      'yantao-kb/rejected',
      `记忆操作失败：${(error as Error).message}`,
      { path: '.dsh/yantao/memory' },
      { cause: error },
    )
  }

  /** Translate the kb package's proposal-queue failures into the Remote channel's classes. */
  private proposalError(error: unknown, scope: string): RemoteError {
    if (error instanceof KbError) {
      const notFound = error.code === 'proposal-not-found'
      return new RemoteError(
        notFound ? 'yantao-kb/not-found' : 'yantao-kb/rejected',
        error.message,
        { path: proposalDisplayPath(scope) },
        { cause: error },
      )
    }
    return new RemoteError(
      'yantao-kb/rejected',
      `提案操作失败：${(error as Error).message}`,
      { path: '.dsh/yantao/memory/proposals' },
      { cause: error },
    )
  }

  /**
   * Run one capability's host entry (ADR-0021) — the human channel's execution
   * seam, the mail connector's and the extractor's subprocess pattern
   * generalized. The capability is resolved through `ctx.skills` (the
   * skill-filesystem provider discovers the directories; this controller only
   * consumes the winner), its `yantao.json` declaration (legacy
   * `metadata.yantao` frontmatter accepted) picks the entry
   * script, and the run is one Python subprocess with a JSON stdin/stdout
   * contract (`capability/run.ts`).
   *
   * The controller, not the script, owns every write: artifacts land under
   * `.dsh/yantao/capabilities/<name>/` at paths the script cannot choose, and the
   * returned state is persisted under `capabilities.<name>.state` in the KB's
   * `.dsh/yantao/state.json` (ADR-0024) — machine state inside the KB, which stays
   * markdown for humans. The agent has its own channel into the same seam:
   * `kb_run_capability` (ADR-0023), gated per capability by the sidecar's
   * `invocation` declaration.
   * @param args - the capability's skill name and the caller's input, handed
   *   to the entry script verbatim.
   * @param signal - the human channel's cancel line (ADR-0031): an abort
   *   kills the entry script's subprocess and rejects with the `cancelled`
   *   kind. The agent channel has no cancel — its runs answer or time out.
   * @returns what the run answered, when it ran, and which artifact paths were written.
   */
  @Remote('capabilityRun')
  async capabilityRun(args: KbCapabilityRunArgs, signal?: AbortSignal): Promise<KbCapabilityRunResult> {
    return await this.runByName(args.name, args.input, 'human', signal)
  }

  /**
   * One capability's declaration, parsed and resolved (ADR-0043 决定 7):
   * both declaration channels answered in data — the directory's own
   * sidecar (raw text included, legacy frontmatter accepted) and the
   * central routing file — plus the same dual-gate agent-invocability the
   * run paths apply. A registration problem (missing sidecar, unregistered
   * route, missing entry file, broken routing file) is stated in the
   * answer, never thrown: the 能力 tab renders it, and an agent
   * troubleshooting a refused call reads the very same resolution the run
   * would have applied. Only an unconfigured KB throws — then nothing
   * could resolve anyway.
   * @param args - the capability's skill name.
   * @returns the parsed declaration, both channels, and the gate's answer.
   */
  @Remote('capabilityDeclaration')
  async capabilityDeclaration(args: KbCapabilityDeclarationArgs): Promise<KbCapabilityDeclarationResult> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/capability',
        '还没有选择知识库目录，能力的声明无处读取。',
        { kind: 'no-root', hint: '先选择一次知识库目录，再查看能力声明。' },
      )
    }
    const kbRoot = this.kbRoot
    // Seed the shipped capabilities before resolving, as in runByName.
    await this.settleSkills(ensureBuiltinCapabilities(kbRoot))
    const dshRoot = join(kbRoot, '.dsh')
    // The same dual-gate verdict the run paths apply — the 声明 view renders
    // it instead of re-deriving it, so what the panel displays can never
    // drift from what a run would do.
    const verdict = await this.resolveCapability(args.name)
    let sidecar: KbCapabilitySidecarAnswer
    if (verdict.channel === 'declared') {
      sidecar = {
        present: true,
        source: verdict.raw !== undefined ? 'sidecar' : 'frontmatter',
        ...verdict.raw !== undefined ? { raw: verdict.raw } : {},
        resolved: resolvedDeclarationOf(verdict.definition, verdict.manifest, dshRoot),
      }
    } else if (verdict.channel === 'broken-sidecar') {
      const hasFrontmatter = typeof verdict.definition.metadata === 'object'
        && (verdict.definition.metadata as { yantao?: unknown } | undefined)?.yantao !== undefined
      sidecar = verdict.raw === undefined && !hasFrontmatter
        ? { present: false, problem: 'sidecar 不存在：目录内没有 yantao.json，SKILL.md 也没有 metadata.yantao 段。' }
        : {
          present: true,
          source: verdict.raw !== undefined ? 'sidecar' : 'frontmatter',
          ...verdict.raw !== undefined ? { raw: verdict.raw } : {},
          problem: capabilityProblemText(verdict.error),
        }
    } else if (verdict.channel === 'routed') {
      // The name answers through the central routing file alone: the
      // directory genuinely carries no sidecar, and the wording says so
      // without pretending the skill's declaration was ever looked for
      // anywhere else.
      sidecar = { present: false, problem: 'sidecar 不存在：这个名字只登记在中央路由文件里，目录内没有 yantao.json，SKILL.md 也没有 metadata.yantao 段。' }
    } else {
      // Absent: no declaration answered anywhere — the name may not exist at
      // all, so the wording must not imply a skill directory was inspected.
      sidecar = { present: false, problem: 'sidecar 不存在：注册表和中央路由文件里都没有这个名字的声明。' }
    }
    const directory = verdict.channel === 'declared' && verdict.definition.resourceBase?.kind === 'directory'
      ? verdict.definition.resourceBase.path
      : undefined
    // The central routing channel, taken from the verdict: resolveCapability
    // already read the routing file, and deriving the answer from it keeps
    // the read (and the diagnosis of a broken file) in one place.
    let route: KbCapabilityRouteAnswer
    if (verdict.route !== undefined) {
      route = {
        registered: true,
        path: verdict.route.path,
        invocation: verdict.route.invocation,
        ...verdict.route.appliesTo !== undefined ? { appliesTo: verdict.route.appliesTo } : {},
      }
    } else if (verdict.routeError !== undefined) {
      // A broken routing file is stated, not thrown — introspection's whole
      // point is seeing the breakage.
      route = {
        registered: false,
        problem: capabilityProblemText(verdict.routeError),
      }
    } else {
      route = { registered: false }
    }
    // The dual gate (resolveCapability's precedence): the verdict's winning
    // channel decides — the same precedence the run paths apply, so the
    // panel's answer can never drift from what a run would do.
    let agentInvocable = false
    if (verdict.channel === 'declared') {
      agentInvocable = verdict.manifest.invocation.includes('agent')
    } else if (verdict.route !== undefined) {
      agentInvocable = verdict.route.invocation.includes('agent')
    }
    return {
      name: args.name,
      ...directory !== undefined ? { directory } : {},
      sidecar,
      route,
      agentInvocable,
    }
  }

  /**
   * The one dual-gate resolution (ADR-0043): the run paths, the execution
   * bridge's directory lookup, and the declaration view all read this one
   * verdict, so the gate they apply can never drift apart. Routing-file
   * breakage is carried, not thrown — each caller decides whether it
   * rethrows (runs: a broken declaration must be seen) or reports it
   * (introspection: breakage stated, never thrown).
   */
  private async resolveCapability(name: string): Promise<CapabilityResolution> {
    // A rejected registry read (EBUSY, EACCES…) degrades to "the registry has
    // no such name" — the same leniency every other skills.get reader applies.
    // Declaration views promise to state breakage, not to become hard RPC
    // failures because a transient registry hiccup raced the read.
    let definition: SkillDefinition | undefined
    try {
      definition = await this.ctx.skills.get(name, { cwd: this.kbRoot })
    } catch {
      definition = undefined
    }
    let route: CapabilityRoute | undefined
    let routeError: unknown
    try {
      route = (await readRoutes(join(this.kbRoot, '.dsh', 'skills')))[name]
    } catch (error: unknown) {
      routeError = error
    }
    if (definition === undefined || !this.isKbSkill(definition)) {
      return route !== undefined
        ? { channel: 'routed', route }
        : { channel: 'absent', ...(routeError !== undefined ? { routeError } : {}) }
    }
    const directory = definition.resourceBase?.kind === 'directory' ? definition.resourceBase.path : undefined
    const raw = directory === undefined
      ? undefined
      : await readFile(join(directory, 'yantao.json'), 'utf8').catch(() => undefined)
    try {
      return {
        channel: 'declared',
        definition,
        manifest: manifestOf(definition),
        ...(raw !== undefined ? { raw } : {}),
        // Carried for introspection only — the declared channel wins
        // regardless of what the routing file says.
        ...(route !== undefined ? { route } : {}),
        ...(routeError !== undefined ? { routeError } : {}),
      }
    } catch (error: unknown) {
      // A broken (or missing) sidecar: the central route may still claim the
      // name — registration writes routes, not sidecars.
      return {
        channel: 'broken-sidecar',
        definition,
        error,
        ...(raw !== undefined ? { raw } : {}),
        ...(route !== undefined ? { route } : {}),
        ...(routeError !== undefined ? { routeError } : {}),
      }
    }
  }

  /**
   * Resolve the execution bridge's working directory (ADR-0043 决定 2): the
   * skill directory of the capability `name`, which must be open to the
   * agent. Resolution walks the same two declaration channels as
   * {@link runByName} through the same {@link resolveCapability} verdict,
   * and applies the same `invocation` gate; only the answer differs (a
   * directory, not a run). `execCapabilityScript` re-confines the answer
   * under `.dsh/skills/` before spawning.
   * @param name - the capability's skill name.
   * @returns the capability directory's absolute path.
   */
  private async agentCapabilityDirectory(name: string): Promise<string> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/capability',
        '还没有选择知识库目录，能力的状态无处记录。',
        { kind: 'no-root', hint: '先选择一次知识库目录，再运行能力。' },
      )
    }
    // Seed the shipped capabilities before resolving, as in runByName.
    await this.settleSkills(ensureBuiltinCapabilities(this.kbRoot))
    const verdict = await this.resolveCapability(name)
    if (verdict.channel === 'absent') {
      if (verdict.routeError !== undefined) throw badManifestError(verdict.routeError)
      throw capabilityNotFound(name)
    }
    if (verdict.channel === 'broken-sidecar' && verdict.routeError !== undefined) {
      // A broken routing file outranks the sidecar's own failure (routeOf's
      // discipline): the declaration channel must be seen broken, not blamed
      // for the route's mess.
      throw badManifestError(verdict.routeError)
    }
    if (verdict.channel === 'declared') {
      if (!verdict.manifest.invocation.includes('agent')) {
        throw capabilityNotInvocable(name, 'yantao.json')
      }
      const base = verdict.definition.resourceBase
      // isKbSkill only admits directory-backed skills, so this guard is
      // unreachable in practice — belt-and-braces for the type system, which
      // cannot see isKbSkill's invariant; anything without a directory has
      // nowhere to execute and is answered as not found.
      if (base?.kind !== 'directory') {
        throw capabilityNotFound(name)
      }
      return base.path
    }
    if (verdict.channel === 'broken-sidecar') {
      // The fix for the swallowed refusal: with no route to fall back on,
      // the sidecar's real failure surfaces as bad-manifest — not a
      // misleading not-found that sends the agent hunting the wrong way.
      if (verdict.route === undefined) throw badManifestError(verdict.error)
      if (!verdict.route.invocation.includes('agent')) {
        throw capabilityNotInvocable(name, ROUTES_PATH)
      }
      return resolve(join(this.kbRoot, '.dsh', 'skills'), verdict.route.path)
    }
    if (!verdict.route.invocation.includes('agent')) {
      throw capabilityNotInvocable(name, ROUTES_PATH)
    }
    return resolve(join(this.kbRoot, '.dsh', 'skills'), verdict.route.path)
  }

  /**
   * Resolve and run one capability for either invoker (ADR-0023): the human
   * RPC and the agent's `kb_run_capability` share this seam. Resolution
   * walks two declaration channels with fixed precedence: the skill's own
   * declaration first (a `yantao.json` sidecar, legacy `metadata.yantao`
   * frontmatter accepted), then the central routing file
   * `.dsh/skills/yantao.json` (ADR-0025 落地注记二) — a valid sidecar beats a
   * same-named route. Only skills under the KB's own `.dsh/skills/` resolve
   * (ADR-0024 决定 4); anything else is not-found. The agent path passes the
   * declaration's `invocation` gate first — undeclared means refused with
   * `not-invocable` — and an instruction capability (a declaration with no
   * `entry`) answers with the SKILL.md body instead of spawning anything:
   * no subprocess, no state, no artifacts.
   * @param name - the capability's skill name.
   * @param input - the caller's input, handed to the entry script verbatim.
   * @param invoker - which channel is calling; only `'agent'` is gated.
   * @param signal - the human channel's cancel line, threaded to the
   *   subprocess run; undefined for the agent channel.
   * @returns what the run answered, when it ran, which artifact paths were
   *   written, and the capability scope's behavior memory (ADR-0032 决定 4)
   *   when the scope has remembered rules.
   */
  private async runByName(
    name: string,
    input: unknown,
    invoker: CapabilityInvoker,
    signal?: AbortSignal,
  ): Promise<KbCapabilityRunResult> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/capability',
        '还没有选择知识库目录，能力的状态无处记录。',
        { kind: 'no-root', hint: '先选择一次知识库目录，再运行能力。' },
      )
    }
    // The capability scope's behavior memory (ADR-0032 决定 4): read once per
    // run, attached to whichever answer the run produces. A scope with no
    // remembered rules (or an unreadable one) degrades to absent — a memory
    // hiccup must not fail the run.
    const memory = await this.capabilityMemory(name)
    // Seed the shipped capabilities before resolving: a first run on a fresh
    // KB would otherwise answer "not found" for a capability that is about to
    // be copied in.
    await this.settleSkills(ensureBuiltinCapabilities(this.kbRoot))
    const verdict = await this.resolveCapability(name)
    if (verdict.channel === 'declared') {
      return this.runDeclared(name, verdict.definition, verdict.manifest, input, invoker, memory, signal)
    }
    if (verdict.channel === 'routed') {
      return this.runRouted(name, verdict.route, invoker, memory)
    }
    if (verdict.channel === 'broken-sidecar') {
      // A broken routing file outranks the sidecar's own failure (routeOf's
      // discipline: a broken declaration must be seen); with no route to fall
      // back on, the sidecar's failure surfaces as its real bad-manifest self.
      if (verdict.routeError !== undefined) throw badManifestError(verdict.routeError)
      if (verdict.route !== undefined) return this.runRouted(name, verdict.route, invoker, memory)
      throw badManifestError(verdict.error)
    }
    if (verdict.routeError !== undefined) throw badManifestError(verdict.routeError)
    // A definition resolved from outside the KB (a `~/.dsh/skills` or project
    // skill shadowing the name) is not a yantao capability: single source
    // (ADR-0024 决定 4). A routed skill the registry never discovered (a
    // plugin repository's nested child) resolves through the central file.
    throw capabilityNotFound(name)
  }

  /**
   * Run one centrally routed capability (ADR-0025 落地注记二): an instruction
   * capability by construction — the routed SKILL.md body is the whole
   * answer. Nothing spawns, nothing persists. The agent channel passes the
   * route's `invocation` gate first.
   */
  private async runRouted(
    name: string,
    route: CapabilityRoute,
    invoker: CapabilityInvoker,
    memory: string | undefined,
  ): Promise<KbCapabilityRunResult> {
    // The invocation gate (ADR-0023 决定 2): the agent only reaches what the
    // route declared `"agent"`; the human channel is ungated.
    if (invoker === 'agent' && !route.invocation.includes('agent')) {
      throw capabilityNotInvocable(name, ROUTES_PATH)
    }
    const routed = await routedSkill(join(this.kbRoot, '.dsh', 'skills'), route)
    if (routed === undefined) {
      throw new RemoteError(
        'yantao-kb/capability',
        `能力「${name}」的路由目标缺少可读的 SKILL.md：${route.path}`,
        { kind: 'bad-manifest', hint: CAPABILITY_HINTS['bad-manifest'] },
      )
    }
    return {
      name,
      runAt: new Date().toISOString(),
      content: routed.body,
      ...(memory !== undefined ? { memory } : {}),
      artifacts: [],
    }
  }

  /** Run a skill whose own declaration (sidecar or frontmatter) resolved — the sidecar channel. */
  private async runDeclared(
    name: string,
    definition: SkillDefinition,
    manifest: CapabilityManifest,
    input: unknown,
    invoker: CapabilityInvoker,
    memory: string | undefined,
    signal?: AbortSignal,
  ): Promise<KbCapabilityRunResult> {
    // The invocation gate (ADR-0023 决定 2): the agent only reaches what the
    // declaration declared `"agent"`; the human channel is ungated.
    if (invoker === 'agent' && !manifest.invocation.includes('agent')) {
      throw capabilityNotInvocable(name, 'yantao.json')
    }
    // An instruction capability (no entry, ADR-0023 决定 6) has no script:
    // the SKILL.md body is the whole answer. Nothing spawns, nothing persists.
    if (manifest.entry === undefined) {
      return {
        name,
        runAt: new Date().toISOString(),
        content: definition.content,
        ...(memory !== undefined ? { memory } : {}),
        artifacts: [],
      }
    }
    let directory: string
    let entryPath: string
    try {
      // The `.dsh/` root lets the entry name the adapter plane outside the
      // skill directory (ADR-0043 决定 2); resolveEntry confines it there.
      const resolved = resolveEntry(definition, join(this.kbRoot, '.dsh'))
      directory = resolved.directory
      entryPath = resolved.entryPath
    } catch (error: unknown) {
      throw badManifestError(error)
    }
    const kbRoot = this.kbRoot
    let output
    try {
      output = await runCapability({
        name,
        directory,
        entryPath,
        kbRoot,
        input,
        // The invoker's testimony in the script's request envelope (ADR-0034
        // 决定 5): the caller cannot forge it, and a privileged verb checks it.
        channel: invoker,
        state: readCapabilityState(kbRoot, name),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error: unknown) {
      const failure = error instanceof CapabilityError ? error : undefined
      throw new RemoteError(
        'yantao-kb/capability',
        failure?.message ?? '能力执行失败。',
        {
          kind: failure?.kind ?? 'other',
          hint: failure?.hint ?? CAPABILITY_HINTS.other,
          // The run's envelope (ADR-0044 决定 6): the UI's 提炼经验 gesture
          // mines it even when the run failed.
          ...(failure?.exec !== undefined ? { exec: failure.exec } : {}),
        },
        { cause: error },
      )
    }
    const written: string[] = []
    try {
      for (const artifact of output.artifacts ?? []) {
        const dir = join(kbRoot, '.dsh', 'yantao', 'capabilities', name)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, artifact.name), Buffer.from(artifact.contentBase64, 'base64'))
        written.push(`.dsh/yantao/capabilities/${name}/${artifact.name}`)
      }
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/capability',
        `无法写入能力的产物文件：${(error as Error).message}`,
        { kind: 'other', hint: CAPABILITY_HINTS.other },
        { cause: error },
      )
    }
    if (output.state !== undefined) await writeCapabilityState(kbRoot, name, output.state)
    return {
      name,
      runAt: new Date().toISOString(),
      ...output.result !== undefined ? { result: output.result as JsonValue } : {},
      ...(memory !== undefined ? { memory } : {}),
      artifacts: written,
      ...(output.exec !== undefined ? { exec: output.exec } : {}),
    }
  }

  /**
   * The `/xxx` gesture's injection (ADR-0025 决定 3), derived from one direct
   * user message. A message opening with `/name` naming a registered KB
   * capability answers one injected message: the SKILL.md body as
   * `skill-invocation` instructions when the capability is instruction-type
   * and human-invocable; an ordinary notice when it is script-type (`/xxx`
   * is not that channel's form — ADR-0025 台账 2). A name that misses — no
   * skill, a plain skill without a sidecar, a human-disabled one — stays
   * ordinary prose: the gesture was never a claim this boundary recognizes.
   * @param message - the step's claimed user message.
   * @returns the message to append, or undefined when nothing applies.
   */
  private async skillInvocationOf(message: UserMessage): Promise<UserMessage | undefined> {
    const first = message.content.find((block): block is TextBlock => block.type === 'text')
    if (first === undefined) return undefined
    const match = CAPABILITY_GESTURE.exec(first.text)
    if (match === null) return undefined
    const name = match[1]
    if (name === undefined) return undefined
    let definition: SkillDefinition | undefined
    try {
      definition = await this.ctx.skills.get(name, { cwd: this.kbRoot })
    } catch {
      definition = undefined
    }
    if (definition !== undefined && this.isKbSkill(definition)) {
      let manifest: CapabilityManifest
      try {
        manifest = manifestOf(definition)
      } catch {
        // No sidecar declaration: the central route may still claim the name.
        return this.routedInvocation(name)
      }
      if (manifest.entry !== undefined) {
        // The script-type notice (ADR-0043 决定 3/5): positive wording — how
        // the capability *is* reached — plus the host's environment note.
        const summary = `能力「${name}」是脚本型`
        return createUserMessage({
          source: { kind: 'plugin', plugin: 'yantao-kb-controller', form: 'notice', summary },
          content: [{
            type: 'text',
            text: `${summary}：经 kb_run_capability 调用（产出缺省落 resources/），或按下方说明在会话中执行其脚本。\n\n${CAPABILITY_ENVIRONMENT_NOTE}`,
          }],
        })
      }
      if (!manifest.invocation.includes('human')) return undefined
      const source: SkillInvocationSource = { kind: 'skill-invocation', name, form: 'instructions' }
      return createUserMessage({
        source,
        content: [{ type: 'text', text: `${CAPABILITY_ENVIRONMENT_NOTE}\n\n${renderSkillContent(definition)}` }],
      })
    }
    return this.routedInvocation(name)
  }

  /**
   * The `/xxx` gesture's central-route channel (ADR-0025 落地注记二): a
   * routed, human-invocable instruction capability injects its SKILL.md
   * body — even when the registry cannot see the skill at all (a plugin
   * repository's nested child). A miss stays ordinary prose.
   */
  private async routedInvocation(name: string): Promise<UserMessage | undefined> {
    let route: CapabilityRoute | undefined
    try {
      route = (await readRoutes(join(this.kbRoot, '.dsh', 'skills')))[name]
    } catch {
      return undefined
    }
    if (route === undefined || !route.invocation.includes('human')) return undefined
    const routed = await routedSkill(join(this.kbRoot, '.dsh', 'skills'), route)
    if (routed === undefined) return undefined
    const source: SkillInvocationSource = { kind: 'skill-invocation', name, form: 'instructions' }
    return createUserMessage({
      source,
      content: [{
        type: 'text',
        text: `${CAPABILITY_ENVIRONMENT_NOTE}\n\n${renderSkillContent({
          name,
          provider: 'yantao-kb-routing',
          resourceBase: { kind: 'directory', path: routed.directory },
          content: routed.body,
        })}`,
      }],
    })
  }

  /**
   * The agent-facing capability catalog (ADR-0023 决定 5): every capability
   * under the KB's `.dsh/skills/` (ADR-0024 决定 4) whose sidecar declares
   * `"agent"` in `invocation`, as `{name, description}` rows. Plain skills
   * without a yantao declaration are not capabilities and
   * never appear; a KB with no agent-invocable capability answers empty and
   * the pre-step leaves the turn untouched.
   * @returns the catalog rows, in discovery order.
   */
  private async agentCapabilityCatalog(): Promise<readonly { name: string; description: string }[]> {
    const kbRoot = this.kbRoot
    const summaries = await this.ctx.skills.list({ cwd: kbRoot })
    const entries: { name: string; description: string }[] = []
    for (const summary of summaries) {
      let definition: SkillDefinition | undefined
      try {
        definition = await this.ctx.skills.get(summary.name, { cwd: kbRoot })
      } catch {
        definition = undefined
      }
      if (definition === undefined || !this.isKbSkill(definition)) continue
      let manifest: CapabilityManifest
      try {
        manifest = manifestOf(definition)
      } catch {
        continue
      }
      if (!manifest.invocation.includes('agent')) continue
      entries.push({ name: summary.name, description: summary.description })
    }
    // The central-route channel (ADR-0025 落地注记二): routed capabilities the
    // registry cannot see (a plugin repository's nested children). A valid
    // sidecar already pushed above wins; a broken routing file is skipped —
    // background decoration must not break the turn.
    let routes: Record<string, CapabilityRoute>
    try {
      routes = await readRoutes(join(kbRoot, '.dsh', 'skills'))
    } catch {
      return entries
    }
    for (const [routedName, route] of Object.entries(routes)) {
      if (!route.invocation.includes('agent')) continue
      if (entries.some(entry => entry.name === routedName)) continue
      const routed = await routedSkill(join(kbRoot, '.dsh', 'skills'), route)
      if (routed !== undefined) entries.push({ name: routedName, description: routed.description })
    }
    return entries
  }

  /**
   * The capabilities the workbench's 能力 tab shows (ADR-0021 决定 8):
   * every skill under the KB's own `.dsh/skills/` (ADR-0024 决定 4) that
   * declares a
   * capability manifest (`yantao.json` sidecar, legacy `metadata.yantao`
   * frontmatter accepted) — plain skills without one are not capabilities
   * and are skipped, not errors. Shipped capabilities are seeded first, so a
   * fresh KB answers with 邮件 on its very first open.
   *
   * Each row merges the skill's declaration with the persisted record
   * (`capabilities.<name>` in the KB's `.dsh/yantao/state.json`, ADR-0024): when it last ran and
   * the state that run left behind, so the panel can show a real 断点 without
   * running anything.
   *
   * The answer also carries the 未注册 group (ADR-0025 决定 1): skills
   * discovered outside the KB that adoption could copy in — directory
   * bundles, name-sorted, after the registered list — and skills living
   * inside the KB's own `.dsh/skills/` whose declaration is missing or
   * invalid, greyed rows carrying the reason; registration (ADR-0025 决定 1)
   * writes their sidecar in place. Bundled skills (dsh's own) are not
   * third-party finds and never appear.
   * @returns both groups.
   */
  @Remote('capabilityList')
  async capabilityList(): Promise<KbCapabilityListResult> {
    const kbRoot = this.kbRoot
    await this.settleSkills(ensureBuiltinCapabilities(kbRoot))
    const summaries = await this.ctx.skills.list({ cwd: kbRoot })
    // The central routing file (ADR-0025 落地注记二): registration's
    // declarations. A broken file answers no routes — the panel still lists
    // what the sidecars declare.
    let routes: Record<string, CapabilityRoute> = {}
    try {
      routes = await readRoutes(join(kbRoot, '.dsh', 'skills'))
    } catch {
      routes = {}
    }
    const capabilities: KbCapabilitySummary[] = []
    const unregistered: KbUnregisteredSkill[] = []
    for (const summary of summaries) {
      let definition: SkillDefinition | undefined
      try {
        definition = await this.ctx.skills.get(summary.name, { cwd: kbRoot })
      } catch {
        definition = undefined
      }
      if (definition === undefined) continue
      if (!this.isKbSkill(definition)) {
        // Outside the KB: an adoption candidate (ADR-0025 决定 1), unless it
        // is dsh's own bundled skill — that one is not a third-party find.
        // A name the central routing file already claims is not offered
        // either: the routed capability answers, adoption would only collide.
        if (summary.source === 'bundled' || routes[summary.name] !== undefined) continue
        const directory = definition.resourceBase?.kind === 'directory' ? definition.resourceBase.path : undefined
        // A flat `xxx.md` skill's resourceBase is the shared skills root, not
        // a per-skill directory; the SKILL.md basename is what tells the two
        // apart. No path at all is treated the same way: nothing verifiable
        // to copy.
        const flat = definition.path === undefined || basename(definition.path) !== 'SKILL.md'
        const sidecar = !flat && directory !== undefined ? await this.sidecarOf(directory) : undefined
        unregistered.push({
          name: summary.name,
          description: summary.description,
          source: summary.source,
          ...!flat && directory !== undefined ? { directory } : {},
          userInvocable: summary.invocation.userInvocable,
          flat,
          ...sidecar !== undefined ? { sidecar } : {},
        })
        continue
      }
      let manifest: CapabilityManifest
      try {
        manifest = manifestOf(definition)
      } catch (error) {
        // A skill without a (valid) yantao declaration is a skill, not a
        // capability — but a central route may claim it (registration's
        // channel), in which case it is a capability after all. Otherwise it
        // already lives in the KB, so registration can route it in place:
        // surface it in the 未注册 group with the reason, not silently.
        if (routes[summary.name] !== undefined) continue
        const flat = definition.path === undefined || basename(definition.path) !== 'SKILL.md'
        const directory = !flat && definition.resourceBase?.kind === 'directory'
          ? definition.resourceBase.path
          : undefined
        unregistered.push({
          name: summary.name,
          description: summary.description,
          source: summary.source,
          ...directory !== undefined ? { directory } : {},
          userInvocable: summary.invocation.userInvocable,
          flat,
          inKb: true,
          reason: error instanceof CapabilityError ? error.message : String(error),
        })
        continue
      }
      const record = readCapabilityRecord(kbRoot, summary.name)
      capabilities.push({
        name: summary.name,
        description: summary.description,
        source: summary.source,
        ...summary.resourceBase?.kind === 'directory' ? { directory: summary.resourceBase.path } : {},
        ...manifest.entry !== undefined ? { entry: manifest.entry, runtime: manifest.runtime } : {},
        ...manifest.appliesTo !== undefined ? { appliesTo: manifest.appliesTo } : {},
        invocation: manifest.invocation,
        ...record?.lastRunAt !== undefined ? { lastRunAt: record.lastRunAt } : {},
        ...record?.state !== undefined ? { state: record.state as JsonValue } : {},
      })
    }
    // Plugin repositories (ADR-0025 决定 1): directories under `.dsh/skills/`
    // that the registry never claimed — no top-level `SKILL.md` for
    // `discoverRoot`'s one-level scan — but that carry nested
    // `skills/<name>/SKILL.md` bundles. A Claude-style plugin repository
    // dropped whole into the skills directory looks exactly like this;
    // registration routes the nested skills in the central file instead of
    // writing a sidecar no scanner would ever see.
    const claimed = new Set(
      summaries
        .map(summary => summary.resourceBase)
        .filter((base): base is Extract<typeof base, { kind: 'directory' }> => base?.kind === 'directory')
        .map(base => resolve(base.path)),
    )
    const skillsRoot = join(kbRoot, '.dsh', 'skills')
    const dropped = await readdir(skillsRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of dropped) {
      if (!entry.isDirectory() || claimed.has(resolve(skillsRoot, entry.name))) continue
      const repository = join(skillsRoot, entry.name)
      const nested = await readdir(join(repository, 'skills'), { withFileTypes: true }).catch(() => [])
      const nestedSkills: string[] = []
      for (const child of nested) {
        if (!child.isDirectory()) continue
        if (await stat(join(repository, 'skills', child.name, 'SKILL.md')).then(() => true, () => false)) {
          nestedSkills.push(child.name)
        }
      }
      if (nestedSkills.length === 0) continue
      // Fully routed: every nested child is a capability now — the row is done.
      if (nestedSkills.every(child => routes[child] !== undefined)) continue
      unregistered.push({
        name: entry.name,
        description: `插件仓库，内含技能：${nestedSkills.sort().join('、')}`,
        source: 'kb',
        directory: repository,
        userInvocable: true,
        flat: false,
        inKb: true,
        plugin: true,
        pluginSkills: nestedSkills,
        reason: `插件仓库：顶层没有 SKILL.md，注册将在中央路由 ${ROUTES_PATH} 为内含技能各写一条路由`,
      })
    }
    // The central routes (ADR-0025 落地注记二) become capability rows: the
    // description is read from the routed SKILL.md's frontmatter, the reach
    // from the route entry. A name a sidecar capability already claimed is
    // skipped — the sidecar wins; a route whose target was deleted is stale
    // and skipped too.
    for (const [routedName, route] of Object.entries(routes)) {
      if (capabilities.some(capability => capability.name === routedName)) continue
      const routed = await routedSkill(skillsRoot, route)
      if (routed === undefined) continue
      const record = readCapabilityRecord(kbRoot, routedName)
      capabilities.push({
        name: routedName,
        description: routed.description,
        source: 'kb',
        directory: routed.directory,
        invocation: route.invocation,
        ...route.appliesTo !== undefined ? { appliesTo: route.appliesTo } : {},
        ...record?.lastRunAt !== undefined ? { lastRunAt: record.lastRunAt } : {},
        ...record?.state !== undefined ? { state: record.state as JsonValue } : {},
      })
    }
    unregistered.sort((left, right) => left.name.localeCompare(right.name))
    return { capabilities, unregistered }
  }

  /**
   * Read a directory's `yantao.json` sidecar, answering undefined when there
   * is none or it is unreadable — an unregistered skill's sidecar is a
   * preview for the confirm box, never a gate.
   */
  private async sidecarOf(directory: string): Promise<JsonValue | undefined> {
    try {
      return JSON.parse(await readFile(join(directory, 'yantao.json'), 'utf8')) as JsonValue
    } catch {
      return undefined
    }
  }

  /**
   * Scaffold a new capability directory (ADR-0021 决定 8's 「新建能力」):
   * `<kbRoot>/.dsh/skills/<name>/` with a clean SKILL.md, a `yantao.json`
   * sidecar that declares the host entry, and an entry script that speaks the
   * run protocol and echoes its input — a working capability on the first
   * run, for the human to grow into theirs.
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
      '---',
      '',
      `# ${name}`,
      '',
      '（这里写给人类看：这个能力做什么、怎么用、有什么前提。）',
      '',
      '能力声明（入口、运行时、appliesTo）在本目录的 `yantao.json`，不在本文件里——',
      'SKILL.md 保持纯净，方便直接复用开源 skill 目录。',
      '',
      '## 执行契约',
      '',
      '入口是 `scripts/entry.py`，由工作台以子进程调用：stdin 收一个 JSON 对象',
      '`{name, kbRoot, input, state}`，stdout 回一个 JSON 对象。',
      '',
      '- 成功：`{ok: true, result: …}`，可选带 `state`（持久化到下次运行）和',
      '  `artifacts`（`[{"name": "文件名", "contentBase64": "…"}]`，由工作台落盘到',
      '  `.dsh/yantao/capabilities/<name>/`）。',
      '- 失败：`{ok: false, kind, message, hint}`。',
      '',
      '## 对 agent 开放（ADR-0023）',
      '',
      'yantao.json 里的 `invocation` 决定谁能调用：缺省 `["human"]`（只有能力 tab），',
      '声明 `["human", "agent"]` 后 agent 可在会话中经 `kb_run_capability` 调用。',
      '省略 `entry` 即指令型能力——没有脚本，agent 调用时直接收到本 SKILL.md 正文作为指令。',
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
    const yantaoJson = `${JSON.stringify({
      entry: 'scripts/entry.py',
      runtime: 'python',
      invocation: ['human'],
      version: 1,
    }, null, 2)}\n`
    try {
      await mkdir(join(directory, 'scripts'), { recursive: true })
      await writeFile(join(directory, 'SKILL.md'), skillMd, 'utf8')
      await writeFile(join(directory, 'yantao.json'), yantaoJson, 'utf8')
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

  /**
   * Adopt one unregistered skill (ADR-0025 决定 1): copy its directory into
   * `<kbRoot>/​.dsh/skills/<name>/` and declare it in the central routing
   * file (`invocation: ['human']`, no `entry` — an instruction capability;
   * ADR-0025 落地注记二). The copy, never a move: the source directory is
   * shared with every other dsh usage, and moving would steal it. Any
   * `yantao.json` sidecar the source carried is removed from the copy —
   * outside declarations never take effect silently; the confirm box showed
   * them before this call existed.
   *
   * Guards: the name must be a single safe path segment, the target must not
   * exist (a collision with a builtin or an adopted capability is refused,
   * never overwritten), and the skill must be a directory bundle that its
   * frontmatter has not marked `user-invocable: false`.
   * @param args - the unregistered skill's name.
   * @returns the adopted directory's KB-relative path.
   */
  @Remote('capabilityAdopt')
  async capabilityAdopt(args: KbCapabilityAdoptArgs): Promise<KbCapabilityAdoptResult> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，技能无处采纳。',
        { path: args.name },
      )
    }
    const name = args.name
    if (name === '.' || name === '..' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `技能名不能用作能力目录名：${name}`,
        { path: name },
      )
    }
    const definition = await this.ctx.skills.get(name, { cwd: this.kbRoot })
    const source = definition?.resourceBase?.kind === 'directory' ? definition.resourceBase.path : undefined
    if (definition === undefined || this.isKbSkill(definition) || source === undefined
      || definition.path === undefined || basename(definition.path) !== 'SKILL.md') {
      throw new RemoteError(
        'yantao-kb/rejected',
        `找不到可采纳的技能「${name}」。`,
        { path: name },
      )
    }
    if (!definition.invocation.userInvocable) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `技能「${name}」的 frontmatter 声明了 user-invocable: false，不可采纳。`,
        { path: name },
      )
    }
    const target = join(this.kbRoot, '.dsh', 'skills', name)
    if (await stat(target).then(() => true, () => false)) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `能力目录已存在：.dsh/skills/${name}`,
        { path: name },
      )
    }
    try {
      await cp(source, target, { recursive: true })
      // The copy must not carry the source's declaration in: a sidecar at a
      // registry-discovered path would take effect silently. Out-of-band
      // declarations never survive adoption; the declaration is the central
      // route written below (ADR-0025 落地注记二).
      await rm(join(target, 'yantao.json'), { force: true })
      await addRoutes(join(this.kbRoot, '.dsh', 'skills'), {
        [name]: { path: name, invocation: ['human'] },
      })
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法采纳技能「${name}」：${(error as Error).message}`,
        { path: name },
        { cause: error },
      )
    }
    await this.settleSkills([name])
    return { path: `.dsh/skills/${name}` }
  }

  /**
   * Register one in-KB skill as a capability (ADR-0025 决定 1) by writing a
   * route entry into the central routing file `.dsh/skills/yantao.json`
   * (ADR-0025 落地注记二) — pure configuration: no copy, no move, no rename,
   * the skill directory stays byte-identical. Registration always writes an
   * *instruction capability* (no `entry`, ADR-0023 决定 6): a third-party
   * skill's essence is its SKILL.md instructions, and nothing in the drop
   * speaks the run protocol, so the type is never a question the human
   * answers. The three boolean args are the reach of the capability:
   * `agentInvoke` widens `invocation` to `['human', 'agent']`,
   * `resourceMenu` writes `appliesTo.resource: true` (every resource's
   * right-click menu), `selectionMenu` writes `appliesTo.selection: true`
   * (the middle-pane right-click menu).
   *
   * A dropped **plugin repository** (no top-level `SKILL.md`, but nested
   * `skills/<name>/SKILL.md` bundles) registers as one route entry per
   * nested child, `path` pointing at `<repo>/skills/<child>` — any depth
   * works, because instruction capabilities run entirely controller-side and
   * never need the scanner to see the directory. The repository tree is
   * never touched, so updating it is a plain re-drop, and un-registering is
   * deleting the entry.
   *
   * Guards: the name must be a single safe path segment; a plain skill must
   * be a directory bundle inside the KB's own `.dsh/skills/` whose
   * frontmatter does not mark it `user-invocable: false`; a valid
   * declaration (sidecar or frontmatter) is never silently overwritten; and
   * a directory carrying an *invalid* `yantao.json` refuses too — delete or
   * fix that file first, a central route must not quietly shadow a
   * declaration the human left in place.
   * @param args - the in-KB skill's name and the capability's reach.
   * @returns the KB-relative path of the central routing file.
   */
  @Remote('capabilityRegister')
  async capabilityRegister(args: KbCapabilityRegisterArgs): Promise<KbCapabilityRegisterResult> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，技能无处注册。',
        { path: args.name },
      )
    }
    const name = args.name
    if (name === '.' || name === '..' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `技能名不能用作能力名：${name}`,
        { path: name },
      )
    }
    const skillsRoot = join(this.kbRoot, '.dsh', 'skills')
    const definition = await this.ctx.skills.get(name, { cwd: this.kbRoot })
    const directory = definition?.resourceBase?.kind === 'directory' ? definition.resourceBase.path : undefined
    if (definition === undefined && await this.pluginShape(join(skillsRoot, name))) {
      return this.registerPluginRoutes(skillsRoot, name, args)
    }
    if (definition === undefined || !this.isKbSkill(definition) || directory === undefined
      || definition.path === undefined || basename(definition.path) !== 'SKILL.md') {
      throw new RemoteError(
        'yantao-kb/rejected',
        `找不到可注册的技能「${name}」（注册只面向 KB 内 .dsh/skills/ 下的目录技能）。`,
        { path: name },
      )
    }
    if (!definition.invocation.userInvocable) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `技能「${name}」的 frontmatter 声明了 user-invocable: false，不可注册。`,
        { path: name },
      )
    }
    let declared = false
    try {
      manifestOf(definition)
      declared = true
    } catch {
      // Missing or invalid declaration: the repair path this call exists for.
    }
    if (declared) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `技能「${name}」已经是能力，无需注册。`,
        { path: name },
      )
    }
    // A sidecar file still in the directory means a broken one (a valid
    // declaration was refused above). A central route must not quietly
    // shadow a declaration the human left in place: fix or delete it first.
    if (await stat(join(directory, 'yantao.json')).then(() => true, () => false)) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `技能「${name}」目录里有一个无效的 yantao.json；请先删除或修复它，再注册。`,
        { path: name },
      )
    }
    await this.writeRoutes(skillsRoot, { [name]: this.routeEntry(name, args) })
    return { path: ROUTES_PATH }
  }

  /**
   * Whether a `.dsh/skills/` directory has the plugin shape: no top-level
   * `SKILL.md` (the scanner's entry point — its absence is why the registry
   * never claimed the directory) but at least one nested
   * `skills/<name>/SKILL.md` bundle.
   */
  private async pluginShape(repository: string): Promise<boolean> {
    if (await stat(join(repository, 'SKILL.md')).then(() => true, () => false)) return false
    const nested = await readdir(join(repository, 'skills'), { withFileTypes: true }).catch(() => [])
    for (const child of nested) {
      if (!child.isDirectory()) continue
      if (await stat(join(repository, 'skills', child.name, 'SKILL.md')).then(() => true, () => false)) return true
    }
    return false
  }

  /**
   * Register a plugin repository by routing (ADR-0025 落地注记二): one
   * central-file entry per nested `skills/<name>/SKILL.md` bundle, `path`
   * pointing inside the repository. All-or-nothing: a child whose name is
   * not a safe capability name, or that a sidecar capability already
   * claims, refuses the call before any entry is written. Existing route
   * entries for these names are overwritten — re-registering a re-dropped
   * repository is the update path.
   */
  private async registerPluginRoutes(
    skillsRoot: string,
    repository: string,
    args: KbCapabilityRegisterArgs,
  ): Promise<KbCapabilityRegisterResult> {
    const nested = await readdir(join(skillsRoot, repository, 'skills'), { withFileTypes: true })
    const children: string[] = []
    for (const child of nested) {
      if (!child.isDirectory()) continue
      if (await stat(join(skillsRoot, repository, 'skills', child.name, 'SKILL.md')).then(() => true, () => false)) {
        children.push(child.name)
      }
    }
    for (const child of children) {
      // The route key is the child's name; it must survive the routing
      // file's own validation, or the file would stop parsing.
      if (child === '.' || child === '..' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(child)) {
        throw new RemoteError(
          'yantao-kb/rejected',
          `插件内含技能目录名「${child}」不能用作能力名，注册被拒绝。`,
          { path: args.name },
        )
      }
      const definition = await this.ctx.skills.get(child, { cwd: this.kbRoot })
      if (definition === undefined || !this.isKbSkill(definition)) continue
      let declared = false
      try {
        manifestOf(definition)
        declared = true
      } catch {
        // A same-named skill without a valid declaration does not block the
        // route: the route wins over a broken or missing declaration.
      }
      if (declared) {
        throw new RemoteError(
          'yantao-kb/rejected',
          `插件内含技能「${child}」与既有能力同名，注册被拒绝；请先处理同名能力。`,
          { path: args.name },
        )
      }
    }
    const entries: Record<string, CapabilityRoute> = {}
    for (const child of children) {
      entries[child] = this.routeEntry(`${repository}/skills/${child}`, args)
    }
    await this.writeRoutes(skillsRoot, entries)
    return { path: ROUTES_PATH }
  }

  /**
   * Append route entries to the central routing file, surfacing a broken
   * existing file or an I/O failure as `yantao-kb/rejected`.
   */
  private async writeRoutes(skillsRoot: string, entries: Record<string, CapabilityRoute>): Promise<void> {
    try {
      await addRoutes(skillsRoot, entries)
    } catch (error: unknown) {
      throw new RemoteError(
        'yantao-kb/rejected',
        error instanceof CapabilityError ? error.message : `无法写入中央路由文件 ${ROUTES_PATH}。`,
        { path: ROUTES_PATH },
        { cause: error },
      )
    }
  }

  /**
   * One route entry assembled from the caller's reach choices; always an
   * instruction capability (no `entry`), so what lands in the routing file
   * is a declaration the run path accepts by construction.
   */
  private routeEntry(path: string, args: KbCapabilityRegisterArgs): CapabilityRoute {
    const appliesTo = {
      ...(args.resourceMenu === true ? { resource: true as const } : {}),
      ...(args.selectionMenu === true ? { selection: true as const } : {}),
    }
    return {
      path,
      invocation: args.agentInvoke === true ? ['human', 'agent'] : ['human'],
      ...(Object.keys(appliesTo).length > 0 ? { appliesTo } : {}),
    }
  }
}

export default YantaoKbController
