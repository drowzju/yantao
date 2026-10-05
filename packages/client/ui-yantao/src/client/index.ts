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
// Type-only: pulls the `ctx.slots` service merge (ui-renderer installs the
// registry), the `ctx.layout` Context merge (ui-layout owns the declaration),
// and the theme snapshot type.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the `ctx.uiWorkspace` Context merge (ui-workspace owns the
// declaration) — the first-run directory picker is its `pickDirectory`.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the `conversation.hero.brand.mark` slot-name merge
// (ui-conversation owns the declaration) — the hero mark is the one piece of
// the borrowed middle column we replace. Also the `ctx.conversation` service
// merge: ADR-0040's composer fill reaches the current session's input face
// through it.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `ctx.workspaces` service merge (the workspace
// controller owns the declaration) — ADR-0013 points it at the KB root.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the `ctx.sessions` service merge (the session controller's
// client face owns the declaration) — ADR-0025 决定 4 prompts the current
// session through it.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the `ctx.inputTriggers` service merge (ui-input-trigger
// owns the declaration) — the `@` menu's KB source registers through it.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: pulls the `ctx.locale` service merge (the locale plugin owns the
// declaration) — the workbench registers its `yantao.workbench` dictionaries
// through it.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  KbCapabilityRunArgs, KbCreatableEntityType, KbMailFetchArgs, KbMailMarkReadArgs, KbPersonRelation,
  KbPromptShortcutSaveArgs, KbProposalInboxEnqueueArgs, KbProposalInboxResolveArgs,
  KbScheduleMarkArgs, KbScheduleSaveArgs, KbWriteTodosArgs,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { AnalysisProgress, KnownEntities } from './mail-analysis.ts'
import { runMailAnalysis } from './mail-analysis.ts'
import { runCapabilityDistill, type CapabilityRunRecord } from './capability-distill.ts'
import { runRefine, type RefineRunnerArgs } from './refine.ts'
import { runScheduledTask } from './scheduler.ts'
import { runValidate, type ValidateScope } from './validate.ts'
import { loadModelsConfig, saveModelsConfig, type ModelsConfigDraft } from './model-config.ts'
import { promptCurrentSession } from './session-prompt.ts'
import { loadSessionDetail } from './session-detail.ts'
import { sessionRemoteOf } from './remote.ts'
import { Frame } from './frame/Frame.tsx'
import { ThemePresenter } from './frame/theme-presenter.ts'
import { WorkbenchLayout, createPanelSeat } from './frame/layout.ts'
import { YantaoMark } from './brand/YantaoMark.tsx'
import { alignWorkspace } from './kb-workspace.ts'
import { kbReferenceSource } from './kb-reference.ts'
import { capabilityGestureSource } from './capability-gesture.ts'
import { promptShortcutSource } from './prompt-shortcut-gesture.ts'
import { WORKBENCH_NS, en, zh } from './locales.ts'
import { MemoryProposalCard } from './MemoryProposalCard.tsx'
import {
  addMemory, adoptCapability, approveMemoryProposal, archiveEntity, archiveMails, createCapability, createEntity,
  deleteMemory, deleteMails, deleteResource,
  discardMemoryProposal, fetchMail, fillComposerWithShortcut, listMemory, listMemoryProposals,
  loadCapabilities, loadCapabilityDeclaration, loadIntake, loadLinks, loadPromptInjection, loadPromptShortcuts,
  loadRevision, loadRoot, loadTodos,
  loadWorkspace, loadResourceView, markMailRead, openExternal, readFile, registerCapability, registerResource, restoreEntity, runCapability,
  loadSchedules, markSchedule, savePromptShortcuts, saveSchedules, setKbRoot,
  enqueueInboxProposal, loadProposalInbox, resolveInboxProposal,
  setRelation, writeFile, writeTodos,
} from './remote.ts'
import type { CapabilityRegisterReach } from './remote.ts'
import type { MailMessage } from './remote.ts'
import { ContextStatusBar } from './ContextStatusBar.tsx'

export const name = 'ui-yantao'

// ADR-0039: the footer's context status bar seat. Declared here because the
// slot is yantao's own — the frame (root registration) declares it as a child
// and this plugin fills it; the `session-maybe` scope makes the slot
// machinery thread the current session's projection seat through.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'footer.status': { kind: 'list'; scope: 'session-maybe' }
  }
}
// Cordis forbids reading an undeclared service, and a Remote namespace counts
// as one of its own: both the `remote` face and this namespace must be listed
// or the accessor throws "cannot get property remote.yantaoKb without inject".
// `uiWorkspace` is the host's directory picker the first-run flow calls.
// `remote.session` is ADR-0019's: the mail analysis creates and drives a real
// dsh session from the browser. `sessions` is ADR-0025 决定 4's: the current
// session is read (and, when none is open, created and selected) through it.
// `remote.settings` / `remote.credentials` are the 配置 dialog's data plane:
// the model gateway's profile and the credential store the raw key lands in.
export const inject = [
  'slots', 'theme', 'locale', 'remote', 'remote.yantaoKb', 'remote.session', 'remote.settings', 'remote.credentials',
  'sessions', 'uiWorkspace', 'workspaces', 'inputTriggers', 'conversation',
]

/**
 * Contribute the workbench shell.
 *
 * The 'root' registration is a bare `register`, not `slots.inject`: the key is
 * the runtime's own built-in slot, seeded when the registry is constructed, so
 * it is always declared by the time a plugin applies. The two seats this frame
 * declares are the ones upstream's conversation and command surfaces depend on:
 * `conversation` renders the host's agent surface, and `shell.overlay` carries
 * ui-commands' popupSelect.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // Workbench copy: register the dictionaries for the plugin's lifetime and
  // bind the translate face threaded through the component tree as a prop.
  ctx.effect(() => ctx.locale.register(WORKBENCH_NS, { zh, en }), 'ui-yantao: workbench dictionaries')
  const t = ctx.locale.bind(WORKBENCH_NS)

  // Panel actions: the frame fills this seat on mount, `ctx.layout` reads it.
  const panels = createPanelSeat()
  const layout = new WorkbenchLayout(panels)

  // ADR-0013: dsh's own workspace follows the KB root, so the middle column's
  // working directory is the directory every kb_* tool reads. Re-run after the
  // first-run flow adopts a new root; a failure here only costs
  // the alignment, so it is reported and forgotten.
  const align = (): void => {
    void alignWorkspace({
      root: () => loadRoot(ctx),
      workspaces: ctx.workspaces,
      startSession: (workspaceId) => { ctx.uiWorkspace.startSession(workspaceId) },
    }).catch((reason: unknown) => {
      console.warn('kb workspace alignment failed:', reason)
    })
  }
  align()
  ctx.effect(() => ctx.reflect.provide('layout', layout), 'ui-yantao: layout service')

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
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      // ADR-0039: the footer's context status bar — session-scoped so the
      // slot machinery hands it the current session's projection seat.
      'footer.status': { kind: 'list', scope: 'session-maybe' },
    },
    inject: () => ({
      t,
      panels,
      intake: () => loadIntake(ctx),
      workspace: () => loadWorkspace(ctx),
      read: (path: string) => readFile(ctx, path),
      // ADR-0046 决定 3: the render view feeds the read-only file tab's
      // pdf/html/eml renderers.
      readView: (path: string) => loadResourceView(ctx, path),
      write: (path: string, content: string) => writeFile(ctx, path, content),
      // ADR-0041 决定 7/8: the archive gestures — entities are never deleted
      // (决定 8), so they retire through the archive mechanism's two
      // directions; the delete gesture belongs to resources alone (below).
      archiveEntity: (locator: string) => archiveEntity(ctx, locator),
      restoreEntity: (locator: string) => restoreEntity(ctx, locator),
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
      pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
      links: (path: string) => loadLinks(ctx, path),
      revision: () => loadRevision(ctx),
      openExternal: (target: string) => openExternal(ctx, target),
      todos: () => loadTodos(ctx),
      writeTodos: (args: KbWriteTodosArgs) => writeTodos(ctx, args),
      mailFetch: (args: KbMailFetchArgs) => fetchMail(ctx, args),
      mailMarkRead: (args: KbMailMarkReadArgs) => markMailRead(ctx, args),
      mailDelete: (ids: readonly string[]) => deleteMails(ctx, ids),
      // ADR-0037: the archive arm — same human channel as the delete knife.
      mailArchive: (mails: readonly { entryId: string; summary?: string }[]) => archiveMails(ctx, mails),
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
      // ADR-0043 决定 7: the 能力 tab detail view's parsed-declaration 声明 section.
      capabilityDeclaration: (name: string) => loadCapabilityDeclaration(ctx, name),
      capabilityRun: (args: KbCapabilityRunArgs, signal?: AbortSignal) => runCapability(ctx, args, signal),
      // ADR-0044 决定 6: the 能力 tab's 提炼经验 gesture — one headless
      // session turns a finished run's envelope into 0–3 memory proposals.
      capabilityDistill: async (record: CapabilityRunRecord, signal?: AbortSignal) => {
        const cwd = await kbCwd()
        return runCapabilityDistill({
          ctx,
          name: record.name,
          ok: record.ok,
          ...(record.exec !== undefined ? { exec: record.exec } : {}),
          ...(record.note !== undefined ? { note: record.note } : {}),
          ...(cwd !== undefined ? { cwd } : {}),
          ...(signal !== undefined ? { signal } : {}),
        })
      },
      capabilityCreate: (name: string) => createCapability(ctx, name),
      // ADR-0025 决定 1: adopt an out-of-KB skill into `.dsh/skills/`.
      capabilityAdopt: (name: string) => adoptCapability(ctx, name),
      // ADR-0025 决定 1: register an in-KB skill by writing its sidecar in place.
      capabilityRegister: (name: string, reach?: CapabilityRegisterReach) => registerCapability(ctx, name, reach),
      // ADR-0025 决定 4: an instruction capability's prompt goes to the
      // conversation the human is watching, on a KB-rooted session.
      promptSession: async (text: string) => {
        await promptCurrentSession(ctx, text, await kbCwd())
      },
      // ADR-0040: the 惯用提示词 surface — the 能力 tab's first-screen list
      // reads/writes the store, and clicking a row fills the composer.
      promptShortcutList: () => loadPromptShortcuts(ctx),
      promptShortcutSave: (args: KbPromptShortcutSaveArgs) => savePromptShortcuts(ctx, args),
      fillShortcut: (alias: string) =>{  fillComposerWithShortcut(ctx, alias) },
      // ADR-0045: the 调度 surface — the tab's definition list read/write,
      // and the scheduler's runner firing one snapshot prompt as a
      // KB-rooted background session (the mail analysis's cwd discipline).
      scheduleList: () => loadSchedules(ctx),
      scheduleSave: (args: KbScheduleSaveArgs) => saveSchedules(ctx, args),
      scheduleMark: (args: KbScheduleMarkArgs) => markSchedule(ctx, args),
      // ADR-0047: the 提议 surface — the scheduler's enqueue after a fired
      // session's answer parsed into a proposal, the inbox tab's read and
      // the two verdicts.
      proposalInboxList: () => loadProposalInbox(ctx),
      proposalInboxEnqueue: (args: KbProposalInboxEnqueueArgs) => enqueueInboxProposal(ctx, args),
      proposalInboxResolve: (args: KbProposalInboxResolveArgs) => resolveInboxProposal(ctx, args),
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
    }),
  }, Frame), 'ui-yantao: root frame')

  // The hero's brand mark: the middle column is upstream's, but the fish in
  // its headline is not ours to show. Declaration-aware registration — the
  // slot only exists while ui-conversation is mounted.
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, YantaoMark)), 'ui-yantao: hero brand mark')

  // ADR-0039: the footer's context status bar. The frame declared the
  // `footer.status` child slot with the `session-maybe` scope, so the slot
  // machinery threads the current session's useProjection/sessionId through;
  // the inject face carries only the yantao-share pricer, which reads the
  // KB remote on demand (panel open), not on every render.
  ctx.effect(() => ctx.slots.inject('footer.status', () =>
    ctx.slots.register({
      name: 'footer.status',
      id: 'yantao-context',
      locale: WORKBENCH_NS,
      inject: () => ({
        promptInjection: () => loadPromptInjection(ctx),
      }),
    }, ContextStatusBar)), 'ui-yantao: footer context status bar')

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
