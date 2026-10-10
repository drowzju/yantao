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
 * The capability surface (ADR-0021) is `capabilityList`/`mailRun`/
 * `capabilityCreate`/`capabilityAdopt`/`capabilityRegister` (ADR-0025) —
 * plus `capabilityRouteUpdate`/`capabilityUnregister` (ADR-0053 决定 2), the
 * reach toggles and un-register gesture the 能力 tab renders. A capability
 * is a dsh skill directory claimed by exactly one entry in the central
 * routing file `.dsh/skills/yantao.json` (ADR-0052 决定 1: the only
 * capability configuration — sidecars and frontmatter channels are gone) —
 * and this controller seeds the shipped
 * ones, lists them, hands their instructions to the agent
 * (`kb_run_capability`), executes their scripts through the one exec bridge
 * (`kb_exec_capability_script`), drives the mail capability's entry script
 * through the dedicated `mailRun` RPC, and persists their state and run
 * accounts. The memory store (ADR-0032) is `memoryList`/`memoryAdd`/`memoryDelete`:
 * behavior rules as markdown files under `.dsh/yantao/memory/`, written only
 * through the human channel; the proposal queue (ADR-0044) is
 * `memoryProposalList`/`memoryProposalApprove`/`memoryProposalDiscard` — the
 * holding pen an agent's `kb_propose_memory` fills and only a human drains.
 * The proposal inbox (ADR-0047) gains the same shape for schedule
 * nominations (ADR-0055): the agent's `kb_propose_actions` fills it, the
 * human drains it from the 提议 tab.
 * The UI is the human
 * channel, so `write` is a full-file write; the ADR-0004 trust boundary
 * binds only the agent's kb_ tools, never this surface.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller
 */

import { homedir } from 'node:os'
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
  parseTodoFile, PERSON_RELATIONS, readCapabilityRecord, readCapabilityState, recordCapabilityRun,
  registerResourceContent, relationGraphOf, resolveWithinKb, serializeTodoFile, setEntityArchived, todayStamp,
  writeCapabilityState, writeMailWatermark,
  appendMemoryEntry, listMemoryScopes, readMemoryScope, removeMemoryEntry, renderCapabilityMemoryBlock,
  listProposalScopes, proposalDisplayPath, removeMemoryProposalByText,
  loadSectionText, renderGlobalMemorySection, readGlobalMemoryEntries, YANTAO_SECTIONS,
  readPromptShortcuts, writePromptShortcuts, PROMPT_SHORTCUTS_DISPLAY_PATH,
  readSchedules, writeSchedules, markSchedule, SCHEDULES_DISPLAY_PATH,
  enqueueProposal, readProposalInbox, resolveProposalInboxEntry, PROPOSAL_INBOX_DISPLAY_PATH,
  readWorkspaces, writeWorkspaces, markInstruction, WORKSPACES_DISPLAY_PATH,
  readWorkspaceRuns, appendWorkspaceRun, WORKSPACE_RUNS_DISPLAY_PATH,
} from '@deepseek-ai/dsh-yantao-kb'
import type { EntityType, WorkspaceDef } from '@deepseek-ai/dsh-yantao-kb'
import { ensureBuiltinCapabilities, seedBuiltinRoutes } from './capability/builtin.ts'
import { applySkillRewrite } from './capability/rewrite.ts'
import { CAPABILITY_HINTS, CapabilityError, runCapability } from './capability/run.ts'
import type { CapabilityInvoker } from './capability/run.ts'
import { CAPABILITY_ENVIRONMENT_NOTE, execCapabilityScript, instructionTextOf } from './capability/exec.ts'
import { mailSpanNote, normalizeMailRange, partitionProposedActions } from './capability/proposal-actions.ts'
import { addRoutes, readRoutes, removeRoute, routedSkill, updateRoute, ROUTES_PATH } from './capability/routing.ts'
import type { CapabilityRoute } from './capability/routing.ts'
import { hasScheme, isOpenable, openWithDesktop } from './open.ts'
import { WorkspaceRuntime } from './workspace/runtime.ts'
import { workspaceTickScan } from './workspace/tick.ts'
import { KbRevision } from './watch.ts'
import type {
  KbCapabilityAdoptArgs,
  KbCapabilityAdoptResult,
  KbCreateEntityArgs,
  KbCreateEntityResult,
  KbDeleteResourceResult,
  KbCapabilityCreateArgs,
  KbCapabilityCreateResult,
  KbCapabilityListResult,
  KbCapabilityRegisterArgs,
  KbCapabilityRegisterResult,
  KbCapabilityRouteUpdateArgs,
  KbCapabilityRouteUpdateResult,
  KbCapabilityUnregisterArgs,
  KbCapabilityUnregisterResult,
  KbCapabilityRunArgs,
  KbCapabilityRunResult,
  KbCapabilitySummary,
  KbCapabilityInstructionsArgs,
  KbCapabilityInstructionsResult,
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
  KbWorkspaceListResult,
  KbWorkspaceRunArgs,
  KbWorkspaceRunResult,
  KbWorkspaceRunsListResult,
  KbWorkspaceRunStopArgs,
  KbWorkspaceRunStopResult,
  KbWorkspaceSaveArgs,
  KbWorkspaceSaveResult,
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
  KbSkillRewriteApplyArgs,
  KbSkillRewriteApplyResult,
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

/**
 * Durable sources for the controller's pre-step injections: the capability
 * catalog that opens every turn (`catalog`) and the script-type capability
 * notice (`notice`, ADR-0043 决定 3/5). Transcript consumers fall through
 * unknown producer kinds, so neither needs a dedicated presentation.
 */

/** The per-turn capability catalog injection. */
export interface CapabilityCatalogSource {
  readonly kind: 'yantao-kb-controller'
  /** The catalog is background material the model may act on. */
  readonly form: 'catalog'
  /** Advertised capabilities, in catalog order. */
  readonly entries: readonly { name: string; description: string }[]
}

/** The script-type capability notice injection. */
export interface CapabilityNoticeSource {
  readonly kind: 'yantao-kb-controller'
  /** One-line account of how the capability is reached. */
  readonly form: 'notice'
  /** The one-line account, also committed to the durable log. */
  readonly summary: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Capability catalog and script-type notices injected by the yantao-kb-controller. */
    'yantao-kb-controller': CapabilityCatalogSource | CapabilityNoticeSource
  }
}

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
  return '当前对 agent 开放的知识库能力（用 kb_run_capability 读取其 SKILL.md 指令正文，照其行事；'
    + '指令里的脚本步骤用 kb_exec_capability_script 执行，name 取自下表）：\n'
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

/**
 * The single-source verdict (ADR-0052 决定 2): which central-route entry
 * answers for one capability name. There is no second channel — no sidecar,
 * no frontmatter section — so the verdict is two-valued: the route answers,
 * or nothing does. A broken routing file is carried, not thrown — each
 * caller decides whether it rethrows (runs: a broken declaration must be
 * seen) or reports it (introspection: breakage stated, never thrown).
 */
type CapabilityResolution =
  | {
    /** The central route claims the name. */
    readonly channel: 'routed'
    readonly route: CapabilityRoute
  }
  | {
    /** No route answers for the name — it may not exist at all. */
    readonly channel: 'absent'
    /** Why the routing file itself could not be read, when it is broken. */
    readonly routeError?: unknown
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

  /** The workspace cron tick's cadence — same rhythm as the frontend scheduler. */
  private static readonly WORKSPACE_TICK_INTERVAL_MS = 30_000

  /** How old a workspace cron fire may be and still count as live (covers the scan interval). */
  private static readonly WORKSPACE_FIRE_TOLERANCE_MS = 300_000

  /** The KB's change counter (ADR-0017); pointed at the live root on each poll. */
  private readonly revisionWatch = new KbRevision()

  /**
   * The workspace runtime (ADR-0056 决定 4): spawn/stop/heal, owned by the
   * controller. Public readonly so tests can inject a fake spawn before
   * triggering.
   */
  readonly workspaceRuntime: WorkspaceRuntime

  /** Guards against overlapping ticks piling duplicate scans. */
  private workspaceTicking = false

  constructor(ctx: Context) {
    super(ctx, 'yantaoKbController', { namespace: 'yantaoKb' })
    this.workspaceRuntime = new WorkspaceRuntime({ kbRoot: () => this.kbRoot })
    this.ctx.effect(() => () => {
      this.revisionWatch.close()
    })
    // The workspace runtime's lifecycle (ADR-0056 决定 4): runs survive the
    // UI, so the controller owns them. On mount, heal the rows a dead
    // predecessor left `running` (never re-runs); on teardown, kill the
    // live trees and mark their rows interrupted. The cron tick is a
    // controller-side interval — the frontend scheduler's twin, moved
    // host-side because the fired work is a subprocess, not a UI action.
    this.ctx.effect(() => () => this.workspaceRuntime.dispose())
    this.ctx.effect(() => {
      void this.workspaceRuntime.healOnBoot().catch((error: unknown) => {
        console.warn('workspace run healing failed:', error)
      })
      const timer = setInterval(() => { void this.workspaceTick() }, YantaoKbController.WORKSPACE_TICK_INTERVAL_MS)
      return () => { clearInterval(timer) }
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
      // last message: on a session's first turn the runtime-context snapshot
      // lands *after* the user's gesture and used to swallow both the catalog
      // and the `/xxx` injection. Skip trailing runtime-context snapshots; any
      // other kind (assistant, tool) after the user spoke means the gesture is
      // no longer the pending prompt.
      let last: UserMessage | undefined
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message === undefined) return decision
        if (message.source.kind === 'user') { last = message; break }
        // The `runtime-context` kind lives in the agent-loop's own
        // MessageSourceMap augmentation, which this package's program does not
        // include (transcript consumers fall through unknown producer kinds);
        // widen through `string` for the comparison.
        if ((message.source.kind as string) !== 'runtime-context') return decision
      }
      if (last === undefined) return decision
      const injections: UserMessage[] = []
      const entries = await this.agentCapabilityCatalog()
      if (entries.length > 0) {
        const source: CapabilityCatalogSource = {
          kind: 'yantao-kb-controller', form: 'catalog', entries,
        }
        injections.push(createUserMessage({
          source,
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
        '读取一个能力（capability）的 SKILL.md 指令正文。可用能力以每轮注入的能力目录为准——目录里没有的不要猜。'
        + '能力是人安装并审定过的：本工具只返回技能的指令正文，你按指令行事；指令里「执行 python xxx」这类脚本步骤'
        + '用 kb_exec_capability_script 在该能力目录内执行。'
        + '只有路由声明了 "invocation": ["agent"] 的能力才能这样调用，其余会报 not-invocable。'
        + '返回末尾的【行为记忆·宿主转交】块是人批规则，可信且须遵守。',
      parameters: {
        name: { type: 'string', required: true, description: '能力名，取自注入的能力目录' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            runAt: { type: 'string', required: true },
            content: { type: 'string', required: true },
            memory: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: instructionTextOf(value.name, value.content, value.memory),
        }],
      },
      execute: async ({ name }) => {
        const answer = await this.runInstructions(name, 'agent')
        return {
          name: answer.name,
          runAt: answer.runAt,
          content: answer.content ?? '',
          ...(answer.memory !== undefined ? { memory: answer.memory } : {}),
        }
      },
    }))
    // The execution bridge (ADR-0043 决定 2, 路线二; ADR-0052 决定 3 — the
    // ONE script channel): run a script inside an installed capability's own
    // directory — the channel for an instruction capability's mid-task
    // "执行 python foo.py" steps and for a capability's own CLI. cwd is
    // pinned to the capability's skill directory; the command text is not
    // reviewed — installation is authorization (ADR-0021), the directory is
    // the only limit.
    this.ctx.tools.register(defineTool({
      name: 'kb_exec_capability_script',
      description:
        '在已安装能力的技能目录内执行一段脚本（ADR-0043 执行桥；ADR-0052 起是一切脚本执行的唯一通道）。'
        + '用途：技能指令里「执行 python xxx」这类中途步骤，或直接运行能力自带的命令行。'
        + 'cwd 锁定该能力的目录（<知识库>/.dsh/skills/<name>，越出即拒绝）；命令本身不做内容审查——安装即授权。'
        + 'KB_ROOT（知识库根目录）经环境变量送达，命令行里的 $KB_ROOT 与 %KB_ROOT% 占位符在执行前直接替换为真实路径——两种写法在任何平台都等价；'
        + 'stdin 也会收到一个 JSON 信封：input 若是 JSON 对象/数组会先解析成字典再送达（否则原样传字符串），state 字段携带该能力已持久化的断点。'
        + 'kb_run_capability 只返回技能的指令正文，脚本执行一律走本工具。',
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
          const result = await execCapabilityScript({
            name,
            skillsRoot,
            directory,
            command,
            kbRoot: this.kbRoot,
            ...input !== undefined ? { input } : {},
            ...timeoutMs !== undefined ? { timeoutMs } : {},
          })
          // The accounting seam (ADR-0053 决定 3): a bridged run's success is
          // its exit code; the gate above already threw on rejections, so
          // every call reaching here is a real run.
          recordCapabilityRun(this.kbRoot, name, result.ok)
          return result
        } catch (error: unknown) {
          throw badManifestError(error)
        }
      },
    }))
    // The nomination tool (ADR-0055, amending ADR-0047 决定 2): the agent's
    // WRITE-ONLY channel into the proposal inbox. The envelope-as-prose era
    // ended with the 2026-10-10 morning incident — a hand-written JSON
    // envelope was fragile (batch-merged actions, missing fields) and its
    // loss surfaced only through a whole extra repair turn. Here the
    // validation runs at the tool boundary: a bad row is named back as the
    // tool's failure and repaired within the same turn. The tool enqueues
    // only — every action still waits for the human's 批准 on the 提议 card,
    // so the trust anchor (the human's one decisive act) is unmoved.
    this.ctx.tools.register(defineTool({
      name: 'kb_propose_actions',
      description:
        '把值得人拍板的写入动作打包成一个提议，送进「提议」收件箱等人在提议页批准（ADR-0055）。'
        + '本工具只入队不执行——动作由人批准后才落库，不要为了让动作生效而调用本工具。'
        + 'actions 每项形如 {"kind":"append-log","entityPath":…,…}，kind 与必填字段在服务端校验：'
        + '不合格的项会被点名剔除（诊断随结果返回，修正后可再次调用补提），合格的项照常入队；'
        + '全部项都不合格才整单拒绝。'
        + '没有值得提议的动作就不要调用本工具（纯文字汇报即可）；入队成功后不要再在回答里重复输出信封 JSON。',
      parameters: {
        title: { type: 'string', required: true, description: '一句话概括这批动作，作为提议卡标题' },
        actions: {
          type: 'array',
          required: true,
          description: '待人工批准的写入动作列表，每项一个对象',
          items: { type: 'object', additionalProperties: true, description: '一个动作项：kind 加该类别的必填字段' },
        },
        note: { type: 'string', description: '给人的备注一行，显示在提议卡上；可省略' },
        mails: {
          type: 'object',
          additionalProperties: false,
          description: '邮件水位范围（仅邮件解析任务）：{"lastReadAt":"…","firstReadAt":"…"}，抄实际批次首尾的 receivedAt；人裁决时据此推进水位',
          properties: {
            lastReadAt: { type: 'string', description: '本批最后一封的 receivedAt（ISO 8601）' },
            firstReadAt: { type: 'string', description: '本批最早一封的 receivedAt（ISO 8601），可省略' },
          },
        },
        source: { type: 'string', description: '来源标识（调度约定会给出，如 schedule:sch_xxx）；交互会话省略' },
        sourceName: { type: 'string', description: '来源显示名（调度约定会给出）；交互会话省略' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            dropped: { type: 'array', items: { type: 'string' }, description: '被剔除项的逐条诊断；一项都没剔时缺省' },
          },
        },
        // Validation failure THROWS (the execute below) — a rendered value is
        // always an enqueued one; there is no ok:false face (ocr 评审 #6).
        render: (_args, value) => [{
          type: 'text',
          text: value.dropped === undefined
            ? `提议已入队（${value.id}），等人在「提议」页批准或丢弃。回答里不要再重复输出提议信封。`
            : `提议已入队（${value.id}），但 ${value.dropped.length} 项不合格被剔除：${value.dropped.join('；')}。`
              + '合格的已在卡上等人在「提议」页批准或丢弃；修正后可再次调用补提被剔除的动作。回答里不要再重复输出提议信封。',
        }],
      },
      execute: async ({ title, actions, note, mails, source, sourceName }) => {
        this.requireKbRootForInbox()
        // 逐项容错（2026-10-10 裁决）：一跑一卡的提名动辄几十项，整单制会让
        // 一条坏行沉掉整船。合格项照常入队，坏项点名随结果带回；只有全军覆没
        // 才拒绝——那时也没有任何东西可入队。信任锚不动：入队的每一项仍然
        // 要等人在提议卡上批准。
        const { valid, diagnostics } = partitionProposedActions(actions)
        if (valid.length === 0) {
          throw new Error(`提议未通过校验，没有一项合格（整单未入队）：${diagnostics.join('；')}`)
        }
        const range = normalizeMailRange(mails)
        const noteParts = [note, mailSpanNote(range)].filter((part): part is string => part !== undefined && part !== '')
        const stored = await enqueueProposal(this.kbRoot, {
          source: source === undefined || source.trim() === '' ? 'agent:kb_propose_actions' : source.trim(),
          sourceName: sourceName === undefined || sourceName.trim() === '' ? '会话提议' : sourceName.trim(),
          title,
          ...(noteParts.length > 0 ? { note: noteParts.join(' · ') } : {}),
          proposal: {
            title,
            actions: valid,
            ...(range !== undefined ? { mails: range } : {}),
          },
        })
        const fresh = stored.at(-1)
        return {
          id: fresh?.id ?? '',
          ...(diagnostics.length > 0 ? { dropped: [...diagnostics] } : {}),
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
   * Seed the shipped capabilities before any capability resolution (the
   * builtin directories' copy-on-missing, plus their reachability entries in
   * the central routing file, ADR-0052 决定 5), then wait out the filesystem
   * watcher for whatever was (re-)written. Every capability entry point
   * calls this, so a fresh KB answers with 邮件 on its very first open.
   */
  private async settleBuiltins(): Promise<void> {
    const seeded = ensureBuiltinCapabilities(this.kbRoot)
    await seedBuiltinRoutes(this.kbRoot)
    await this.settleSkills(seeded)
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
   * One capability's assembled instruction text (调度首跳直通): what the
   * agent would receive from `kb_run_capability`, minus the tool round-trip.
   * The scheduler inlines this ahead of a bound schedule's prompt at fire
   * time, so the session starts already holding the SKILL.md body.
   *
   * Human channel only — the fired session is a human-preauthorized run
   * (ADR-0045), so the route's `invocation` gate does not apply; resolution
   * still goes through the central routing file (ADR-0052) and the run is
   * accounted (ADR-0053 决定 3) exactly like a tool-mediated one.
   * @param args - the capability's name.
   * @returns the assembled instruction text (导语 + environment note +
   *   SKILL.md body + behavior memory when present).
   */
  @Remote('capabilityInstructions')
  async capabilityInstructions(args: KbCapabilityInstructionsArgs): Promise<KbCapabilityInstructionsResult> {
    const answer = await this.runInstructions(args.name, 'human')
    return {
      name: answer.name,
      instructions: instructionTextOf(answer.name, answer.content ?? '', answer.memory),
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
   * The workspace cron tick (ADR-0056 决定 5): scan every instruction, fire
   * the fresh due ones, record the stale ones as missed — never caught up.
   * The due/missed decision is the frontend scheduler's semantics, ported
   * pure into `workspace/tick.ts` and pinned by the parity spec.
   *
   * One deliberate guard beyond the ADR's 「并发不设限」: a cron whose
   * previous chain is STILL RUNNING does not stack a second chain — the
   * window is consumed (marked fired) and nothing spawns. Without it a
   * `* * * * *` instruction would pile a new codebuddy process every minute
   * for as long as the first chain runs; the global no-limit ruling was
   * about caps on distinct runs, not about one instruction re-entering
   * itself. The consumed window stays visible via `lastFiredAt`.
   */
  private async workspaceTick(): Promise<void> {
    if (this.workspaceTicking || !this.ctx.yantaoKb.configured) return
    this.workspaceTicking = true
    try {
      const spaces = await readWorkspaces(this.kbRoot)
      const now = new Date()
      for (const space of spaces) {
        for (const instruction of space.instructions) {
          const action = workspaceTickScan(instruction, now, YantaoKbController.WORKSPACE_FIRE_TOLERANCE_MS)
          if (action.kind === 'wait') continue
          if (action.kind === 'missed') {
            // 决定 5: record the miss, never catch up. The missed row is
            // born terminal — history, not a queue.
            await markInstruction(this.kbRoot, space.id, instruction.id, { lastMissedAt: now.toISOString() })
            await appendWorkspaceRun(this.kbRoot, {
              workspaceId: space.id,
              instructionId: instruction.id,
              instructionName: instruction.name,
              trigger: 'cron',
              steps: [],
              missed: true,
            }, now)
            continue
          }
          if (this.workspaceRuntime.hasRunning(instruction.id)) {
            await markInstruction(this.kbRoot, space.id, instruction.id, { lastFiredAt: now.toISOString() })
            continue
          }
          await markInstruction(this.kbRoot, space.id, instruction.id, {
            lastFiredAt: now.toISOString(),
            lastMissedAt: null,
          })
          await this.workspaceRuntime.trigger(space, instruction, 'cron')
        }
      }
    } catch (error: unknown) {
      // The tick is a background loop: a broken store or a transient IO
      // failure must not kill the interval — warn and retry next tick.
      console.warn('workspace tick failed:', error)
    } finally {
      this.workspaceTicking = false
    }
  }

  /**
   * The workspace store's listing (ADR-0056): the human's directory+agent
   * bindings with their instructions, in display order. The agent has no
   * tool into this surface at all (决定 1: 纯人通道).
   * @returns the workspaces as stored.
   */
  @Remote('workspaceList')
  async workspaceList(): Promise<KbWorkspaceListResult> {
    this.requireKbRootForWorkspaces(WORKSPACES_DISPLAY_PATH)
    try {
      return { workspaces: await readWorkspaces(this.kbRoot), path: WORKSPACES_DISPLAY_PATH }
    } catch (error: unknown) {
      throw this.workspaceError(error, WORKSPACES_DISPLAY_PATH)
    }
  }

  /**
   * Save the whole workspace list (ADR-0056): the UI edits a handful of
   * rows, so a full-list replace keeps reorder and delete trivially correct.
   * Human-channel only — creating the binding IS the authorization (决定 2).
   * The tick-owned stamps (`lastFiredAt` / `lastMissedAt`) never travel
   * through this save: an editor's stale snapshot must not rewind the
   * bookkeeping, so matching instruction ids keep the stamps the store
   * holds — the tick patches them through `markInstruction` instead.
   * @param args - the complete new list, in display order.
   * @returns the list as stored (normalized, stamps preserved).
   */
  @Remote('workspaceSave')
  async workspaceSave(args: KbWorkspaceSaveArgs): Promise<KbWorkspaceSaveResult> {
    this.requireKbRootForWorkspaces(WORKSPACES_DISPLAY_PATH)
    try {
      const current = await readWorkspaces(this.kbRoot)
      const merged = args.workspaces.map((space) => {
        const prevSpace = current.find(candidate => candidate.id === space.id)
        if (prevSpace === undefined) return space
        return {
          ...space,
          instructions: space.instructions.map((instruction) => {
            const prev = prevSpace.instructions.find(candidate => candidate.id === instruction.id)
            return prev === undefined ? instruction : {
              ...instruction,
              ...prev.lastFiredAt !== undefined ? { lastFiredAt: prev.lastFiredAt } : {},
              ...prev.lastMissedAt !== undefined ? { lastMissedAt: prev.lastMissedAt } : {},
            }
          }),
        }
      })
      await writeWorkspaces(this.kbRoot, merged as readonly WorkspaceDef[])
      return { workspaces: await readWorkspaces(this.kbRoot), path: WORKSPACES_DISPLAY_PATH }
    } catch (error: unknown) {
      throw this.workspaceError(error, WORKSPACES_DISPLAY_PATH)
    }
  }

  /**
   * Trigger one instruction NOW (ADR-0056 决定 3/5): the manual gesture —
   * an instruction without cron has no other way to run, and one with cron
   * can be fired on demand too. The run row is appended before this answers;
   * the chain itself proceeds in the background.
   * @param args - the workspace and instruction to run.
   * @returns the new run's id.
   */
  @Remote('workspaceRun')
  async workspaceRun(args: KbWorkspaceRunArgs): Promise<KbWorkspaceRunResult> {
    this.requireKbRootForWorkspaces(WORKSPACE_RUNS_DISPLAY_PATH)
    const { space, instruction } = await this.locateInstruction(args.workspaceId, args.instructionId)
    try {
      const runId = await this.workspaceRuntime.trigger(space, instruction, 'manual')
      return { runId }
    } catch (error: unknown) {
      throw this.workspaceError(error, WORKSPACE_RUNS_DISPLAY_PATH)
    }
  }

  /**
   * Stop one running chain (ADR-0056 决定 4): kill the current step's
   * process tree and mark the row `stopped`. A run that already settled —
   * or belongs to a dead controller — refuses.
   * @param args - the run to stop.
   * @returns the full run history as stored after the stop patch.
   */
  @Remote('workspaceRunStop')
  async workspaceRunStop(args: KbWorkspaceRunStopArgs): Promise<KbWorkspaceRunStopResult> {
    this.requireKbRootForWorkspaces(WORKSPACE_RUNS_DISPLAY_PATH)
    if (!this.workspaceRuntime.stop(args.runId)) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `运行 ${args.runId} 不在本进程运行中（已结束，或属于上次启动遗留的中断记录）。`,
        { path: WORKSPACE_RUNS_DISPLAY_PATH },
      )
    }
    try {
      return { runs: (await readWorkspaceRuns(this.kbRoot)).slice().reverse() }
    } catch (error: unknown) {
      throw this.workspaceError(error, WORKSPACE_RUNS_DISPLAY_PATH)
    }
  }

  /**
   * The run history (ADR-0056 决定 6): the ring of recent executions, newest
   * first. A log, not a queue — nothing here waits for a decision.
   * @returns the runs, newest first.
   */
  @Remote('workspaceRunsList')
  async workspaceRunsList(): Promise<KbWorkspaceRunsListResult> {
    this.requireKbRootForWorkspaces(WORKSPACE_RUNS_DISPLAY_PATH)
    try {
      return { runs: (await readWorkspaceRuns(this.kbRoot)).slice().reverse(), path: WORKSPACE_RUNS_DISPLAY_PATH }
    } catch (error: unknown) {
      throw this.workspaceError(error, WORKSPACE_RUNS_DISPLAY_PATH)
    }
  }

  /** Resolve one workspace instruction, refusing unknown ids with named prose. */
  private async locateInstruction(workspaceId: string, instructionId: string): Promise<{
    readonly space: WorkspaceDef
    readonly instruction: WorkspaceDef['instructions'][number]
  }> {
    const spaces = await readWorkspaces(this.kbRoot)
    const space = spaces.find(candidate => candidate.id === workspaceId)
    if (space === undefined) {
      throw new RemoteError('yantao-kb/rejected', `工作空间 ${workspaceId} 不存在。`, { path: WORKSPACES_DISPLAY_PATH })
    }
    const instruction = space.instructions.find(candidate => candidate.id === instructionId)
    if (instruction === undefined) {
      throw new RemoteError('yantao-kb/rejected', `指令 ${instructionId} 不存在于工作空间「${space.name}」。`, { path: WORKSPACES_DISPLAY_PATH })
    }
    return { space, instruction }
  }

  /** Map a kb-side workspace failure to a RemoteError the UI shows verbatim. */
  private workspaceError(error: unknown, path: string): RemoteError {
    if (error instanceof KbError) {
      return new RemoteError('yantao-kb/rejected', error.message, { path }, { cause: error })
    }
    return new RemoteError(
      'yantao-kb/rejected',
      `工作空间操作失败：${(error as Error).message}`,
      { path },
      { cause: error instanceof Error ? error : undefined },
    )
  }

  /** Refuse workspace calls before a KB root exists — the stores live beside it. */
  private requireKbRootForWorkspaces(path: string): void {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，工作空间无处存放。',
        { path },
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

  /**
   * Write one approved skill rewrite back (ADR-0054 决定 3/4): the human
   * channel's verdict on a `skill-rewrite` proposal row, landing as bytes.
   * The writeback re-resolves the route, refuses a stale diff, backs the
   * pre-write content up, and clamps SKILL.md's `metadata.yantao.version` to
   * the original's — the whole procedure lives in `capability/rewrite.ts`,
   * and this RPC only guards the KB root and dresses the failure.
   * @param args - the approved rewrite's envelope.
   * @returns what was written and where the backup sits.
   */
  @Remote('skillRewriteApply')
  async skillRewriteApply(args: KbSkillRewriteApplyArgs): Promise<KbSkillRewriteApplyResult> {
    this.requireKbRootForInbox()
    try {
      return await applySkillRewrite(this.kbRoot, args)
    } catch (error: unknown) {
      if (error instanceof CapabilityError) {
        throw new RemoteError('yantao-kb/capability', error.message, { kind: error.kind, hint: error.hint }, { cause: error })
      }
      throw new RemoteError(
        'yantao-kb/rejected',
        error instanceof Error ? error.message : String(error),
        { path: `.dsh/skills/${args.name}` },
        { cause: error instanceof Error ? error : undefined },
      )
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
   * The mail capability's dedicated RPC (ADR-0052 决定 5) — the one survivor
   * of the execution unification. The mail panel's verbs
   * (取数/删除/归档/附件下载) run the builtin envelope script through the
   * host-side subprocess machinery (`capability/run.ts`), on the human
   * channel only: the privileged verbs check the envelope's `channel`, which
   * the host injects and the caller cannot forge (ADR-0034 决定 5). It
   * occupies no slot in the generic capability execution chain — the route
   * entry only records mail's reachability.
   *
   * The controller, not the script, owns every write: artifacts land under
   * `.dsh/yantao/capabilities/mail/` at paths the script cannot choose, and
   * the returned state is persisted under `capabilities.mail.state` in the
   * KB's `.dsh/yantao/state.json` (ADR-0024).
   * @param args - the caller's input, handed to the entry script verbatim
   *   (`verb` picks the behavior; the default is 取数).
   * @param signal - the human channel's cancel line (ADR-0031): an abort
   *   kills the entry script's subprocess and rejects with the `cancelled`
   *   kind.
   * @returns what the run answered, when it ran, and which artifact paths were written.
   */
  @Remote('mailRun')
  async mailRun(args: KbCapabilityRunArgs, signal?: AbortSignal): Promise<KbCapabilityRunResult> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/capability',
        '还没有选择知识库目录，能力的状态无处记录。',
        { kind: 'no-root', hint: '先选择一次知识库目录，再使用邮件面板。' },
      )
    }
    await this.settleBuiltins()
    const kbRoot = this.kbRoot
    const skillsRoot = join(kbRoot, '.dsh', 'skills')
    const route = (await readRoutes(skillsRoot)).mail
    if (route === undefined) {
      throw capabilityNotFound('mail')
    }
    const directory = resolve(skillsRoot, route.path)
    const entryPath = join(directory, 'scripts', 'entry.py')
    if (!existsSync(entryPath)) {
      throw new RemoteError(
        'yantao-kb/capability',
        '邮件能力的入口脚本缺失：scripts/entry.py。',
        { kind: 'bad-manifest', hint: CAPABILITY_HINTS['bad-manifest'] },
      )
    }
    let output
    try {
      output = await runCapability({
        name: 'mail',
        directory,
        entryPath,
        kbRoot,
        input: args.input,
        // The dedicated RPC is the human channel's seam: the envelope says
        // `human`, which is what the privileged verbs (delete, archive,
        // attachment download) demand (ADR-0034 决定 5).
        channel: 'human',
        state: readCapabilityState(kbRoot, 'mail'),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error: unknown) {
      const failure = error instanceof CapabilityError ? error : undefined
      // The accounting seam (ADR-0053 决定 3): a cancellation (ADR-0031) is
      // neither success nor failure — it is not a run, and stays uncounted.
      if (failure?.kind !== 'cancelled') recordCapabilityRun(kbRoot, 'mail', false)
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
        const dir = join(kbRoot, '.dsh', 'yantao', 'capabilities', 'mail')
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, artifact.name), Buffer.from(artifact.contentBase64, 'base64'))
        written.push(`.dsh/yantao/capabilities/mail/${artifact.name}`)
      }
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/capability',
        `无法写入能力的产物文件：${(error as Error).message}`,
        { kind: 'other', hint: CAPABILITY_HINTS.other },
        { cause: error },
      )
    }
    if (output.state !== undefined) await writeCapabilityState(kbRoot, 'mail', output.state)
    recordCapabilityRun(kbRoot, 'mail', true)
    // The capability scope's behavior memory (ADR-0032 决定 4): the human
    // channel's client-driven flows read it from the result. A memory hiccup
    // must not fail the run, so capabilityMemory already degrades to absent.
    const memory = await this.capabilityMemory('mail')
    return {
      name: 'mail',
      runAt: new Date().toISOString(),
      ...output.result !== undefined ? { result: output.result as JsonValue } : {},
      ...(memory !== undefined ? { memory } : {}),
      artifacts: written,
      ...(output.exec !== undefined ? { exec: output.exec } : {}),
    }
  }

  /**
   * Rewrite one registered capability's reachability (ADR-0053 决定 2 — the
   * 运维开关's write path): the three toggles collapse onto the route entry's
   * `invocation` and `appliesTo`, the `path` is never touched. Pure
   * configuration: one read-modify-write over the central routing file.
   * @param args - the capability's name and the reach to write.
   * @returns the KB-relative path of the routing file.
   */
  @Remote('capabilityRouteUpdate')
  async capabilityRouteUpdate(args: KbCapabilityRouteUpdateArgs): Promise<KbCapabilityRouteUpdateResult> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，能力无处配置。',
        { path: args.name },
      )
    }
    const skillsRoot = join(this.kbRoot, '.dsh', 'skills')
    // Absent booleans mean "leave as-is"; the entry's current reach fills the gaps.
    const routes = await readRoutes(skillsRoot).catch((error: unknown) => { throw badManifestError(error) })
    const current = routes[args.name]
    if (current === undefined) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `中央路由文件 ${ROUTES_PATH} 里没有能力「${args.name}」的条目，无法更新。`,
        { path: args.name },
      )
    }
    const invocation = args.invocation ?? current.invocation
    const appliesTo = args.appliesTo ?? current.appliesTo
    try {
      await updateRoute(skillsRoot, args.name, {
        invocation,
        ...appliesTo !== undefined ? { appliesTo } : {},
      })
    } catch (error: unknown) {
      throw new RemoteError(
        'yantao-kb/rejected',
        error instanceof CapabilityError ? error.message : `无法更新中央路由文件 ${ROUTES_PATH}。`,
        { path: ROUTES_PATH },
        { cause: error },
      )
    }
    return { path: ROUTES_PATH }
  }

  /**
   * Unregister one capability (ADR-0053 决定 2): delete its entry from the
   * central routing file. The skill directory is untouched — the human's
   * files are never destroyed by an ops gesture; a later re-registration is
   * one click. Removing an unregistered name answers success anyway: the
   * confirm box already told the human what was about to happen, and the
   * end state is what matters.
   * @param args - the capability's name.
   * @returns the KB-relative path of the routing file.
   */
  @Remote('capabilityUnregister')
  async capabilityUnregister(args: KbCapabilityUnregisterArgs): Promise<KbCapabilityUnregisterResult> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/rejected',
        '还没有选择知识库目录，能力无处注销。',
        { path: args.name },
      )
    }
    try {
      await removeRoute(join(this.kbRoot, '.dsh', 'skills'), args.name)
    } catch (error: unknown) {
      throw new RemoteError(
        'yantao-kb/rejected',
        error instanceof CapabilityError ? error.message : `无法写入中央路由文件 ${ROUTES_PATH}。`,
        { path: ROUTES_PATH },
        { cause: error },
      )
    }
    return { path: ROUTES_PATH }
  }

  /**
   * The one resolution (ADR-0052 决定 1): the run path, the execution
   * bridge's directory lookup, and the `/xxx` gesture all read this one
   * verdict, so the gate they apply can never drift apart. The verdict is
   * two-valued — the central route answers, or nothing does. Routing-file
   * breakage is carried, not thrown — each caller decides whether it
   * rethrows (runs: a broken declaration must be seen) or swallows it
   * (gestures: a miss stays ordinary prose).
   */
  private async resolveCapability(name: string): Promise<CapabilityResolution> {
    let route: CapabilityRoute | undefined
    let routeError: unknown
    try {
      route = (await readRoutes(join(this.kbRoot, '.dsh', 'skills')))[name]
    } catch (error: unknown) {
      routeError = error
    }
    return route !== undefined
      ? { channel: 'routed', route }
      : { channel: 'absent', ...(routeError !== undefined ? { routeError } : {}) }
  }

  /**
   * Resolve the execution bridge's working directory (ADR-0052 决定 3): the
   * routed skill directory of the capability `name`, which must be open to
   * the agent. Resolution reads the central routing file only — there is no
   * second channel — and applies the route's `invocation` gate; only the
   * answer differs (a directory, not a run). `execCapabilityScript`
   * re-confines the answer under `.dsh/skills/` before spawning.
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
    // Seed the shipped capabilities before resolving, as in runInstructions.
    await this.settleBuiltins()
    const verdict = await this.resolveCapability(name)
    if (verdict.channel === 'absent') {
      if (verdict.routeError !== undefined) throw badManifestError(verdict.routeError)
      throw capabilityNotFound(name)
    }
    if (!verdict.route.invocation.includes('agent')) {
      throw capabilityNotInvocable(name, ROUTES_PATH)
    }
    // Route paths are confined by validation to the KB's skills root, so the
    // resolve is inherently KB-safe.
    return resolve(join(this.kbRoot, '.dsh', 'skills'), verdict.route.path)
  }

  /**
   * Run one capability's instructions (ADR-0052 决定 3): the SKILL.md body
   * of the routed capability is the whole answer. Nothing spawns, nothing
   * persists — script steps belong to the agent's `kb_exec_capability_script`.
   * Resolution reads the central routing file only; the agent channel passes
   * the route's `invocation` gate first. A passing run is accounted
   * (ADR-0053 决定 3) at this one seam.
   * @param name - the capability's skill name.
   * @param invoker - which channel is calling; only `'agent'` is gated.
   * @returns the instruction body, when it ran, and the capability scope's
   *   behavior memory (ADR-0032 决定 4) when the scope has remembered rules.
   */
  private async runInstructions(
    name: string,
    invoker: CapabilityInvoker,
  ): Promise<{ name: string; runAt: string; content: string; memory?: string }> {
    if (!this.ctx.yantaoKb.configured) {
      throw new RemoteError(
        'yantao-kb/capability',
        '还没有选择知识库目录，能力的状态无处记录。',
        { kind: 'no-root', hint: '先选择一次知识库目录，再运行能力。' },
      )
    }
    // The capability scope's behavior memory (ADR-0032 决定 4): read once per
    // run, attached to the answer. A scope with no remembered rules (or an
    // unreadable one) degrades to absent — a memory hiccup must not fail the
    // run.
    const memory = await this.capabilityMemory(name)
    // Seed the shipped capabilities before resolving: a first run on a fresh
    // KB would otherwise answer "not found" for a capability that is about to
    // be copied in.
    await this.settleBuiltins()
    const verdict = await this.resolveCapability(name)
    if (verdict.channel === 'absent') {
      if (verdict.routeError !== undefined) throw badManifestError(verdict.routeError)
      throw capabilityNotFound(name)
    }
    // The invocation gate (ADR-0023 决定 2): the agent only reaches what the
    // route declared `"agent"`; the human channel is ungated.
    if (invoker === 'agent' && !verdict.route.invocation.includes('agent')) {
      throw capabilityNotInvocable(name, ROUTES_PATH)
    }
    const routed = await routedSkill(join(this.kbRoot, '.dsh', 'skills'), verdict.route)
    if (routed === undefined) {
      throw new RemoteError(
        'yantao-kb/capability',
        `能力「${name}」的路由目标缺少可读的 SKILL.md：${verdict.route.path}`,
        { kind: 'bad-manifest', hint: CAPABILITY_HINTS['bad-manifest'] },
      )
    }
    recordCapabilityRun(this.kbRoot, name, true)
    return {
      name,
      runAt: new Date().toISOString(),
      content: routed.body,
      ...(memory !== undefined ? { memory } : {}),
    }
  }

  /**
   * The `/xxx` gesture's injection (ADR-0025 决定 3, ADR-0052 决定 1),
   * derived from one direct user message. A message opening with `/name`
   * naming a routed, human-invocable capability answers one injected
   * message: the SKILL.md body as `skill-invocation` instructions. Every
   * capability is instruction-shaped now — the route is the only channel,
   * and scripts go through `kb_exec_capability_script` per the injected
   * instructions themselves. A name that misses — no route, a
   * human-disabled one — stays ordinary prose: the gesture was never a
   * claim this boundary recognizes.
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
   * The agent-facing capability catalog (ADR-0023 决定 5, ADR-0052 决定 1):
   * every capability the central routing file opens to the agent (`invocation`
   * includes `"agent"`), as `{name, description}` rows read from the routed
   * SKILL.md's frontmatter. Nothing else is a capability — there is no
   * second channel. A broken routing file answers empty-ish (whatever was
   * readable is skipped) — background decoration must not break the turn.
   * @returns the catalog rows, in routing-file order.
   */
  private async agentCapabilityCatalog(): Promise<readonly { name: string; description: string }[]> {
    const kbRoot = this.kbRoot
    const entries: { name: string; description: string }[] = []
    let routes: Record<string, CapabilityRoute>
    try {
      routes = await readRoutes(join(kbRoot, '.dsh', 'skills'))
    } catch {
      return entries
    }
    for (const [routedName, route] of Object.entries(routes)) {
      if (!route.invocation.includes('agent')) continue
      const routed = await routedSkill(join(kbRoot, '.dsh', 'skills'), route)
      if (routed !== undefined) entries.push({ name: routedName, description: routed.description })
    }
    return entries
  }

  /**
   * The capabilities the workbench's 能力 tab shows (ADR-0021 决定 8,
   * ADR-0052 决定 1): exactly the entries of the central routing file
   * `.dsh/skills/yantao.json` — the only capability configuration there is.
   * Shipped capabilities are seeded first, so a fresh KB answers with 邮件
   * on its very first open. A route whose target lost its SKILL.md is stale
   * and skipped.
   *
   * Each row merges the route with the persisted record (`capabilities.<name>`
   * in the KB's `.dsh/yantao/state.json`, ADR-0024): when it last ran, how
   * many times, when it last failed, and the state that run left behind, so
   * the panel can show real usage semantics (ADR-0053 决定 4) without running
   * anything.
   *
   * The answer also carries the 未注册 group (ADR-0025 决定 1): skills
   * discovered outside the KB that adoption could copy in — directory
   * bundles, name-sorted, after the registered list — and skills living
   * inside the KB's own `.dsh/skills/` that no route claims yet, greyed rows
   * registration can promote in place. Bundled skills (dsh's own) are not
   * third-party finds and never appear.
   * @returns both groups.
   */
  @Remote('capabilityList')
  async capabilityList(): Promise<KbCapabilityListResult> {
    const kbRoot = this.kbRoot
    await this.settleBuiltins()
    const summaries = await this.ctx.skills.list({ cwd: kbRoot })
    // The central routing file (ADR-0052 决定 1): the capability roll. A
    // broken file answers no routes — the panel still lists the unregistered
    // finds.
    let routes: Record<string, CapabilityRoute> = {}
    try {
      routes = await readRoutes(join(kbRoot, '.dsh', 'skills'))
    } catch {
      routes = {}
    }
    const capabilities: KbCapabilitySummary[] = []
    const unregistered: KbUnregisteredSkill[] = []
    for (const [routedName, route] of Object.entries(routes)) {
      const routed = await routedSkill(join(kbRoot, '.dsh', 'skills'), route)
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
        ...record?.runCount !== undefined ? { runCount: record.runCount } : {},
        ...record?.lastFailAt !== undefined ? { lastFailAt: record.lastFailAt } : {},
        ...record?.state !== undefined ? { state: record.state as JsonValue } : {},
      })
    }
    for (const summary of summaries) {
      let definition: SkillDefinition | undefined
      try {
        definition = await this.ctx.skills.get(summary.name, { cwd: kbRoot })
      } catch {
        definition = undefined
      }
      if (definition === undefined) continue
      if (this.isKbSkill(definition)) {
        // Inside the KB but not in the roll: registration's repair path —
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
          reason: `尚未注册：中央路由 ${ROUTES_PATH} 里没有这个名字`,
        })
        continue
      }
      // Outside the KB: an adoption candidate (ADR-0025 决定 1), unless it is
      // dsh's own bundled skill — that one is not a third-party find. A name
      // the central routing file already claims is not offered either: the
      // routed capability answers, adoption would only collide. A skill under
      // the home skill roots (`~/.dsh/skills`, `~/.agents/skills`) is skipped
      // too: those are the owner's own deliberate installs, available to every
      // session on the machine — listing them as 未注册 noise conflated the
      // workbench's KB-scoped capability plane with the machine-wide skill
      // stock (2026-10-09). Path-judged, not source-judged: the source label
      // is a provider detail a rename would silently break.
      if (summary.source === 'bundled' || routes[summary.name] !== undefined) continue
      const candidateBase = summary.resourceBase
      if (candidateBase?.kind === 'directory') {
        const directory = resolve(candidateBase.path)
        const homeRoots = [join(homedir(), '.dsh', 'skills'), join(homedir(), '.agents', 'skills')]
        if (homeRoots.some(root => directory === resolve(root) || directory.startsWith(resolve(root) + sep))) continue
      }
      const directory = definition.resourceBase?.kind === 'directory' ? definition.resourceBase.path : undefined
      // A flat `xxx.md` skill's resourceBase is the shared skills root, not
      // a per-skill directory; the SKILL.md basename is what tells the two
      // apart. No path at all is treated the same way: nothing verifiable
      // to copy.
      const flat = definition.path === undefined || basename(definition.path) !== 'SKILL.md'
      unregistered.push({
        name: summary.name,
        description: summary.description,
        source: summary.source,
        ...!flat && directory !== undefined ? { directory } : {},
        userInvocable: summary.invocation.userInvocable,
        flat,
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
   * Scaffold a new capability directory (ADR-0021 决定 8's 「新建能力」,
   * ADR-0052 决定 1): `<kbRoot>/.dsh/skills/<name>/` with a clean SKILL.md —
   * an instruction capability from birth — plus one central-route entry that
   * opens it to the human. A working capability on the first run, for the
   * human to grow into theirs; script steps, if any ever arise, go through
   * the agent's `kb_exec_capability_script` per the instructions themselves.
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
      '## 给 agent 的指令',
      '',
      'agent 经 `kb_run_capability` 读到本文件的正文作为指令，照其行事；',
      '若指令涉及脚本步骤，用 `kb_exec_capability_script` 在本目录内执行，',
      '产出写入知识库的 `resources/`（临时文件放 `resources/temp/`）。',
      '',
    ].join('\n')
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'SKILL.md'), skillMd, 'utf8')
    } catch (error) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `无法创建能力目录：${(error as Error).message}`,
        { path: name },
        { cause: error },
      )
    }
    await this.writeRoutes(join(this.kbRoot, '.dsh', 'skills'), {
      [name]: { path: name, invocation: ['human'] },
    })
    await this.settleSkills([name])
    return { path: `.dsh/skills/${name}` }
  }

  /**
   * Adopt one unregistered skill (ADR-0025 决定 1): copy its directory into
   * `<kbRoot>/.dsh/skills/<name>/` and declare it in the central routing
   * file (`invocation: ['human']` — an instruction capability; ADR-0052
   * 决定 1). The copy, never a move: the source directory is shared with
   * every other dsh usage, and moving would steal it. Any `yantao.json`
   * sidecar the source carried comes along inert — sidecars are no longer a
   * declaration channel (ADR-0052), so nothing reads it.
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
   * (ADR-0052 决定 1: the only capability configuration) — pure
   * configuration: no copy, no move, no rename, the skill directory stays
   * byte-identical. Registration always writes an *instruction capability*:
   * a third-party skill's essence is its SKILL.md instructions, consumed via
   * `kb_run_capability`; script steps, if any, go through
   * `kb_exec_capability_script` per those instructions. The three boolean
   * args are the reach of the capability: `agentInvoke` widens `invocation`
   * to `['human', 'agent']`, `resourceMenu` writes `appliesTo.resource: true`
   * (every resource's right-click menu), `selectionMenu` writes
   * `appliesTo.selection: true` (the middle-pane right-click menu).
   *
   * A dropped **plugin repository** (no top-level `SKILL.md`, but nested
   * `skills/<name>/SKILL.md` bundles) registers as one route entry per
   * nested child, `path` pointing at `<repo>/skills/<child>` — any depth
   * works, because instruction consumption is entirely controller-side and
   * never needs the scanner to see the directory. The repository tree is
   * never touched, so updating it is a plain re-drop, and un-registering is
   * deleting the entry.
   *
   * Guards: the name must be a single safe path segment; a plain skill must
   * be a directory bundle inside the KB's own `.dsh/skills/` whose
   * frontmatter does not mark it `user-invocable: false`; and a name the
   * routing file already claims refuses — flip its reach toggles in the
   * panel instead of re-registering.
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
    // Single source (ADR-0052 决定 1): a name the routing file already
    // claims is a capability — the panel's reach toggles are its update
    // path, not a second registration.
    const existing = (await readRoutes(skillsRoot))[name]
    if (existing !== undefined) {
      throw new RemoteError(
        'yantao-kb/rejected',
        `技能「${name}」已是能力（中央路由已有它的条目），无需注册。`,
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
   * not a safe capability name refuses the call before any entry is written.
   * Existing route entries for these names are overwritten — re-registering
   * a re-dropped repository is the update path.
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
