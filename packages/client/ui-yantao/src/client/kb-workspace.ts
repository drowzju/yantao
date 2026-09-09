/**
 * Point dsh's own workspace at the KB root (ADR-0013).
 *
 * The middle column is still upstream's conversation, and dsh decides a
 * session's working directory host-side: `workspace?.path ?? cwd ??
 * process.cwd()` (`packages/api/session-controller/src/commands.ts`). Left
 * alone that is the server process' directory — the repo — while every `kb_*`
 * tool works against the KB root the human chose. One alignment pass makes
 * both the same directory: register the KB root as a workspace (idempotent)
 * and start its session, which is what the hero's chip and the session's cwd
 * then read.
 *
 * The three faces are injected, not reached for, so the pass is a plain
 * async function a unit test can drive.
 * @module @deepseek-ai/dsh-client-ui-yantao/kb-workspace
 */
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RootLoader } from './remote.ts'

/** The three faces the alignment pass needs. */
export interface KbWorkspaceFaces {
  /** Read the KB root's configuration state. */
  readonly root: RootLoader
  /** The Workspace Controller's client service. */
  readonly workspaces: IWorkspaces
  /** Open (or create) one workspace's session — `uiWorkspace.startSession`. */
  readonly startSession: (workspaceId: WorkspaceId) => void
}

/**
 * Wait for the workspace list to finish its first load. The pass can run
 * before the controller has decoded anything, and creating against an
 * unloaded snapshot would race the baseline.
 * @param workspaces - the workspace service.
 * @returns the first ready snapshot.
 */
function readyWorkspaces(workspaces: IWorkspaces): Promise<void> {
  if (workspaces.list.getSnapshot().phase === 'ready') return Promise.resolve()
  return new Promise((resolve) => {
    const off = workspaces.list.subscribe(() => {
      if (workspaces.list.getSnapshot().phase !== 'ready') return
      off()
      resolve()
    })
  })
}

/**
 * Register the KB root as a workspace and start its session.
 *
 * No-op while the KB root is unset: the first-run overlay owns that case and
 * calls again once a directory is chosen. A root whose directory has gone
 * away is reported, not fatal — the rails still show their own error.
 * @param faces - see {@link KbWorkspaceFaces}.
 * @returns the workspace path now in force, or null when there is none.
 */
export async function alignWorkspace(faces: KbWorkspaceFaces): Promise<string | null> {
  const info = await faces.root()
  if (!info.configured || info.root === '') return null
  await readyWorkspaces(faces.workspaces)
  const existing = faces.workspaces.list.getSnapshot().items
    .find(item => item.path === info.root)
  // create() resolves an already-registered path instead of duplicating it,
  // so this is the whole "ensure" step.
  const workspace = existing ?? await faces.workspaces.create({ path: info.root })
  faces.startSession(workspace.workspaceId)
  return workspace.path
}
