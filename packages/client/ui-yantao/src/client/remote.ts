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
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SessionCancelRequest, SessionCancelValue, SessionCreateRequest, SessionCreateValue, SessionFollowFrame,
  SessionFollowRequest, SessionPage, SessionPageRequest, SessionPromptRequest, SessionPromptValue,
  SessionRenameRequest, SessionRenameValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  KbCapabilityAdoptArgs, KbCapabilityAdoptResult, KbCapabilityCreateArgs, KbCapabilityCreateResult,
  KbCapabilityListResult,
  KbCapabilityRegisterArgs, KbCapabilityRegisterResult,
  KbCapabilityRunArgs, KbCapabilityRunResult, KbCreatableEntityType, KbCreateEntityArgs, KbCreateEntityResult,
  KbDeleteFileResult, KbFileContent, KbLinksResult,
  KbMailDeleteArgs, KbMailDeleteResult, KbMailFetchArgs, KbMailFetchResult, KbMailMarkReadArgs, KbMailMarkReadResult, KbMailMessage,
  KbMemoryAddArgs, KbMemoryAddResult, KbMemoryDeleteArgs, KbMemoryDeleteResult, KbMemoryListResult,
  KbOpenExternalResult, KbPersonRelation, KbRegisterResourceArgs, KbRegisterResourceResult, KbRevisionResult,
  KbRootResult, KbSetRelationArgs, KbSetRelationResult,
  KbSetRootResult, KbTodosResult, KbTree,
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
  setRelation(args: KbSetRelationArgs): Promise<RemoteResult<KbSetRelationResult>>
  root(): Promise<RemoteResult<KbRootResult>>
  setRoot(path: string): Promise<RemoteResult<KbSetRootResult>>
  createEntity(args: KbCreateEntityArgs): Promise<RemoteResult<KbCreateEntityResult>>
  revision(): Promise<RemoteResult<KbRevisionResult>>
  openExternal(target: string): Promise<RemoteResult<KbOpenExternalResult>>
  todos(): Promise<RemoteResult<KbTodosResult>>
  writeTodos(args: KbWriteTodosArgs): Promise<RemoteResult<KbWriteTodosResult>>
  mailFetch(args: KbMailFetchArgs): Promise<RemoteResult<KbMailFetchResult>>
  mailMarkRead(args: KbMailMarkReadArgs): Promise<RemoteResult<KbMailMarkReadResult>>
  /** List the registered capabilities (ADR-0021). */
  capabilityList(): Promise<RemoteResult<KbCapabilityListResult>>
  /** Run one capability's entry script (ADR-0021); the signal is the human channel's cancel line (ADR-0031). */
  capabilityRun(args: KbCapabilityRunArgs, signal?: AbortSignal): Promise<RemoteResult<KbCapabilityRunResult>>
  /** Scaffold one new capability under `.dsh/skills/` (ADR-0021 决定 8's 「新建能力」). */
  capabilityCreate(args: KbCapabilityCreateArgs): Promise<RemoteResult<KbCapabilityCreateResult>>
  /** Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1). */
  capabilityAdopt(args: KbCapabilityAdoptArgs): Promise<RemoteResult<KbCapabilityAdoptResult>>
  /** Register one in-KB skill by writing its sidecar in place (ADR-0025 决定 1). */
  capabilityRegister(args: KbCapabilityRegisterArgs): Promise<RemoteResult<KbCapabilityRegisterResult>>
  /** Copy one dropped file into `resources/` (ADR-0020). */
  registerResource(args: KbRegisterResourceArgs): Promise<RemoteResult<KbRegisterResourceResult>>
  /** The behavior-memory store's listing (ADR-0032): every scope that has a file. */
  memoryList(): Promise<RemoteResult<KbMemoryListResult>>
  /** Remember one behavior rule (ADR-0032); an exact duplicate is refused. */
  memoryAdd(args: KbMemoryAddArgs): Promise<RemoteResult<KbMemoryAddResult>>
  /** Forget one behavior rule by id (ADR-0032); a stale id is a not-found. */
  memoryDelete(args: KbMemoryDeleteArgs): Promise<RemoteResult<KbMemoryDeleteResult>>
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
  /**
   * Page backwards through one session's durable history (the controller's
   * cold-read `session/page`, already in the generated client face) — the
   * 任务 tab's 「详情」 drawer walks older history with it (ADR-0033).
   */
  page(args: SessionPageRequest, signal?: AbortSignal): Promise<RemoteResult<SessionPage>>
  /**
   * Cancel the session's in-flight turn (the controller's `session/cancel`,
   * already in the generated client face): the turn ends `aborted` instead of
   * running to completion nobody consumes. A refinement run aborts its signal
   * and calls this together.
   */
  cancel(args: SessionCancelRequest): Promise<RemoteResult<SessionCancelValue>>
}

/** Read one KB file's content; rejects with the Remote's own message. */
export type FileReader = (path: string) => Promise<string>

/** Write one KB file's full content; rejects with the Remote's own message. */
export type FileWriter = (path: string, content: string) => Promise<void>

/** Delete one KB file; rejects with the Remote's own message. */
export type FileDeleter = (path: string) => Promise<void>

/** Rewrite one person entity's relation; rejects with the Remote's own message. */
export type RelationSetter = (path: string, relation: KbPersonRelation) => Promise<void>

/**
 * Create one entity and resolve its KB-relative path. `relation` and `email`
 * only mean anything for a `person`; the workbench always sends a relation for
 * that kind, and the mail path adds the sender's address.
 */
export type EntityCreator = (
  type: KbCreatableEntityType,
  name: string,
  relation?: KbPersonRelation,
  email?: string,
) => Promise<string>

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

/**
 * Read the newest mails through the `mail` capability (ADR-0019, ADR-0021).
 * The signal is the run's cancel line (ADR-0031 落地注记二): an abort kills
 * the reader subprocess server-side, same as any capability run.
 */
export type MailFetcher = (args: KbMailFetchArgs, signal?: AbortSignal) => Promise<MailFetchResult>

/**
 * The mail read's answer, plus the capability scope's behavior memory
 * (ADR-0032 批次④): the run result already carries the rendered block (批次②),
 * and the client-driven analysis is the consumer 落地注记三 pointed at — the
 * panel stashes it and feeds the next analysis prompt.
 */
export type MailFetchResult = KbMailFetchResult & { readonly memory?: string }

/** Move the mail connector's cursor forward (ADR-0019). */
export type MailMarker = (args: KbMailMarkReadArgs) => Promise<KbMailMarkReadResult>

/**
 * Swing the deletion knife (ADR-0034 决定 5): move nominated mails to
 * Outlook's 已删除 folder through the `mail` capability's human-channel-only
 * `verb: 'delete'`. Human channel only — the agent's `kb_*` toolset never
 * grows a delete.
 */
export type MailDeleter = (ids: readonly string[]) => Promise<KbMailDeleteResult>

/** Copy one dropped file into `resources/` and resolve its path (ADR-0020). */
export type ResourceRegistrar = (name: string, contentBase64: string) => Promise<string>

/** List the registered capabilities (ADR-0021). */
export type CapabilityLoader = () => Promise<KbCapabilityListResult>

/** Run one capability with the caller's input (ADR-0021; agent channel ADR-0023); the signal cancels the subprocess (ADR-0031). */
export type CapabilityRunner = (args: KbCapabilityRunArgs, signal?: AbortSignal) => Promise<KbCapabilityRunResult>

/** Scaffold one new capability under `.dsh/skills/` (ADR-0021 决定 8's 「新建能力」). */
export type CapabilityCreator = (name: string) => Promise<KbCapabilityCreateResult>

/** Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1). */
export type CapabilityAdopter = (name: string) => Promise<KbCapabilityAdoptResult>

/**
 * Register one in-KB skill by writing its `yantao.json` sidecar in place
 * (ADR-0025 决定 1) — always an instruction capability; the three booleans
 * are the capability's reach (agent invocation, resource menu, selection
 * menu). A plugin repository registers by extraction.
 */
export type CapabilityRegisterReach = {
  readonly agentInvoke?: boolean
  readonly resourceMenu?: boolean
  readonly selectionMenu?: boolean
}
export type CapabilityRegistrar = (name: string, reach?: CapabilityRegisterReach) => Promise<KbCapabilityRegisterResult>

/** One mail as the connector reports it (ADR-0019). */
export type MailMessage = KbMailMessage

/** List the behavior-memory scopes (ADR-0032): global first, then name-sorted. */
export type MemoryLister = () => Promise<KbMemoryListResult>

/**
 * Remember one behavior rule in a scope (ADR-0032). An exact duplicate is
 * refused by the host — the caller renders that as 「已记得」, not an error.
 */
export type MemoryAdder = (scope: string, text: string) => Promise<KbMemoryAddResult>

/** Forget one behavior rule by id (ADR-0032); a stale id rejects, and the caller refreshes. */
export type MemoryDeleter = (scope: string, id: string) => Promise<void>

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
 * Load the intake sections (resources / todos).
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
 * Rewrite one person entity's relation — the 人物 row's right-click 「关系」.
 * The host owns the file's shape: it refuses a file that is not a person and a
 * relation the domain does not know.
 * @param ctx - client root context.
 * @param path - KB-relative path of the person entity.
 * @param relation - the relation to write.
 * @returns a rejected promise carrying the reason on failure.
 */
export async function setRelation(ctx: Context, path: string, relation: KbPersonRelation): Promise<void> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  unwrapRemote(await kb.setRelation({ path, relation }))
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
 * @param args - the entity kind and name, a meeting's date, and a person's relation.
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
 * Read the newest mails through the `mail` capability (ADR-0019, ADR-0021).
 * The capability's answer *is* the old connector's payload, so the panel
 * keeps its shape; only the transport changed.
 * @param ctx - client root context.
 * @param args - an explicit `since` and cap; both are optional.
 * @param signal - the human channel's cancel line (ADR-0031 落地注记二).
 * @returns the bound used, the mails, and the two flags the panel reports.
 */
export async function fetchMail(ctx: Context, args: KbMailFetchArgs, signal?: AbortSignal): Promise<MailFetchResult> {
  const run = await runCapability(ctx, { name: 'mail', input: args } as unknown as KbCapabilityRunArgs, signal)
  const result = run.result as unknown as KbMailFetchResult
  return {
    ...result,
    // exactOptionalPropertyTypes: an absent memory must stay absent, not undefined-valued.
    ...(run.memory !== undefined ? { memory: run.memory } : {}),
  }
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
 * Move nominated mails to Outlook's 已删除 folder (ADR-0034 决定 5), through
 * the `mail` capability's delete verb. The generic `capabilityRun` RPC
 * hardcodes the human invoker, and the controller testifies that channel in
 * the request envelope — the entry script refuses the verb to anyone else.
 * @param ctx - client root context.
 * @param ids - the nominated mails' Outlook EntryIDs (from the analysed batch).
 * @param signal - the human channel's cancel line (ADR-0031).
 * @returns the per-mail outcome split, or a rejected promise carrying the reason.
 */
export async function deleteMails(ctx: Context, ids: readonly string[], signal?: AbortSignal): Promise<KbMailDeleteResult> {
  const args: KbMailDeleteArgs = { verb: 'delete', ids }
  const run = await runCapability(ctx, { name: 'mail', input: args } as unknown as KbCapabilityRunArgs, signal)
  return run.result as unknown as KbMailDeleteResult
}

/**
 * Copy one dropped file into `resources/` (ADR-0020): the drag-and-drop
 * intake. The host sanitizes the name and refuses a duplicate — an original
 * already registered is never overwritten.
 * @param ctx - client root context.
 * @param name - the dropped file's basename.
 * @param contentBase64 - the file's complete content, base64-encoded.
 * @returns the resource's KB-relative path, or a rejected promise carrying the reason.
 */
export async function registerResource(ctx: Context, name: string, contentBase64: string): Promise<string> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.registerResource({ name, contentBase64 })).resource
}

/**
 * List the registered capabilities (ADR-0021).
 * @param ctx - client root context.
 * @returns the capability rows, or a rejected promise carrying the reason.
 */
export async function loadCapabilities(ctx: Context): Promise<KbCapabilityListResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.capabilityList())
}

/**
 * Run one capability's entry script (ADR-0021).
 * @param ctx - client root context.
 * @param args - the capability's name and its input.
 * @param signal - the human channel's cancel line (ADR-0031); an abort kills
 *   the entry script's subprocess server-side.
 * @returns the run record, or a rejected promise carrying the reason.
 */
export async function runCapability(ctx: Context, args: KbCapabilityRunArgs, signal?: AbortSignal): Promise<KbCapabilityRunResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.capabilityRun(args, signal))
}

/**
 * Scaffold one new capability under `.dsh/skills/` (ADR-0021 决定 8's
 * 「新建能力」).
 * @param ctx - client root context.
 * @param name - the capability's kebab-case name.
 * @returns the scaffolded directory's KB-relative path.
 */
export async function createCapability(ctx: Context, name: string): Promise<KbCapabilityCreateResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.capabilityCreate({ name }))
}

/**
 * Adopt one out-of-KB skill into `.dsh/skills/` (ADR-0025 决定 1): the host
 * copies the bundle and writes the default human-only sidecar — any
 * declaration the source carried never takes effect silently.
 * @param ctx - client root context.
 * @param name - the unregistered skill's name, as the 未注册 group reported it.
 * @returns the adopted directory's KB-relative path.
 */
export async function adoptCapability(ctx: Context, name: string): Promise<KbCapabilityAdoptResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.capabilityAdopt({ name }))
}

/**
 * Register one in-KB skill as a capability (ADR-0025 决定 1): the host writes
 * the skill's `yantao.json` sidecar in place — no copy — always as an
 * instruction capability, with the reach the caller chose. A plugin
 * repository (no top-level SKILL.md, nested `skills/<name>/SKILL.md`)
 * registers by extracting its nested skills.
 * @param ctx - client root context.
 * @param name - the in-KB skill's name, as the 未注册 group reported it.
 * @param reach - the capability's reach: agent invocation, resource menu, selection menu.
 * @returns a sidecar's KB-relative path, or a rejected promise carrying the reason.
 */
export async function registerCapability(
  ctx: Context,
  name: string,
  reach: CapabilityRegisterReach = {},
): Promise<KbCapabilityRegisterResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.capabilityRegister({
    name,
    ...reach.agentInvoke === true ? { agentInvoke: true } : {},
    ...reach.resourceMenu === true ? { resourceMenu: true } : {},
    ...reach.selectionMenu === true ? { selectionMenu: true } : {},
  }))
}

/**
 * List the behavior-memory scopes (ADR-0032).
 * @param ctx - client root context.
 * @returns the scopes, global first, or a rejected promise carrying the reason.
 */
export async function listMemory(ctx: Context): Promise<KbMemoryListResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.memoryList())
}

/**
 * Remember one behavior rule in a scope (ADR-0032) — the human channel's
 * write, direct (no proposal card) when the human is the author.
 * @param ctx - client root context.
 * @param scope - `global`, `mail`, or a capability name.
 * @param text - the rule's text; empty and exact-duplicate texts are refused.
 * @returns the scope's path and the entry as written.
 */
export async function addMemory(ctx: Context, scope: string, text: string): Promise<KbMemoryAddResult> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.memoryAdd({ scope, text }))
}

/**
 * Forget one behavior rule by id (ADR-0032).
 * @param ctx - client root context.
 * @param scope - the scope the entry lives in.
 * @param id - the entry's id, as `memoryList` reported it.
 * @returns a rejected promise carrying the reason on failure (a stale id is
 *   a not-found: refresh, don't guess).
 */
export async function deleteMemory(ctx: Context, scope: string, id: string): Promise<void> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  unwrapRemote(await kb.memoryDelete({ scope, id }))
}

/**
 * Whether one memory failure is the host's exact-duplicate refusal (ADR-0032):
 * the wire carries only the message, and the store's wording — 「这条记忆已经
 * 存在…」 — is the stable witness. The caller renders it as 已记得, not an
 * error: the human asked to remember something that is already remembered.
 * @param error - a caught value.
 * @returns true when the failure is the duplicate refusal.
 */
export function isDuplicateMemory(error: unknown): boolean {
  return error instanceof Error && error.message.includes('已经存在')
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
 * End the session's in-flight turn server-side (ADR-0031): fire-and-forget,
 * because the caller is on the way out either way and a cancel refusal
 * changes nothing. The browser-driven runs (refine, mail analysis) wire this
 * to their abort signal, so an aborted run does not leave the model rounding
 * on to completion nobody consumes.
 * @param session - the session namespace.
 * @param sessionId - the session whose current turn should stop.
 */
export function cancelSessionTurn(session: SessionRemote, sessionId: string): void {
  // The generated face brands the id; the workbench carries it as a plain
  // string everywhere (same cast as turn-answer.ts).
  void session.cancel({ sessionId: sessionId as SessionId }).catch(() => {})
}

/**
 * Wire one run's abort signal to {@link cancelSessionTurn}: registering after
 * the session exists, firing immediately when the signal has already fired.
 * @param signal - the run's signal.
 * @param session - the session namespace.
 * @param sessionId - the run's session.
 */
export function cancelSessionTurnOnAbort(signal: AbortSignal, session: SessionRemote, sessionId: string): void {
  if (signal.aborted) cancelSessionTurn(session, sessionId)
  else signal.addEventListener('abort', () => { cancelSessionTurn(session, sessionId) }, { once: true })
}

/**
 * Send one prompt to the conversation the human is looking at (ADR-0025
 * 决定 4) — the frame's instruction-capability runs go through this.
 */
export type SessionPrompter = (text: string) => Promise<void>

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
