/**
 * The yantao workbench client plugin: occupies the layout `sidebar` slot
 * with the five-section KB tree (ui-sidebar is disabled in the yantao-web
 * roster, so its brand/settings declarations are free to re-declare) and
 * shadows `details` with the KB markdown editor. The cross-scope workbench
 * service is provided here so both occupants share one selection and tree.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only service and declaration merges used by the apply world.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { KbWorkbench } from './service.ts'
import { KbWorkbench as Workbench } from './service.ts'
import { KbSidebar } from './KbSidebar.tsx'
import { KbEditor } from './KbEditor.tsx'
import { en, NS, zh } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Selection and tree service shared by the workbench's sidebar and editor. */
    yantaoKbWorkbench: KbWorkbench
  }
}

/** The shared start-session action, provided by the ui-workspace plugin. */
interface WorkspaceNavigation {
  startSession(workspaceId?: string): void
}

/** Services required by the workbench plugin. */
export const inject = ['slots', 'layout', 'locale', 'sessions', 'uiWorkspace', 'remote', 'remote.yantaoKb']

/**
 * Mount the workbench contributions.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workbench = new Workbench(ctx.remote.yantaoKb)
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-yantao-kb: dictionaries')
  ctx.effect(
    () => ctx.reflect.provide('yantaoKbWorkbench', workbench),
    'ui-yantao-kb: workbench service',
  )

  // First tree load; failures surface in the sidebar through workbench.treeError.
  void workbench.refreshTree()

  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      // ui-sidebar is disabled in this roster, so the brand and settings
      // holes it would declare are free: brand-official and ui-settings mount
      // here exactly as they do on the stock surface.
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
      },
      inject: () => ({
        hooks: { workbench: workbench.source, kbSessions: ctx.sessions.list },
        selectFile: (path: string | null) => { workbench.select(path) },
        refreshTree: () => void workbench.refreshTree(),
        openSession: (id: string) => { ctx.sessions.open(id as SessionId) },
        newSession: () => { workspaceNavigation.startSession() },
        toggleSidebar: () => { ctx.layout.toggleSidebar() },
      }),
    }, KbSidebar),
    'ui-yantao-kb: sidebar',
  )

  ctx.effect(
    () => ctx.slots.register({
      name: 'details',
      // Shadow ui-chat's DetailsPanel: on the workbench the details column IS
      // the KB editor. Distinct priorities coexist; the lowest renders.
      priority: -10,
      locale: NS,
      inject: () => ({
        hooks: { workbench: workbench.source },
        loadFile: (path: string) => workbench.readFile(path),
        saveFile: (path: string, content: string) => workbench.writeFile(path, content),
      }),
    }, KbEditor),
    'ui-yantao-kb: details editor',
  )
}
