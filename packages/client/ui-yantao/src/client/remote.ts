/**
 * The yantaoKb Remote surface the workbench panes read through. The
 * namespace is reached defensively: it is contributed by the host bundle, so
 * a missing one is a state to report, not a type error to fight.
 * @module @deepseek-ai/dsh-client-ui-yantao/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  KbFileContent, KbTree, KbTreeSection, KbWriteResult,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'

/** The yantaoKb namespace's callable surface, structurally satisfied by the mounted contribution. */
export interface KbRemote {
  intakeTree(): Promise<RemoteResult<KbTree>>
  workspaceTree(): Promise<RemoteResult<KbTree>>
  read(path: string): Promise<RemoteResult<KbFileContent>>
  write(path: string, content: string): Promise<RemoteResult<KbWriteResult>>
}

/** Reach the remote surface without assuming the namespace is mounted. */
export function kbRemoteOf(ctx: Context): KbRemote | undefined {
  return (ctx as unknown as { remote?: { yantaoKb?: KbRemote } }).remote?.yantaoKb
}

/** Unwrap one Remote result, turning its failure into a thrown error with the same message. */
export function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}

/** One Remote failure rendered as prose for the panes. */
export function remoteMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Load the intake sections (resources / todos / meetings).
 * @param ctx - client root context.
 * @returns the sections, or a rejected promise carrying the reason.
 */
export async function loadIntake(ctx: Context): Promise<readonly KbTreeSection[]> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw new Error('没有挂载 yantaoKb Remote 命名空间')
  return unwrapRemote(await kb.intakeTree()).sections
}

/**
 * Load the workspace sections (areas / people / projects).
 * @param ctx - client root context.
 * @returns the sections, or a rejected promise carrying the reason.
 */
export async function loadWorkspace(ctx: Context): Promise<readonly KbTreeSection[]> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw new Error('没有挂载 yantaoKb Remote 命名空间')
  return unwrapRemote(await kb.workspaceTree()).sections
}
