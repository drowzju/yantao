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
// the borrowed middle column we replace.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `ctx.workspaces` service merge (the workspace
// controller owns the declaration) — ADR-0013 points it at the KB root.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the `ctx.inputTriggers` service merge (ui-input-trigger
// owns the declaration) — the `@` menu's KB source registers through it.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {
  KbCreatableEntityType, KbMailFetchArgs, KbMailMarkReadArgs, KbPersonRelation, KbWriteTodosArgs,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { AnalysisProgress, KnownEntities } from './mail-analysis.ts'
import { runMailAnalysis } from './mail-analysis.ts'
import type { BookReader, DomainConfirmer } from './reading-flow.ts'
import { runDomainConfirm, runReadingFlow } from './reading-flow.ts'
import { Frame } from './frame/Frame.tsx'
import { ThemePresenter } from './frame/theme-presenter.ts'
import { WorkbenchLayout, createPanelSeat } from './frame/layout.ts'
import { YantaoMark } from './brand/YantaoMark.tsx'
import { alignWorkspace } from './kb-workspace.ts'
import { kbReferenceSource } from './kb-reference.ts'
import {
  createEntity, deleteFile, extractResource, fetchMail, loadIntake, loadLinks, loadRevision, loadRoot, loadTodos,
  loadWorkspace, markMailRead, openExternal, readFile, registerResource, setKbRoot, setRelation, writeFile, writeTodos,
} from './remote.ts'
import type { MailMessage } from './remote.ts'

export const name = 'ui-yantao'
// Cordis forbids reading an undeclared service, and a Remote namespace counts
// as one of its own: both the `remote` face and this namespace must be listed
// or the accessor throws "cannot get property remote.yantaoKb without inject".
// `uiWorkspace` is the host's directory picker the first-run flow calls.
// `remote.session` is ADR-0019's: the mail analysis creates and drives a real
// dsh session from the browser.
export const inject = [
  'slots', 'theme', 'remote', 'remote.yantaoKb', 'remote.session', 'uiWorkspace', 'workspaces',
  'inputTriggers',
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

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    children: {
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({
      panels,
      intake: () => loadIntake(ctx),
      workspace: () => loadWorkspace(ctx),
      read: (path: string) => readFile(ctx, path),
      write: (path: string, content: string) => writeFile(ctx, path, content),
      deleteFile: (path: string) => deleteFile(ctx, path),
      setRelation: (path: string, relation: KbPersonRelation) => setRelation(ctx, path, relation),
      createEntity: (type: KbCreatableEntityType, name: string, relation?: KbPersonRelation) =>
        createEntity(ctx, { type, name, ...relation !== undefined ? { relation } : {} }),
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
      analyseMail: (
        mails: readonly MailMessage[],
        known: KnownEntities,
        onProgress?: (progress: AnalysisProgress) => void,
      ) =>
        runMailAnalysis({ ctx, mails, known, ...onProgress !== undefined ? { onProgress } : {} }),
      // ADR-0020: the resource intake and the reading flow.
      registerResource: (name: string, contentBase64: string) => registerResource(ctx, name, contentBase64),
      extractResource: (path: string) => extractResource(ctx, path),
      createReadingProject: (name: string, source: string) => createEntity(ctx, { type: 'project', name, source }),
      readBook: (options: Parameters<BookReader>[0]) => runReadingFlow({ ctx, ...options }),
      confirmDomains: (options: Parameters<DomainConfirmer>[0]) => runDomainConfirm({ ctx, ...options }),
      onKbRootChanged: align,
    }),
  }, Frame), 'ui-yantao: root frame')

  // The hero's brand mark: the middle column is upstream's, but the fish in
  // its headline is not ours to show. Declaration-aware registration — the
  // slot only exists while ui-conversation is mounted.
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, YantaoMark)), 'ui-yantao: hero brand mark')

  // `@` offers the KB's own entities; without this the menu lists only files
  // and sessions from the (unused) workspace.
  ctx.effect(() => ctx.inputTriggers.registerSource(kbReferenceSource({
    intake: () => loadIntake(ctx),
    workspace: () => loadWorkspace(ctx),
  })), 'ui-yantao: @ kb source')
}
