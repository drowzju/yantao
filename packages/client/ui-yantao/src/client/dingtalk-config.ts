/**
 * The dingtalk-config seam behind the workbench's 钉钉 dialog (ADR-0060
 * 决定 2): reading and writing the connector plugin's settings namespace
 * `dingtalk-channel` (启用 / Client ID / 机器人名称 / 代理 / 调试日志) and the
 * AppSecret credential. The dialog receives these as plain callbacks — the
 * Remote namespaces and their failure codes stay in the apply world, exactly
 * like every other workbench seam.
 *
 * The secret never enters the settings document (hard rule 5): it is stored
 * under the connector's default credential reference `DINGTALK_CLIENT_SECRET`
 * (the connector's accountCredentialRefs('default') resolves exactly that
 * name), so the config document keeps no reference and no secret.
 *
 * 凭据下发（ADR-0060 决定 4）：扫码授权经核实不可行（钉钉开放平台的 qrConnect
 * 只能为既有应用授权用户，没有「扫码铸出 AppKey/AppSecret」的接口），故面板
 * 即引导式手填：两个字段的占位文案就是引导。
 * @module @deepseek-ai/dsh-client-ui-yantao/dingtalk-config
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

/** The connector plugin's settings namespace (= its cordis plugin name). */
export const DINGTALK_NAMESPACE = 'dingtalk-channel'

/** The credential reference the connector resolves the AppSecret from. */
export const SECRET_REF = 'DINGTALK_CLIENT_SECRET'

/** What the dialog opens on: the connector's current config, joined with the secret's state. */
export interface DingTalkConfigView {
  /** Master switch (ADR-0060 决定 3): flipping it hot-starts/stops the stream. */
  readonly enabled: boolean
  readonly clientId: string
  readonly robotName: string
  readonly proxy: string
  readonly debug: boolean
  /** Whether the referenced credential holds a value (never the value itself). */
  readonly secretConfigured: boolean
  readonly secretWritable: boolean
  /** Revision of the namespace, echoed back on write. */
  readonly revision: number
}

/** What the dialog submits. An empty `secret` means keep the stored one. */
export interface DingTalkConfigDraft {
  readonly enabled: boolean
  readonly clientId: string
  readonly robotName: string
  readonly proxy: string
  readonly debug: boolean
  readonly secret: string
}

/** What one save answered. */
export type DingTalkSaveResult =
  /** Committed; every write hot-applies, no restart needed. */
  | { readonly kind: 'saved' }
  /** The stored revision moved under us; the dialog reloads and asks for a retry. */
  | { readonly kind: 'conflict' }
  /** Any other refusal, with the host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** A JSON object guard — the namespace value may carry fields this dialog ignores. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringAt(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

function boolAt(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key]
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Read the connector's config view: one settings describe plus one credential
 * state lookup, joined.
 * @param ctx - the client root context (declares `remote.settings` / `remote.credentials`).
 * @returns the view the dialog opens on.
 */
export async function loadDingTalkConfig(ctx: Context): Promise<DingTalkConfigView> {
  const [described, credentials] = await Promise.all([
    ctx.remote.settings.describe(),
    ctx.remote.credentials.describe([SECRET_REF]),
  ])
  if (!described.ok) throw described.error
  const ns = described.value.namespaces.find(candidate => candidate.ns === DINGTALK_NAMESPACE)
  if (ns === undefined) throw new Error(`设置命名空间 ${DINGTALK_NAMESPACE} 未挂载`)
  const value = isJsonObject(ns.value) ? ns.value : {}
  return {
    enabled: boolAt(value, 'enabled', true),
    clientId: stringAt(value, 'clientId'),
    robotName: stringAt(value, 'robotName'),
    proxy: stringAt(value, 'proxy'),
    debug: boolAt(value, 'debug', false),
    secretConfigured: credentials.ok && credentials.value[SECRET_REF]?.configured === true,
    secretWritable: !(credentials.ok && credentials.value[SECRET_REF]?.writable === false),
    revision: ns.revision,
  }
}

/**
 * Commit a draft: settings ops for the config fields, the credentials store
 * for the secret. The write is revision-fenced; a moved revision answers
 * `conflict` and the dialog reloads. Every committed field hot-applies:
 * 启用走插件内的生命周期调和器，其余字段经插件重挂生效（ADR-0060 决定 2/3）。
 * @param ctx - the client root context.
 * @param draft - what the dialog holds.
 * @returns the outcome the dialog renders from.
 */
export async function saveDingTalkConfig(ctx: Context, draft: DingTalkConfigDraft): Promise<DingTalkSaveResult> {
  const view = await loadDingTalkConfig(ctx)
  // Path-scoped on purpose: fields the dialog does not own (accounts,
  // digitalEmployees, replyMode, …) are never in an op, so a save cannot
  // clobber them.
  const ops: SettingsPathOpView[] = []
  if (draft.enabled !== view.enabled) ops.push({ op: 'set', path: ['enabled'], value: draft.enabled })
  const clientId = draft.clientId.trim()
  if (clientId !== view.clientId) ops.push({ op: 'set', path: ['clientId'], value: clientId })
  const robotName = draft.robotName.trim()
  if (robotName !== view.robotName) ops.push({ op: 'set', path: ['robotName'], value: robotName })
  const proxy = draft.proxy.trim()
  if (proxy !== view.proxy) ops.push({ op: 'set', path: ['proxy'], value: proxy })
  if (draft.debug !== view.debug) ops.push({ op: 'set', path: ['debug'], value: draft.debug })
  if (ops.length > 0) {
    const written = await ctx.remote.settings.mutate(DINGTALK_NAMESPACE, ops, view.revision)
    if (!written.ok) {
      return written.error.code === 'settings/conflict'
        ? { kind: 'conflict' }
        : { kind: 'refused', message: written.error.message }
    }
  }
  // A typed secret goes to the credentials store only (hard rule 5). A
  // settings write that succeeded but a secret store that refused leaves the
  // dialog open with the draft intact — the retry redoes just the secret,
  // since the settings ops are now no-ops.
  const secret = draft.secret.trim()
  if (secret !== '') {
    const stored = await ctx.remote.credentials.set(SECRET_REF, secret)
    if (!stored.ok) return { kind: 'refused', message: stored.error.message }
  }
  return { kind: 'saved' }
}
