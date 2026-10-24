/**
 * The workspace-cli-config seam behind the workbench's CLI dialog (2026-10-23):
 * reading and writing the workspace runtime's headless CLI configuration —
 * the controller entry's settings namespace 'yantao-kb-controller' (model /
 * network environment) and
 * the API key credential. The dialog receives these as plain callbacks — the
 * Remote namespaces and their failure codes stay in the apply world, exactly
 * like every other workbench seam.
 *
 * The raw API key never enters the settings document (hard rule 5): it is
 * stored under the WORKSPACE_CLI_API_KEY credential reference, and the
 * controller resolves it fresh at each workspace spawn. The model list comes
 * from the controller's workspaceCliModels remote (the renderer never spawns,
 * so parsing codebuddy --help is controller-side too).
 * @module @deepseek-ai/dsh-client-ui-yantao/workspace-cli-config
 */

import type { Context } from '@deepseek-ai/cordis'

/** The settings namespace carrying the non-secret CLI config. */
export const WORKSPACE_CLI_NAMESPACE = 'yantao-kb-controller'

/** The credential reference the CLI's API key stores under. */
export const WORKSPACE_CLI_KEY_REF = 'WORKSPACE_CLI_API_KEY'

/** What the dialog opens on: the CLI's current config, joined with the key's state. */
export interface WorkspaceCliConfigView {
  /** The global default model id, '' meaning the CLI decides. */
  readonly model: string
  /** The CodeBuddy edition endpoint family, '' meaning the ambient default. */
  readonly internetEnvironment: string
  /** Whether the referenced credential holds a value (never the value itself). */
  readonly keyConfigured: boolean
  readonly keyWritable: boolean
  /** The model ids the installed CLI reports (parsed from codebuddy --help). */
  readonly models: readonly string[]
  /** Revision of the namespace, echoed back on write. */
  readonly revision: number
}

/** What the dialog submits. An empty 'apiKey' means keep the stored one. */
export interface WorkspaceCliConfigDraft {
  readonly model: string
  readonly internetEnvironment: string
  readonly apiKey: string
}

/** What one save answered. */
export type WorkspaceCliSaveResult =
  /** Committed; the next workspace spawn picks it up, no restart needed. */
  | { readonly kind: 'saved' }
  /** The stored revision moved under us; the dialog reloads and asks for a retry. */
  | { readonly kind: 'conflict' }
  /** Any other refusal, with the host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** What one 测试连接 press answered. */
export type WorkspaceCliTestResult = {
  readonly ok: boolean
  readonly detail: string
  readonly durationMs: number
}

/** A JSON object guard — the namespace value may carry fields this dialog ignores. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringAt(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Read the CLI's config view: one settings describe plus one credential state
 * lookup plus the controller's model list, joined.
 * @param ctx - the client root context (declares remote.settings / remote.credentials / remote.yantaoKb).
 * @returns the view the dialog opens on.
 */
export async function loadWorkspaceCliConfig(ctx: Context): Promise<WorkspaceCliConfigView> {
  const [described, credentials, models] = await Promise.all([
    ctx.remote.settings.describe(),
    ctx.remote.credentials.describe([WORKSPACE_CLI_KEY_REF]),
    ctx.remote.yantaoKb.workspaceCliModels(),
  ])
  if (!described.ok) throw described.error
  const ns = described.value.namespaces.find(candidate => candidate.ns === WORKSPACE_CLI_NAMESPACE)
  const value = ns !== undefined && isJsonObject(ns.value) ? ns.value : {}
  return {
    model: stringAt(value, 'model'),
    internetEnvironment: stringAt(value, 'internetEnvironment'),
    keyConfigured: credentials.ok && credentials.value[WORKSPACE_CLI_KEY_REF]?.configured === true,
    keyWritable: !(credentials.ok && credentials.value[WORKSPACE_CLI_KEY_REF]?.writable === false),
    models: models.ok ? models.value.models : [],
    revision: ns?.revision ?? 0,
  }
}

/**
 * Commit a draft: a whole-section replace on the namespace (the dialog is its
 * only writer), the credentials store for the raw key.
 * @param ctx - the client root context.
 * @param draft - what the dialog holds.
 * @returns the outcome the dialog renders from.
 */
export async function saveWorkspaceCliConfig(ctx: Context, draft: WorkspaceCliConfigDraft): Promise<WorkspaceCliSaveResult> {
  const view = await loadWorkspaceCliConfig(ctx)
  const replaced = await ctx.remote.settings.replace(
    WORKSPACE_CLI_NAMESPACE,
    { model: draft.model, internetEnvironment: draft.internetEnvironment },
    view.revision,
  )
  if (!replaced.ok) {
    return replaced.error.code === 'settings/conflict'
      ? { kind: 'conflict' }
      : { kind: 'refused', message: replaced.error.message }
  }
  // A typed key goes to the credentials store only (hard rule 5). A settings
  // write that succeeded but a key store that refused leaves the dialog open
  // with the draft intact — the retry redoes just the key.
  const rawKey = draft.apiKey.trim()
  if (rawKey !== '') {
    const stored = await ctx.remote.credentials.set(WORKSPACE_CLI_KEY_REF, rawKey)
    if (!stored.ok) return { kind: 'refused', message: stored.error.message }
  }
  return { kind: 'saved' }
}

/**
 * Probe the CLI with the dialog's draft: one minimal headless call through the
 * controller (the renderer never spawns). The 测试连接 button's engine.
 *
 * 2026-10-23 评审 P0：此前探测只认已存配置——改了模型或网络环境还没保存就点
 * 测试，报的是另一套配置的结果，绿灯会替没生效的草稿背书。草稿随探测一起
 * 上送，空密钥仍表示「用已存凭据」。
 * @param ctx - the client root context.
 * @param draft - what the dialog currently holds.
 * @returns the probe outcome.
 */
export async function testWorkspaceCli(ctx: Context, draft: WorkspaceCliConfigDraft): Promise<WorkspaceCliTestResult> {
  const result = await ctx.remote.yantaoKb.workspaceCliTest({
    model: draft.model,
    internetEnvironment: draft.internetEnvironment,
    apiKey: draft.apiKey,
  })
  if (!result.ok) throw result.error
  return result.value
}
