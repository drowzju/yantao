/**
 * yantao workbench client plugin — the two workbench rails.
 *
 * dsh serves OUR dist and a plugin of ours reaches `ctx.remote.yantaoKb`
 * from React trees we register into the host's own slots: the intake rail
 * takes the layout's `sidebar` column, the workspace rail rides the
 * frame-wide `shell.overlay` layer. Both come from our own code — no
 * upstream file is touched to place them.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.slots` service merge (ui-renderer installs the registry)
// and ui-layout's SlotMap declarations ('sidebar', 'shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { IntakeRail, WorkspaceRail } from './Workbench.tsx'
import { loadIntake, loadWorkspace } from './remote.ts'

export const name = 'ui-yantao'
// Cordis forbids reading an undeclared service, and a Remote namespace counts
// as one of its own: both the `remote` face and this namespace must be listed
// or the accessor throws "cannot get property remote.yantaoKb without inject".
export const inject = ['slots', 'remote', 'remote.yantaoKb']

/** Overlay cell key of the workspace rail (the layer hosts unrelated entries too). */
const WORKSPACE_RAIL_ID = 'yantao-workspace-rail'

/**
 * Contribute both rails.
 *
 * `slots.inject` — not a bare `register` — because the two keys are declared
 * by ui-layout's root registration, which may not have run yet when this
 * plugin applies: inject waits for the declaration lifetime instead of
 * throwing.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    inject: () => ({ load: () => loadIntake(ctx) }),
  }, IntakeRail))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: WORKSPACE_RAIL_ID,
    order: 0,
    inject: () => ({ load: () => loadWorkspace(ctx) }),
  }, WorkspaceRail))
}
