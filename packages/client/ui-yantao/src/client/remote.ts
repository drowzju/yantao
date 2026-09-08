/**
 * The yantaoKb Remote surface the workbench panes read through. The
 * namespace is reached defensively: it is contributed by the host bundle, so
 * a missing one is a state to report, not a type error to fight.
 *
 * The three first-run methods (`root` / `setRoot` / `createEntity`) are typed
 * here rather than imported: they mirror the controller's `KbRootResult`,
 * `KbSetRootResult`, `KbCreatableEntityType` and `KbCreateEntityArgs` one for
 * one, but keeping this plugin's payloads local means the client face does not
 * depend on which side of the seam lands first.
 * @module @deepseek-ai/dsh-client-ui-yantao/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  KbFileContent, KbTree, KbTreeSection, KbWriteResult,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'

/** The KB root's configuration state — the first-run directory question. */
export interface KbRootInfo {
  /** Absolute KB root path (empty until one is configured). */
  readonly root: string
  /** False when no KB root is configured yet: the workbench asks for one. */
  readonly configured: boolean
}

/** Result of `yantaoKb.setRoot`: the directory was adopted and seeded. */
export interface KbSetRootResult {
  /** The absolute KB root now in force. */
  readonly root: string
  /** Always true once a root is set. */
  readonly configured: boolean
  /** KB-relative paths the seeding created. */
  readonly created: readonly string[]
  /** KB-relative paths that already existed. */
  readonly existing: readonly string[]
}

/** The entity kinds the workbench may create. `todo` is a singleton the server refuses. */
export type KbEntityKind = 'project' | 'area' | 'person' | 'meeting'

/** Arguments of `yantaoKb.createEntity`. */
export interface KbCreateEntityArgs {
  /** The entity kind. */
  readonly type: KbEntityKind
  /** Display name; the server turns it into a file name. */
  readonly name: string
  /** ISO date (YYYY-MM-DD) for a meeting; the server defaults it to today. */
  readonly date?: string
}

/** The yantaoKb namespace's callable surface, structurally satisfied by the mounted contribution. */
export interface KbRemote {
  intakeTree(): Promise<RemoteResult<KbTree>>
  workspaceTree(): Promise<RemoteResult<KbTree>>
  read(path: string): Promise<RemoteResult<KbFileContent>>
  write(path: string, content: string): Promise<RemoteResult<KbWriteResult>>
  root(): Promise<RemoteResult<KbRootInfo>>
  setRoot(path: string): Promise<RemoteResult<KbSetRootResult>>
  createEntity(args: KbCreateEntityArgs): Promise<RemoteResult<KbWriteResult>>
}

/** Read one KB file's content; rejects with the Remote's own message. */
export type FileReader = (path: string) => Promise<string>

/** Write one KB file's full content; rejects with the Remote's own message. */
export type FileWriter = (path: string, content: string) => Promise<void>

/** Create one entity and resolve its KB-relative path. */
export type EntityCreator = (type: KbEntityKind, name: string) => Promise<string>

/** Read the KB root's configuration state. */
export type RootLoader = () => Promise<KbRootInfo>

/** Adopt a directory as the KB root. */
export type RootSetter = (path: string) => Promise<KbSetRootResult>

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
export async function loadRoot(ctx: Context): Promise<KbRootInfo> {
  const kb = kbRemoteOf(ctx)
  if (kb === undefined) throw missing()
  return unwrapRemote(await kb.root())
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
