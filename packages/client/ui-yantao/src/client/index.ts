/**
 * yantao workbench client plugin — the frame and its two rails (ADR-0011).
 *
 * dsh serves OUR dist and a plugin of ours contributes the whole browser
 * shell: it registers the runtime's built-in 'root' slot with a bespoke
 * three-column frame, keeps the host's conversation surface in the middle
 * through the `conversation` seat, and reads `ctx.remote.yantaoKb` for the
 * two rails. Nothing upstream is modified to place any of it.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
// Type-only: pulls the `ctx.slots` service merge (ui-renderer installs the
// registry), the `ctx.layout` Context merge (ui-layout owns the declaration),
// and the theme snapshot type.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the `ctx.uiWorkspace` Context merge (ui-workspace owns the
// declaration) — the first-run directory picker and ADR-0013's session
// alignment open sessions through it, via the dynamic-inject ref below.
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the `conversation.hero.brand.mark` slot-name merge
// (ui-conversation owns the declaration) — the hero mark is the one piece of
// the borrowed middle column we replace. Also the `ctx.conversation` service
// merge: ADR-0040's composer fill reaches the current session's input face
// through it.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionInputResolver } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `ctx.workspaces` service merge (the workspace
// controller owns the declaration) — ADR-0013 points it at the KB root.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the `ctx.sessions` service merge (the session controller's
// client face owns the declaration) — ADR-0025 决定 4 prompts the current
// session through it.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the `ctx.inputTriggers` service merge (ui-input-trigger
// owns the declaration) — the `@` menu's KB source registers through it.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: pulls the `ctx.locale` service merge (the locale plugin owns the
// declaration) — the workbench registers its `yantao.workbench` dictionaries
// through it.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `ctx.shortcuts` service merge (the shortcuts plugin
// owns the declaration) — the workbench's keyboard commands register through
// it (see ./shortcuts.ts).
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {
  KbCapabilityRouteUpdateArgs, KbCreatableEntityType, KbMailFetchArgs, KbMailMarkReadArgs, KbPersonRelation,
  KbPromptShortcutSaveArgs, KbProposalInboxEnqueueArgs, KbProposalInboxResolveArgs,
  KbScheduleMarkArgs, KbScheduleSaveArgs, KbSkillRewriteApplyArgs, KbWriteTodosArgs,
  KbWorkspaceRunArgs, KbWorkspaceSaveArgs,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { UsageWireDailyArgs } from '@deepseek-ai/dsh-api-yantao-usage-controller/types'
import type {
  KbProposalInboxApplyArgs, KbProposalInboxUndoArgs,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/proposal-apply'
import type { AnalysisProgress, KnownEntities } from './mail-analysis.ts'
import { runMailAnalysis } from './mail-analysis.ts'
import { runRefine, type RefineRunnerArgs } from './refine.ts'
import { runScheduledTask } from './scheduler.ts'
import { runValidate, type ValidateScope } from './validate.ts'
import { loadModelsConfig, saveModelsConfig, type ModelsConfigDraft } from './model-config.ts'
import { loadDingTalkConfig, saveDingTalkConfig, type DingTalkConfigDraft } from './dingtalk-config.ts'
import { promptCurrentSession } from './session-prompt.ts'
import { loadSessionDetail } from './session-detail.ts'
import { sessionRemoteOf, usageRemoteOf, unwrapRemote } from './remote.ts'
import { Frame } from './frame/Frame.tsx'
import { ThemePresenter } from './frame/theme-presenter.ts'
import { WorkbenchLayout, createPanelSeat } from './frame/layout.ts'
import { WorkbenchSidebarRight, createSidebarRightFileSeat } from './sidebar-right.ts'
import { YantaoMark } from './brand/YantaoMark.tsx'
import { alignWorkspace } from './kb-workspace.ts'
import { kbReferenceSource } from './kb-reference.ts'
import { capabilityGestureSource } from './capability-gesture.ts'
import { promptShortcutSource } from './prompt-shortcut-gesture.ts'
import { WORKBENCH_NS, en, zh } from './locales.ts'
import { installWorkbenchShortcuts } from './shortcuts.ts'
import { MemoryProposalCard } from './MemoryProposalCard.tsx'
import {
  addMemory, adoptCapability, applySkillRewriteRpc, approveMemoryProposal, archiveEntity, archiveMails, createCapability,
  createEntity,
  deleteMemory, deleteMails, deleteResource,
  discardMemoryProposal, fetchMail, fillComposerWithShortcut, listMemory, listMemoryProposals,
  loadCapabilities, loadIntake, loadLinks, loadPromptInjection, loadPromptShortcuts,
  loadRevision, loadRoot, loadTodos,
  loadWorkspace, loadResourceView, markMailRead, openExternal, readFile, registerCapability, registerResource, resolveEntity, restoreEntity,
  loadImageBinary,
  loadSchedules, markSchedule, savePromptShortcuts, saveSchedules, setKbRoot,
  enqueueInboxProposal, loadProposalInbox, loadRelationGraph, resolveInboxProposal,
  applyInboxProposal, undoInboxProposal,
  loadWorkspaces, saveWorkspaces, runWorkspaceInstruction, stopWorkspaceRun, loadWorkspaceRuns,
  clearWorkspaceRunHistory, deleteWorkspaceRunRow,
  setRelation, unregisterCapability, updateCapabilityRoute, writeFile, writeTodos,
} from './remote.ts'
import type { CapabilityRegisterReach } from './remote.ts'
import type { MailMessage } from './remote.ts'
import { loadSessionInsights } from './insights.ts'
import { InsightPane } from './frame/InsightPane.tsx'
import { InsightsPressureMark } from './frame/InsightsPressureMark.tsx'
import { SessionDashboard } from './frame/SessionDashboard.tsx'
import { SessionOverview } from './frame/SessionOverview.tsx'

export const name = 'ui-yantao'

/** Owner props the Frame hands the insights pane shell (`center.insights`). */
export interface CenterInsightsOwnerProps {
  /** Swings the centre pane back to the conversation tab. */
  onSwitchToConversation: () => void
  /** Whether the insights tab is the visible centre tab (the lazy-load gate). */
  active?: boolean | undefined
  /** The 关系图谱 sub-page's body — the frame's GraphPane element (ADR-0057). */
  graph: ReactNode
}

/** Owner props the pane shell hands the cross-session overview (`insights.overview`). */
export interface InsightsOverviewOwnerProps {
  /** Swings the centre pane back to the conversation tab. */
  onSwitchToConversation: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    // The keyed `main` slot is NOT re-declared here: ui-layout's global
    // SlotMap augmentation already carries it (identical shape), and a second
    // declaration makes gen-client-catalog refuse the duplicate. 0.2.1 起
    // 会话面走 keyed `main` 槽——见下方 root 注册的 children 注释。
    /**
     * ADR-0050: the insights tab's root pane — the sixth permanent centre
     * tab's shell. Root-scoped so it renders regardless of session
     * selection; the cross-session overview nests inside as
     * `insights.overview`, the current-session dashboard as `insights.session`.
     */
    'center.insights': { kind: 'single'; scope: 'root'; owner: CenterInsightsOwnerProps }
    /**
     * ADR-0050: the cross-session overview at the top of the insights pane —
     * root-scoped like its parent shell: KPI trio, trend bars, heatmap and
     * session cards aggregate the whole ledger, no session selection needed.
     */
    'insights.overview': { kind: 'single'; scope: 'root'; owner: InsightsOverviewOwnerProps }
    /**
     * ADR-0050: the current-session dashboard inside the insights pane —
     * `session-maybe` so the slot machinery threads the current session's
     * projection seat and identity through; blank (still mounted) while no
     * session is open.
     */
    'insights.session': { kind: 'single'; scope: 'session-maybe' }
    /**
     * ADR-0057: the 洞察 tab label's pressure dot — `session-maybe` so it
     * can read the current session's context pressure (ADR-0039's red line
     * lives on here; the footer button it used to ride on is retired).
     */
    'center.insights.pressure': { kind: 'single'; scope: 'session-maybe' }
  }
}
// Cordis forbids reading an undeclared service, and a Remote namespace counts
// as one of its own: both the `remote` face and this namespace must be listed
// or the accessor throws "cannot get property remote.yantaoKb without inject".
// `remote.session` is ADR-0019's: the mail analysis creates and drives a real
// dsh session from the browser. `sessions` is ADR-0025 决定 4's: the current
// session is read (and, when none is open, created and selected) through it.
// `remote.settings` / `remote.credentials` are the 配置 dialog's data plane:
// the model gateway's profile and the credential store the raw key lands in.
//
// 0.2.1 起刻意不在静态清单里等 `uiWorkspace` 和 `conversation`：ui-workspace
// 声明了 `layout`（本插件提供），ui-conversation 等 `uiWorkspace`（ui-workspace
// 提供），若本插件再静态等这两者，四个插件互等成环、全体 pending。两处消费
// 改走动态 `ctx.inject`（见 apply 里的两个引用座），服务就绪即入引用。
export const inject = [
  'slots', 'theme', 'locale', 'remote', 'remote.yantaoKb', 'remote.session', 'remote.settings', 'remote.credentials',
  'remote.yantaoUsage',
  'sessions', 'workspaces', 'inputTriggers', 'shortcuts',
]

/**
 * Contribute the workbench shell.
 *
 * The 'root' registration is a bare `register`, not `slots.inject`: the key is
 * the runtime's own built-in slot, seeded when the registry is constructed, so
 * it is always declared by the time a plugin applies. Of the four seats this
 * frame declares, the ones upstream surfaces depend on are `main` (keyed;
 * renders the host's agent surface, the Frame selects it with entryKey
 * 'conversation') and `shell.overlay` (ui-commands' popupSelect); the other
 * two are the insights tab's pane and its label's pressure dot (ADR-0050,
 * ADR-0057).
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // Workbench copy: register the dictionaries for the plugin's lifetime and
  // bind the translate face threaded through the component tree as a prop.
  ctx.effect(() => ctx.locale.register(WORKBENCH_NS, { zh, en }), 'ui-yantao: workbench dictionaries')
  const t = ctx.locale.bind(WORKBENCH_NS)

  // Panel actions: the frame fills this seat on mount, `ctx.layout` reads it.
  const panels = createPanelSeat()
  // Keyboard commands (tab jumps, config, intake rail) fire into the same
  // seat — no-ops until the frame mounts, handled afterwards.
  installWorkbenchShortcuts(ctx, panels, t)
  const layout = new WorkbenchLayout(panels)
  // The 0.2.1 `sidebarRight` stand-in: ui-chat / ui-reference inject the
  // service, the upstream provider (ui-sidebar-right) drags in ui-layout
  // (ADR-0011 exclusion), so the workbench answers `openResource` itself —
  // file addresses become centre-pane tabs. The frame fills the seat on
  // mount; the KB root resolves through the same loader the frame reads.
  const sidebarFiles = createSidebarRightFileSeat()
  const sidebarRight = new WorkbenchSidebarRight(sidebarFiles, async () => (await loadRoot(ctx)).root)

  // The 0.2.1 cycle-break (see the inject list's comment): `uiWorkspace` and
  // `conversation` arrive through dynamic injects into these refs instead of
  // the static list, so ui-workspace (waiting on our `layout`) can activate
  // without us first waiting on it. Call sites tolerate absence — the two
  // faces are interaction affordances, not boot prerequisites.
  const uiWorkspaceRef: { current?: UiWorkspace } = {}
  const whenUiWorkspace = (run: (svc: UiWorkspace) => void): void => {
    const svc = uiWorkspaceRef.current
    if (svc !== undefined) run(svc)
    else ctx.inject(['uiWorkspace'], (scope) => { run(scope.uiWorkspace) })
  }
  ctx.inject(['uiWorkspace'], (scope) => { uiWorkspaceRef.current = scope.uiWorkspace })
  const conversationRef: { current: { input?: SessionInputResolver } | undefined } = { current: undefined }
  ctx.inject(['conversation'], (scope) => {
    conversationRef.current = scope.conversation satisfies { input?: SessionInputResolver } | undefined
  })

  // ADR-0013: dsh's own workspace follows the KB root, so the middle column's
  // working directory is the directory every kb_* tool reads. Re-run after the
  // first-run flow adopts a new root; a failure here only costs
  // the alignment, so it is reported and forgotten.
  const align = (): void => {
    void alignWorkspace({
      root: () => loadRoot(ctx),
      workspaces: ctx.workspaces,
      startSession: (workspaceId) => { whenUiWorkspace((svc) => { svc.startSession(workspaceId) }) },
    }).catch((reason: unknown) => {
      console.warn('kb workspace alignment failed:', reason)
    })
  }
  align()
  ctx.effect(() => {
    ctx.reflect.provide('layout', layout)
    return () => { layout.dispose() }
  }, 'ui-yantao: layout service')
  ctx.effect(() => ctx.reflect.provide('sidebarRight', sidebarRight), 'ui-yantao: sidebarRight stand-in')

  // Theme presentation: pure DOM writes from resolved snapshots — the initial
  // state through the getter once, then event-driven only.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-yantao: theme presenter')

  // ADR-0020: the KB root as a session directory — a session created with it
  // lands in the session list the KB-scoped views already read, instead of
  // inheriting the host process's cwd.
  const kbCwd = async (): Promise<string | undefined> => {
    try {
      const root = await loadRoot(ctx)
      return root.root === '' ? undefined : root.root
    } catch {
      return undefined
    }
  }

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    children: {
      // 0.2.1 起与上游对齐:会话面走 keyed 的 `main` 槽(Frame 以
      // entryKey 'conversation' 选中),不再是 single 的 `conversation` 槽。
      'main': { kind: 'keyed', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      // ADR-0050/0057: the insights tab — a root-scoped pane shell plus the
      // tab label's pressure dot, session-scoped so it reads the current
      // session's context pressure.
      'center.insights': { kind: 'single', scope: 'root' },
      'center.insights.pressure': { kind: 'single', scope: 'session-maybe' },
    },
    inject: () => ({
      t,
      panels,
      // The sidebarRight stand-in's seat: the frame fills `openFile` on mount.
      sidebarFiles,
      intake: () => loadIntake(ctx),
      workspace: () => loadWorkspace(ctx),
      read: (path: string) => readFile(ctx, path),
      // ADR-0046 决定 3: the render view feeds the read-only file tab's
      // pdf/html/eml renderers.
      readView: (path: string) => loadResourceView(ctx, path),
      // ADR-0048 一期: the reading view's local image preloads ride the same
      // base64-over-RPC transport.
      readImage: (path: string) => loadImageBinary(ctx, path),
      write: (path: string, content: string) => writeFile(ctx, path, content),
      // ADR-0041 决定 7/8: the archive gestures — entities are never deleted
      // (决定 8), so they retire through the archive mechanism's two
      // directions; the delete gesture belongs to resources alone (below).
      archiveEntity: (locator: string) => archiveEntity(ctx, locator),
      restoreEntity: (locator: string) => restoreEntity(ctx, locator),
      // The proposal applier's locator normalization (2026-10-13 周报流水事故):
      // an approved card's `entityPath` may be `project:某项目` — resolve it
      // before the applier's literal read.
      resolveEntity: (locator: string) => resolveEntity(ctx, locator),
      // ADR-0020: resources are dumb raw material — unlike entities they may
      // be deleted, through the workbench's right-click 「删除」.
      deleteResource: (path: string) => deleteResource(ctx, path),
      setRelation: (path: string, relation: KbPersonRelation) => setRelation(ctx, path, relation),
      createEntity: (type: KbCreatableEntityType, name: string, relation?: KbPersonRelation, email?: string) =>
        createEntity(ctx, {
          type,
          name,
          ...(relation !== undefined ? { relation } : {}),
          ...(email !== undefined ? { email } : {}),
        }),
      root: () => loadRoot(ctx),
      setRoot: (path: string) => setKbRoot(ctx, path),
      pickDirectory: () => new Promise<string | null>((resolve, reject) => {
        whenUiWorkspace((svc) => { svc.pickDirectory().then(resolve, reject) })
      }),
      links: (path: string) => loadLinks(ctx, path),
      revision: () => loadRevision(ctx),
      openExternal: (target: string) => openExternal(ctx, target),
      todos: () => loadTodos(ctx),
      writeTodos: (args: KbWriteTodosArgs) => writeTodos(ctx, args),
      mailFetch: (args: KbMailFetchArgs) => fetchMail(ctx, args),
      mailMarkRead: (args: KbMailMarkReadArgs) => markMailRead(ctx, args),
      mailDelete: (ids: readonly string[]) => deleteMails(ctx, ids),
      // ADR-0037: the save arm — same human channel as the delete knife;
      // 2026-10-09 三提名合一, attachments ride with the .eml original.
      mailArchive: (mails: readonly { entryId: string; summary?: string }[]) => archiveMails(ctx, mails),
      // ADR-0054: the skill-rewrite writeback — backup + version clamp +
      // atomic write live in the controller; the tick on the card arms it.
      skillRewriteApply: (args: KbSkillRewriteApplyArgs) => applySkillRewriteRpc(ctx, args),
      analyseMail: async (
        mails: readonly MailMessage[],
        known: KnownEntities,
        onProgress?: (progress: AnalysisProgress) => void,
        signal?: AbortSignal,
        memory?: string,
      ) => {
        const cwd = await kbCwd()
        return runMailAnalysis({
          ctx, mails, known,
          ...(cwd !== undefined ? { cwd } : {}),
          ...(onProgress !== undefined ? { onProgress } : {}),
          ...(signal !== undefined ? { signal } : {}),
          ...(memory !== undefined ? { memory } : {}),
        })
      },
      // ADR-0029: the refine loop — both gestures run their dedicated session
      // rooted at the KB root, exactly the mail analysis's cwd discipline.
      refine: async (gesture: RefineRunnerArgs) => {
        const cwd = await kbCwd()
        return runRefine({ ctx, ...gesture, ...(cwd !== undefined ? { cwd } : {}) })
      },
      // ADR-0035: the scoped validate pass (人物 / 项目 angles) — the same
      // KB-rooted session discipline as refine's.
      validate: async (options: {
        scope: ValidateScope
        signal?: AbortSignal
        onStage?: (stage: 'prescan' | 'analyse' | 'proposal') => void
        onSession?: (sessionId: string) => void
      }) => {
        const cwd = await kbCwd()
        return runValidate({ ctx, ...options, ...(cwd !== undefined ? { cwd } : {}) })
      },
      // ADR-0020: the resource intake.
      registerResource: (name: string, contentBase64: string) => registerResource(ctx, name, contentBase64),
      // ADR-0021: the capability surface the 能力 tab reads.
      capabilityList: () => loadCapabilities(ctx),
      // ADR-0053 决定 2: the detail page's reach toggles and 注销 button —
      // both write the central route and nothing else.
      capabilityRouteUpdate: (args: KbCapabilityRouteUpdateArgs) => updateCapabilityRoute(ctx, args),
      capabilityUnregister: (name: string) => unregisterCapability(ctx, name),
      capabilityCreate: (name: string) => createCapability(ctx, name),
      // ADR-0025 决定 1: adopt an out-of-KB skill into `.dsh/skills/`.
      capabilityAdopt: (name: string) => adoptCapability(ctx, name),
      // ADR-0025 决定 1: register an in-KB skill by writing its central-route entry.
      capabilityRegister: (name: string, reach?: CapabilityRegisterReach) => registerCapability(ctx, name, reach),
      // ADR-0025 决定 4: an instruction capability's prompt goes to the
      // conversation the human is watching, on a KB-rooted session.
      promptSession: async (text: string) => {
        await promptCurrentSession(ctx, text, await kbCwd(), (sessionId) => {
          whenUiWorkspace((svc) => { svc.openSession(sessionId) })
        })
      },
      // ADR-0040: the 惯用提示词 surface — the 能力 tab's first-screen list
      // reads/writes the store, and clicking a row fills the composer.
      promptShortcutList: () => loadPromptShortcuts(ctx),
      promptShortcutSave: (args: KbPromptShortcutSaveArgs) => savePromptShortcuts(ctx, args),
      fillShortcut: (alias: string) => { fillComposerWithShortcut(ctx, conversationRef.current, alias) },
      // ADR-0045: the 调度 surface — the tab's definition list read/write,
      // and the scheduler's runner firing one snapshot prompt as a
      // KB-rooted background session (the mail analysis's cwd discipline).
      scheduleList: () => loadSchedules(ctx),
      scheduleSave: (args: KbScheduleSaveArgs) => saveSchedules(ctx, args),
      scheduleMark: (args: KbScheduleMarkArgs) => markSchedule(ctx, args),
      // ADR-0056: the 工作空间 surface — the tab's definition read/full-list
      // save, the manual trigger, the stop and the run-history ring the
      // panel polls while a chain is live.
      workspaceList: () => loadWorkspaces(ctx),
      workspaceSave: (args: KbWorkspaceSaveArgs) => saveWorkspaces(ctx, args),
      workspaceRun: (args: KbWorkspaceRunArgs) => runWorkspaceInstruction(ctx, args),
      workspaceRunStop: (runId: string) => stopWorkspaceRun(ctx, runId),
      workspaceRunsList: () => loadWorkspaceRuns(ctx),
      workspaceRunsClear: () => clearWorkspaceRunHistory(ctx),
      workspaceRunDelete: (runId: string) => deleteWorkspaceRunRow(ctx, runId),
      // ADR-0047: the 提议 surface — the scheduler's enqueue after a fired
      // session's answer parsed into a proposal, the inbox tab's read and
      // the two verdicts.
      proposalInboxList: () => loadProposalInbox(ctx),
      proposalInboxEnqueue: (args: KbProposalInboxEnqueueArgs) => enqueueInboxProposal(ctx, args),
      proposalInboxResolve: (args: KbProposalInboxResolveArgs) => resolveInboxProposal(ctx, args),
      // ADR-0060 决定 7: the inbox apply runs server-side now — the same
      // shared applier the DingTalk approval card reaches, apply+settle in
      // one call, with the undo window living on the controller.
      proposalInboxApply: (args: KbProposalInboxApplyArgs) => applyInboxProposal(ctx, args),
      proposalInboxUndo: (args: KbProposalInboxUndoArgs) => undoInboxProposal(ctx, args),
      // ADR-0049: the 图谱 tab's relation graph — wiki edges plus project
      // frontmatter areas, typed and deduplicated.
      relationGraph: () => loadRelationGraph(ctx),
      runSchedule: async (args: {
        id: string
        name: string
        prompt: string
        signal?: AbortSignal
        onSession?: (sessionId: string) => void
      }) => {
        const cwd = await kbCwd()
        return runScheduledTask({ ctx, ...args, ...(cwd !== undefined ? { cwd } : {}) })
      },
      // ADR-0032 批次③: the behavior-memory surface — the 记忆 tab's
      // management view, the mail panel's direct write, and the proposal
      // card's 记忆 rows all land on these three.
      memoryList: () => listMemory(ctx),
      memoryAdd: (scope: string, text: string) => addMemory(ctx, scope, text),
      memoryDelete: (scope: string, id: string) => deleteMemory(ctx, scope, id),
      // ADR-0044 决定 7: the 记忆 tab's 待批准 zone — the queue's read and
      // the two verdicts; the approve may re-judge the destination scope.
      memoryProposalList: () => listMemoryProposals(ctx),
      memoryProposalApprove: (scope: string, text: string, targetScope?: string) => approveMemoryProposal(ctx, scope, text, targetScope),
      memoryProposalDiscard: (scope: string, text: string) => discardMemoryProposal(ctx, scope, text),
      // ADR-0033: the 任务 tab's 「详情」 drawer reads one run's session log
      // back through the session Remote's existing follow/page faces.
      sessionDetail: (sessionId: string, signal?: AbortSignal) => {
        const session = sessionRemoteOf(ctx)
        if (session === undefined) return Promise.reject(new Error('没有挂载 session Remote 命名空间'))
        return loadSessionDetail(session, sessionId, signal)
      },
      onKbRootChanged: align,
      // 配置 dialog: the settings + credentials read/write seam. The raw key
      // travels only to the credentials store, never into the settings
      // document (hard rule 5) — see ./model-config.ts.
      loadModelsConfig: () => loadModelsConfig(ctx),
      saveModelsConfig: (draft: ModelsConfigDraft) => saveModelsConfig(ctx, draft),
      // 钉钉对话框（ADR-0060 决定 2）：settings + credentials 读写的接缝。
      // Secret 只进凭据存储（硬规则 5），配置命名空间只存非敏感字段——
      // 见 ./dingtalk-config.ts。
      loadDingTalkConfig: () => loadDingTalkConfig(ctx),
      saveDingTalkConfig: (draft: DingTalkConfigDraft) => saveDingTalkConfig(ctx, draft),
      // 快捷键目录的读面：注册表的 live catalog（键帽已按平台呈现，
      // 用户改键自动跟随），Frame 只过滤 yantao.* 展示。
      shortcutCatalog: ctx.shortcuts.catalog,
      // 裁决键等固定键在另一个目录（2026-10-14 目录缺 J/K/空格/回车 的修复）。
      shortcutFixedCatalog: ctx.shortcuts.fixedCatalog,
    }),
  }, Frame), 'ui-yantao: root frame')

  // The hero's brand mark: the middle column is upstream's, but the fish in
  // its headline is not ours to show. Declaration-aware registration — the
  // slot only exists while ui-conversation is mounted.
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, YantaoMark)), 'ui-yantao: hero brand mark')

  // ADR-0050: the insights tab's pane — the root shell; the current-session
  // dashboard rides the nested `insights.session` child (session-maybe), so
  // the slot machinery threads the current session's projection seat and
  // identity through while the shell itself survives session switches.
  ctx.effect(() => ctx.slots.register({
    name: 'center.insights',
    locale: WORKBENCH_NS,
    children: {
      'insights.overview': { kind: 'single', scope: 'root' },
      'insights.session': { kind: 'single', scope: 'session-maybe' },
    },
  }, InsightPane), 'ui-yantao: insights pane')

  // ADR-0050: the cross-session overview at the FOOT of the insights pane
  // (below the session dashboard). Its initial face carries a load button
  // rather than an auto-fetch, because its first ledger read can fold every
  // stored session; the inject
  // face carries the usage ledger readers (one full-ledger fetch feeds KPI
  // trio, bars, heatmap and cards alike — personal scale is a few hundred
  // rows) and the session-opening gesture; the session list itself arrives
  // through the standard `useSessions` prop the slot machinery threads.
  const usageOrFail = () => {
    const usage = usageRemoteOf(ctx)
    if (usage === undefined) throw new Error('没有挂载 yantaoUsage Remote 命名空间')
    return usage
  }
  ctx.effect(() => ctx.slots.inject('insights.overview', () =>
    ctx.slots.register({
      name: 'insights.overview',
      locale: WORKBENCH_NS,
      inject: () => ({
        dailyUsage: async (args: UsageWireDailyArgs) => {
          return unwrapRemote(await usageOrFail().dailyUsage(args))
        },
        fetchTotals: async (sessionId: string) => {
          return unwrapRemote(await usageOrFail().sessionUsage({ sessionId })).totals
        },
        openSession: (sessionId: string) => {
          // The generated face brands the id; the overview carries it as a
          // plain string everywhere (same cast as cancelSessionTurn).
          whenUiWorkspace((svc) => { svc.openSession(sessionId as SessionTarget) })
        },
      }),
    }, SessionOverview)), 'ui-yantao: insights cross-session overview')

  // ADR-0050: the current-session dashboard. The inject face carries the
  // yantao-share pricer (the composition card prices on open, latest answer
  // wins) and the full-log reader — the same session Remote face the 任务
  // tab's drawer reads through.
  ctx.effect(() => ctx.slots.inject('insights.session', () =>
    ctx.slots.register({
      name: 'insights.session',
      locale: WORKBENCH_NS,
      inject: () => ({
        promptInjection: () => loadPromptInjection(ctx),
        insightsLoader: (sessionId: string, signal?: AbortSignal) => {
          const session = sessionRemoteOf(ctx)
          if (session === undefined) return Promise.reject(new Error('没有挂载 session Remote 命名空间'))
          return loadSessionInsights(session, sessionId, signal)
        },
      }),
    }, SessionDashboard)), 'ui-yantao: insights session dashboard')

  // ADR-0057: the 洞察 tab label's pressure dot — the pressure alarm rides
  // the session-maybe scope (the footer button it used to live on retired
  // with ADR-0057's footer slim-down).
  ctx.effect(() => ctx.slots.inject('center.insights.pressure', () =>
    ctx.slots.register({
      name: 'center.insights.pressure',
      locale: WORKBENCH_NS,
    }, InsightsPressureMark)), 'ui-yantao: insights pressure dot')

  // ADR-0044 决定 5: the agent's kb_propose_memory call renders as the light
  // approval card — 原文 + 目标作用域 + 批准/丢弃, the shortest feedback loop
  // of the proposal-approval pipeline. The verdict buttons reach the human
  // channel's RPCs through the registration's inject face; like the memory
  // view's 待批准 zone, approving promotes to the proposal's own scope —
  // the capability that ran already said where the rule belongs.
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'kb_propose_memory',
      locale: WORKBENCH_NS,
      inject: () => ({
        approve: (scope: string, text: string) => approveMemoryProposal(ctx, scope, text),
        discard: (scope: string, text: string) => discardMemoryProposal(ctx, scope, text),
      }),
    }, MemoryProposalCard)), 'ui-yantao: memory proposal card')

  // `@` offers the KB's own entities; without this the menu lists only files
  // and sessions from the (unused) workspace.
  ctx.effect(() => ctx.inputTriggers.registerSource(kbReferenceSource({
    t,
    intake: () => loadIntake(ctx),
    workspace: () => loadWorkspace(ctx),
  })), 'ui-yantao: @ kb source')

  // ADR-0025 决定 6: `/` completes the capability gesture — menu only, no
  // match hooks, so ui-commands keeps its enter/space adjudication.
  ctx.effect(() => ctx.inputTriggers.registerSource(capabilityGestureSource(() => loadCapabilities(ctx))),
    'ui-yantao: / capability source')

  // ADR-0040: `/` also completes a 惯用项 — order −10 pins the group above
  // the capability inventory (order 0) and skills (order 2).
  ctx.effect(() => ctx.inputTriggers.registerSource(promptShortcutSource(() => loadPromptShortcuts(ctx))),
    'ui-yantao: / prompt-shortcut source')
}
