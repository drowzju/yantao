/**
 * The yantaoKb Remote surface the workbench panes read through. The
 * namespace is reached defensively: it is contributed by the host bundle, so
 * a missing one is a state to report, not a type error to fight.
 *
 * `root` / `setRoot` / `createEntity` are typed by the controller's own wire
 * types (`KbRootResult`, `KbSetRootResult`, `KbCreateEntityArgs`): the seam is
 * one package wide, so the client face shares the host's payloads instead of
 * mirroring them.
 * @module @deepseek-ai/dsh-client-ui-yantao/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  KbCreatableEntityType, KbCreateEntityArgs, KbCreateEntityResult, KbFileContent, KbLinksResult,
  KbOpenExternalResult, KbRevisionResult, KbRootResult, KbSetRootResult, KbTree, KbTreeSection, KbWriteResult,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'

/** The yantaoKb namespace's callable surface, structurally satisfied by the mounted contribution. */
export interface KbRemote {
  intakeTree(): Promise<RemoteResult<KbTree>>
  workspaceTree(): Promise<RemoteResult<KbTree>>
  read(path: string): Promise<RemoteResult<KbFileContent>>
  links(path: string): Promise<RemoteResult<KbLinksResult>>
  write(path: string, content: string): Promise<RemoteResult<KbWriteResult>>
  root(): Promise<RemoteResult<KbRootResult>>
  setRoot(path: string): Promise<RemoteResult<KbSetRootResult>>
  createEntity(args: KbCreateEntityArgs): Promise<RemoteResult<KbCreateEntityResult>>
  revision(): Promise<RemoteResult<KbRevisionResult>>
  openExternal(target: string): Promise<RemoteResult<KbOpenExternalResult>>
}

/** Read one KB file's content; rejects with the Remote's own message. */
export type FileReader = (path: string) => Promise<string>

/** Write one KB file's full content; rejects with the Remote's own message. */
export type FileWriter = (path: string, content: string) => Promise<void>

/** Create one entity and resolve its KB-relative path. */
export type EntityCreator = (type: KbCreatableEntityType, name: string) => Promise<string>

/** Read the KB root's configuration state. */
export type RootLoader = () => Promise<KbRootResult>

/** Load one file's `[[…]]` link graph. */
export type LinksLoader = (path: string) => Promise<KbLinksResult>

/** Adopt a directory as the KB root. */
export type RootSetter = (path: string) => Promise<KbSetRootResult>

/** Read the KB's change counter (ADR-0017). */
export type RevisionLoader = () => Promise<KbRevisionResult>

/** Hand one KB path or allowlisted URI to the desktop's own handler (ADR-0017). */
export type ExternalOpener = (target: string) => Promise<KbOpenExternalResult>

/** Open the host's native directory picker; resolves null when cancelled. */
export type DirectoryPicker = () => Promise<string | null>

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

/** The namespace-missing message every loader shares. */
function missing(): Error {
  return new Error('没有挂载 yantaoKb Remote 命名空间')
}

/**
 * Load the intake sections (resources / todos / meetings).
 * @param ctx - client root context.
 * @returns the sections, or a rejected promise carrying the reason.
 */
export async function loadIntake(ctx: Context): Promise<readonly KbTreeSection[]> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.intakeTree()).sections
}

/**
 * Load the workspace sections (areas / people / projects).
 * @param ctx - client root context.
 * @returns the sections, or a rejected promise carrying the reason.
 */
export async function loadWorkspace(ctx: Context): Promise<readonly KbTreeSection[]> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.workspaceTree()).sections
}

/**
 * Read one KB file's content.
 * @param ctx - client root context.
 * @param path - KB-relative path.
 * @returns the file's content, or a rejected promise carrying the reason.
 */
export async function readFile(ctx: Context, path: string): Promise<string> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.read(path)).content
}

/**
 * Write one KB file's full content (the human channel: full-file write).
 * @param ctx - client root context.
 * @param path - KB-relative path.
 * @param content - the complete new content.
 * @returns a rejected promise carrying the reason on failure.
 */
export async function writeFile(ctx: Context, path: string, content: string): Promise<void> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  unwrapRemote(await kb.write(path, content))
}

/**
 * Read the KB root's configuration state.
 * @param ctx - client root context.
 * @returns the root state, or a rejected promise carrying the reason.
 */
export async function loadRoot(ctx: Context): Promise<KbRootResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.root())
}

/**
 * Load one file's `[[…]]` link graph: what it links out to and what links
 * into it. A failure leaves the links unwritten rather than breaking the
 * reading view — a file with no link graph still reads fine.
 * @param ctx - client root context.
 * @param path - KB-relative path.
 * @returns the graph, or an empty one when the Remote cannot answer.
 */
export async function loadLinks(ctx: Context, path: string): Promise<KbLinksResult> {
  const empty: KbLinksResult = { path, outgoing: [], incoming: [] }
  try {
    const kb = kbRemoteOf(ctx)
    if (kb === undefined) return empty
    const result = await kb.links(path)
    return result.ok ? result.value : empty
  } catch {
    // No link graph is a degraded reading view, not a broken one: a server
    // without the method (or a file that vanished mid-flight) still reads.
    return empty
  }
}

/**
 * Adopt a directory as the KB root and seed it.
 * @param ctx - client root context.
 * @param path - absolute directory path chosen by the human.
 * @returns the seeding report, or a rejected promise carrying the reason.
 */
export async function setKbRoot(ctx: Context, path: string): Promise<KbSetRootResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.setRoot(path))
}

/**
 * Read the KB's change counter (ADR-0017).
 *
 * The workbench polls this instead of subscribing to pushed events: pushing
 * would need a line in the upstream forwarded-event allowlist, which sits
 * outside the merge surface. A counter the UI compares across polls answers
 * the only question it has — did anything change outside the workbench?
 * @param ctx - client root context.
 * @returns the root being watched and the counter, or a zero counter the UI
 *   can safely ignore when the Remote cannot answer.
 */
export async function loadRevision(ctx: Context): Promise<KbRevisionResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) return { root: '', revision: 0 }
  try {
    const result = await kb.revision()
    return result.ok ? result.value : { root: '', revision: 0 }
  } catch {
    return { root: '', revision: 0 }
  }
}

/**
 * Hand one target to the desktop's own handler (ADR-0017) — the "在 Obsidian
 * 中打开" bridge. The host refuses anything that is not a KB-internal path or
 * an allowlisted URI, so the UI may pass either without checking first.
 * @param ctx - client root context.
 * @param target - a KB-relative path, or a URI such as `obsidian://open?path=…`.
 * @returns the target the host accepted.
 */
export async function openExternal(ctx: Context, target: string): Promise<KbOpenExternalResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.openExternal(target))
}

/**
 * The `obsidian://open?path=…` URI for one KB file (ADR-0017).
 *
 * The KB root is meant to be registered as a vault by the human, once; yantao
 * never writes `.obsidian/` itself. When the root is unknown the URI is still
 * well-formed, and what Obsidian does with it is Obsidian's business.
 * @param root - the absolute KB root.
 * @param path - KB-relative path with forward slashes.
 * @returns the URI to hand to {@link openExternal}.
 */
export function obsidianUri(root: string, path: string): string {
  const absolute = `${root.replace(/[\\/]+$/, '')}\\${path.split('/').join('\\')}`
  return `obsidian://open?path=${encodeURIComponent(absolute)}`
}

/**
 * Create one entity file and resolve its KB-relative path.
 * @param ctx - client root context.
 * @param args - the entity kind and name (and a meeting's date).
 * @returns the new file's KB-relative path, or a rejected promise carrying the reason.
 */
export async function createEntity(ctx: Context, args: KbCreateEntityArgs): Promise<string> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.createEntity(args)).path
}
