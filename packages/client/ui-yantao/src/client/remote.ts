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

// Type-only: pulls the `ctx.remote.session` merge the session controller owns
// (ADR-0019's mail analysis drives a real dsh session from the browser).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SessionCreateRequest, SessionCreateValue, SessionFollowFrame, SessionFollowRequest, SessionPromptRequest,
  SessionPromptValue, SessionRenameRequest, SessionRenameValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  KbCreatableEntityType, KbCreateEntityArgs, KbCreateEntityResult, KbDeleteFileResult, KbFileContent, KbLinksResult,
  KbMailFetchArgs, KbMailFetchResult, KbMailMarkReadArgs, KbMailMarkReadResult, KbMailMessage,
  KbOpenExternalResult, KbRevisionResult, KbRootResult, KbSetRootResult, KbTodosResult, KbTree,
  KbTreeSection, KbWriteResult, KbWriteTodosArgs, KbWriteTodosResult,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'

/** The yantaoKb namespace's callable surface, structurally satisfied by the mounted contribution. */
export interface KbRemote {
  intakeTree(): Promise<RemoteResult<KbTree>>
  workspaceTree(): Promise<RemoteResult<KbTree>>
  read(path: string): Promise<RemoteResult<KbFileContent>>
  links(path: string): Promise<RemoteResult<KbLinksResult>>
  write(path: string, content: string): Promise<RemoteResult<KbWriteResult>>
  deleteFile(path: string): Promise<RemoteResult<KbDeleteFileResult>>
  root(): Promise<RemoteResult<KbRootResult>>
  setRoot(path: string): Promise<RemoteResult<KbSetRootResult>>
  createEntity(args: KbCreateEntityArgs): Promise<RemoteResult<KbCreateEntityResult>>
  revision(): Promise<RemoteResult<KbRevisionResult>>
  openExternal(target: string): Promise<RemoteResult<KbOpenExternalResult>>
  todos(): Promise<RemoteResult<KbTodosResult>>
  writeTodos(args: KbWriteTodosArgs): Promise<RemoteResult<KbWriteTodosResult>>
  mailFetch(args: KbMailFetchArgs): Promise<RemoteResult<KbMailFetchResult>>
  mailMarkRead(args: KbMailMarkReadArgs): Promise<RemoteResult<KbMailMarkReadResult>>
}

/**
 * The session namespace's callable surface (ADR-0019): the mail analysis runs
 * as a real dsh session, so the judgement can be re-read later.
 */
export interface SessionRemote {
  create(args: SessionCreateRequest): Promise<RemoteResult<SessionCreateValue>>
  rename(args: SessionRenameRequest): Promise<RemoteResult<SessionRenameValue>>
  prompt(args: SessionPromptRequest, signal?: AbortSignal): Promise<RemoteResult<SessionPromptValue>>
  follow(args: SessionFollowRequest, signal?: AbortSignal): AsyncIterable<SessionFollowFrame>
}

/** Read one KB file's content; rejects with the Remote's own message. */
export type FileReader = (path: string) => Promise<string>

/** Write one KB file's full content; rejects with the Remote's own message. */
export type FileWriter = (path: string, content: string) => Promise<void>

/** Delete one KB file; rejects with the Remote's own message. */
export type FileDeleter = (path: string) => Promise<void>

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

/** Read the todo singleton as structured items (ADR-0018). */
export type TodoLoader = () => Promise<KbTodosResult>

/** Write the todo singleton's whole item list, optimistic-concurrency and all (ADR-0018). */
export type TodoWriter = (args: KbWriteTodosArgs) => Promise<KbWriteTodosResult>

/** Read the newest mails after the connector's cursor (ADR-0019). */
export type MailFetcher = (args: KbMailFetchArgs) => Promise<KbMailFetchResult>

/** Move the mail connector's cursor forward (ADR-0019). */
export type MailMarker = (args: KbMailMarkReadArgs) => Promise<KbMailMarkReadResult>

/** One mail as the connector reports it (ADR-0019). */
export type MailMessage = KbMailMessage

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
 * Delete one KB file — the rails' right-click 「删除」 on an entity row. The
 * host refuses an absent file, so a row already gone elsewhere is reported
 * rather than silently accepted.
 * @param ctx - client root context.
 * @param path - KB-relative path.
 * @returns a rejected promise carrying the reason on failure.
 */
export async function deleteFile(ctx: Context, path: string): Promise<void> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  unwrapRemote(await kb.deleteFile(path))
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

/**
 * Read the todo singleton as structured items (ADR-0018).
 *
 * The parsing lives on the host: the client cannot import `dsh-yantao-kb`
 * (bundle purity), so the board never sees the `[due::…]` syntax — only the
 * items, plus the exact `text` it must hand back as `expectedText`.
 * @param ctx - client root context.
 * @returns the singleton's path, text, and items, or a rejected promise
 *   carrying the reason.
 */
export async function loadTodos(ctx: Context): Promise<KbTodosResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.todos())
}

/**
 * Write the todo singleton's whole item list (ADR-0018).
 *
 * The host compares `expectedText` with what is on disk and refuses when
 * they differ — the same pre-save comparison the editor's autosave uses
 * (ADR-0012) — so a concurrent edit in Obsidian is reported, not clobbered.
 * @param ctx - client root context.
 * @param args - the new item list and the `text` the caller last read.
 * @returns the path and the file's new text, or a rejected promise carrying
 *   the host's reason.
 */
export async function writeTodos(ctx: Context, args: KbWriteTodosArgs): Promise<KbWriteTodosResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.writeTodos(args))
}

/**
 * Read the newest mails after the connector's cursor (ADR-0019).
 * @param ctx - client root context.
 * @param args - an explicit `since` and cap; both are optional.
 * @returns the bound used, the mails, and the two flags the panel reports.
 */
export async function fetchMail(ctx: Context, args: KbMailFetchArgs): Promise<KbMailFetchResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.mailFetch(args))
}

/**
 * Move the mail connector's cursor (ADR-0019).
 * @param ctx - client root context.
 * @param args - the stamp to store; defaults to now on the host.
 * @returns the cursor as it now stands.
 */
export async function markMailRead(ctx: Context, args: KbMailMarkReadArgs): Promise<KbMailMarkReadResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.mailMarkRead(args))
}

/**
 * Reach the session namespace without assuming it is mounted — the same
 * defensive access `kbRemoteOf` uses.
 * @param ctx - client root context.
 * @returns the namespace, or undefined when it is not there.
 */
export function sessionRemoteOf(ctx: Context): SessionRemote | undefined {
  return (ctx as unknown as { remote?: { session?: SessionRemote } }).remote?.session
}

/**
 * The `details` one Remote failure carries, when it has any. ADR-0019's mail
 * failures put their remedy there, and the panel shows it next to the message.
 * @param error - a caught value.
 * @returns the details, or undefined when there are none.
 */
export function remoteDetails(error: unknown): { readonly hint?: string } | undefined {
  if (typeof error !== 'object' || error === null || !('details' in error)) return undefined
  return (error as { details?: { readonly hint?: string } }).details
}
