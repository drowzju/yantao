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
import { Frame } from './frame/Frame.tsx'
import { ThemePresenter } from './frame/theme-presenter.ts'
import { WorkbenchLayout, createPanelSeat } from './frame/layout.ts'
import type { KbEntityKind } from './remote.ts'
import {
  createEntity, loadIntake, loadRoot, loadWorkspace, readFile, setKbRoot, writeFile,
} from './remote.ts'

export const name = 'ui-yantao'
// Cordis forbids reading an undeclared service, and a Remote namespace counts
// as one of its own: both the `remote` face and this namespace must be listed
// or the accessor throws "cannot get property remote.yantaoKb without inject".
// `uiWorkspace` is the host's directory picker the first-run flow calls.
export const inject = ['slots', 'theme', 'remote', 'remote.yantaoKb', 'uiWorkspace']

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
      createEntity: (type: KbEntityKind, name: string) => createEntity(ctx, { type, name }),
      root: () => loadRoot(ctx),
      setRoot: (path: string) => setKbRoot(ctx, path),
      pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    }),
  }, Frame), 'ui-yantao: root frame')
}
