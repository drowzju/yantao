/**
 * The model-config seam behind the workbench's 配置 dialog: reading and
 * writing the intranet model gateway (settings namespace `llm-pi-ai`, route
 * `model-gateway`) and the default model (namespace `agent-default-model`),
 * plus the credential the profile references. The dialog receives these as
 * plain callbacks — the Remote namespaces and their failure codes stay in the
 * apply world, exactly like every other workbench seam.
 *
 * The raw API key never enters the settings document (hard rule 5): it is
 * stored under the derived credential reference and the profile only records
 * the reference as `apiKeyEnv` — the same recipe the stock models editor
 * follows.
 * @module @deepseek-ai/dsh-client-ui-yantao/model-config
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'

/** The provider route the yantao bundle seeds as the intranet gateway. */
export const PROVIDER_ROUTE = 'model-gateway'

/** The settings namespace carrying the provider profiles. */
export const PROFILE_NAMESPACE = 'llm-pi-ai'

/** The settings namespace carrying the agent's default model choice. */
export const DEFAULT_MODEL_NAMESPACE = 'agent-default-model'

/** One editable model row: the identity the gateway answers to plus a label. */
export interface ModelRow {
  readonly id: string
  readonly name: string
}

/** What the dialog opens on: the gateway's current config, joined with the key's state. */
export interface ModelsConfigView {
  /** Resolved display name (composition base when the user layer is silent). */
  readonly displayName: string
  /** Resolved base URL — already normalized, never carrying `/chat/completions`. */
  readonly baseURL: string
  /** Composition-base values, shown as placeholders so a cleared field reads as revert. */
  readonly baseDisplayName: string
  readonly baseBaseURL: string
  /** The profile's `apiKeyEnv` reference, when one is recorded. */
  readonly apiKeyEnv: string | undefined
  /** Whether the referenced credential holds a value (never the value itself). */
  readonly keyConfigured: boolean
  readonly keyWritable: boolean
  /** The stored model rows, as resolved. */
  readonly models: readonly ModelRow[]
  /** The stored default model id, or `''` when none. */
  readonly defaultModel: string
  /** Revision of the provider profile's user section, echoed back on write. */
  readonly profileRevision: number
  /** Revision of the default-model section, likewise. */
  readonly defaultRevision: number
  /** The stored model rows verbatim (extra fields preserved on write). */
  readonly rawModels: readonly unknown[]
}

/** What the dialog submits. An empty `apiKey` means keep the stored one. */
export interface ModelsConfigDraft {
  readonly displayName: string
  readonly baseURL: string
  readonly apiKey: string
  readonly models: readonly ModelRow[]
  readonly defaultModel: string
}

/** What one save answered. */
export type ModelsConfigSaveResult =
  /** Committed; every write hot-applies, no restart needed. */
  | { readonly kind: 'saved' }
  /** The stored revision moved under us; the dialog reloads and asks for a retry. */
  | { readonly kind: 'conflict' }
  /** Any other refusal, with the host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/**
 * Derive the conventional credential reference for a provider route.
 * @param route - provider route id.
 * @returns the reference name (e.g. `model-gateway` → `MODEL_GATEWAY_API_KEY`).
 */
export function deriveKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** The credential reference the yantao gateway's key stores under. */
export const KEY_REF = deriveKeyRef(PROVIDER_ROUTE)

/**
 * Normalize a pasted endpoint into a dsh `baseURL`: the gateway address must
 * end at the protocol root (`/v1`), but the habitual paste is the full
 * chat-completions URL, so a trailing `/chat/completions` (case-insensitive,
 * with any trailing slashes) is stripped. A bare `/v1` passes through.
 * @param input - whatever the field holds.
 * @returns the trimmed base URL (`''` passes through as empty).
 */
export function normalizeBaseUrl(input: string): string {
  let value = input.trim()
  if (value === '') return ''
  value = value.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(value)) {
    value = value.slice(0, -'/chat/completions'.length).replace(/\/+$/, '')
  }
  return value
}

/** Copy keys naming why a typed key cannot be saved (mirrors the stock editor's rules). */
export type ApiKeyIssue = 'keyBlank' | 'keyIllegalCharacters' | undefined

/** Printable ASCII, space excluded — twin of the host's `normalizeApiKey`. */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/**
 * A pasted `NAME=value` environment line. The same two narrowings as the
 * stock editor keep real keys clear of the heuristic: an upper-case name only,
 * and an `=` not followed by another `=` (base64 padding on an all-upper-case
 * key is not an assignment).
 */
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

/** Whether a value is wrapped in one matching pair of quotes. */
function isQuoted(value: string): boolean {
  const first = value[0]
  if (first !== '"' && first !== '\'' && first !== '`') return false
  return value.length > 1 && value.endsWith(first)
}

/**
 * Judge the key field's current value. An empty field means keep the stored
 * key and is not a failure; whitespace-only is.
 * @param draft - the field's value, untrimmed.
 * @returns the issue, or `undefined` to allow submit.
 */
export function apiKeyIssue(draft: string): ApiKeyIssue | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'keyBlank'
  if (ENV_LINE.test(value) || isQuoted(value)) return 'keyIllegalCharacters'
  if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
  return undefined
}

/** Copy keys naming why a draft cannot be submitted. */
export type DraftIssue = 'modelIdRequired' | 'defaultMissing'

/**
 * Judge the dialog's draft as a whole.
 * @param draft - the draft to judge.
 * @returns the issue, or `undefined` to allow save.
 */
export function draftIssue(draft: ModelsConfigDraft): DraftIssue | undefined {
  if (draft.models.some(row => row.id.trim() === '')) return 'modelIdRequired'
  if (draft.defaultModel === '' || !draft.models.some(row => row.id === draft.defaultModel)) {
    return 'defaultMissing'
  }
  return undefined
}

/** A JSON object guard — the stored model rows may carry extra fields. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Diff the draft against the view into path operations on the provider
 * profile. Path-scoped on purpose: fields the dialog does not own (`api`,
 * `compat`, `retryPolicy`, …) are never in an op, so a save cannot clobber
 * them. Clearing a field unsets it, reverting to the composition base.
 *
 * The `models` op writes the rows as `{id, name}` merged over each matching
 * stored row, so seed-carried extras (`contextWindow`, `compat`, …) survive a
 * name edit; brand-new rows carry only the two dialog fields.
 * @param view - the freshly loaded view (baseline for the diff).
 * @param draft - what the dialog holds.
 * @returns the ordered ops, `[]` when the draft changes nothing.
 */
export function profileOps(view: ModelsConfigView, draft: ModelsConfigDraft): SettingsPathOpView[] {
  const root = ['providers', PROVIDER_ROUTE] as const
  const ops: SettingsPathOpView[] = []
  const displayName = draft.displayName.trim()
  if (displayName === '') {
    if (view.displayName !== '') ops.push({ op: 'unset', path: [...root, 'displayName'] })
  } else if (displayName !== view.displayName) {
    ops.push({ op: 'set', path: [...root, 'displayName'], value: displayName })
  }
  const baseURL = normalizeBaseUrl(draft.baseURL)
  if (baseURL === '') {
    if (view.baseURL !== '') ops.push({ op: 'unset', path: [...root, 'baseURL'] })
  } else if (baseURL !== view.baseURL) {
    ops.push({ op: 'set', path: [...root, 'baseURL'], value: baseURL })
  }
  const models = draft.models.map((row) => {
    const stored = view.rawModels.find(entry => isJsonObject(entry) && entry.id === row.id)
    return { ...(stored !== undefined ? stored : {}), id: row.id, name: row.name }
  })
  if (JSON.stringify(models) !== JSON.stringify(view.rawModels)) {
    ops.push({ op: 'set', path: [...root, 'models'], value: models })
  }
  return ops
}

function profileOf(namespace: SettingsNamespaceView | undefined): Record<string, unknown> {
  const value = namespace?.value
  if (!isJsonObject(value)) return {}
  const providers = value.providers
  if (!isJsonObject(providers)) return {}
  const profile = providers[PROVIDER_ROUTE]
  return isJsonObject(profile) ? profile : {}
}

function stringAt(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

function rowsOf(source: Record<string, unknown>): { rows: ModelRow[]; raw: unknown[] } {
  const raw = Array.isArray(source.models) ? source.models : []
  const rows = raw.filter(isJsonObject).map(row => ({
    id: typeof row.id === 'string' ? row.id : '',
    name: typeof row.name === 'string' ? row.name : '',
  }))
  return { rows, raw }
}

function namespaceOf(namespaces: readonly SettingsNamespaceView[], ns: string): SettingsNamespaceView {
  const found = namespaces.find(candidate => candidate.ns === ns)
  if (found === undefined) throw new Error(`设置命名空间 ${ns} 未挂载`)
  return found
}

/**
 * Read the gateway's config view: one settings describe plus one credential
 * state lookup, joined.
 * @param ctx - the client root context (declares `remote.settings` / `remote.credentials`).
 * @returns the view the dialog opens on.
 */
export async function loadModelsConfig(ctx: Context): Promise<ModelsConfigView> {
  const [described, credentials] = await Promise.all([
    ctx.remote.settings.describe(),
    ctx.remote.credentials.describe([KEY_REF]),
  ])
  if (!described.ok) throw described.error
  const profileNs = namespaceOf(described.value.namespaces, PROFILE_NAMESPACE)
  const defaultNs = namespaceOf(described.value.namespaces, DEFAULT_MODEL_NAMESPACE)
  const profile = profileOf(profileNs)
  const baseProfile = isJsonObject(profileNs.base) && isJsonObject(profileNs.base.providers)
    ? (() => {
      const entry = profileNs.base.providers[PROVIDER_ROUTE]
      return isJsonObject(entry) ? entry : {}
    })()
    : {}
  const { rows, raw } = rowsOf(profile)
  const defaultValue = defaultNs.value
  const defaultModel = isJsonObject(defaultValue) && typeof defaultValue.model === 'string'
    ? defaultValue.model
    : ''
  return {
    displayName: stringAt(profile, 'displayName'),
    baseURL: stringAt(profile, 'baseURL'),
    baseDisplayName: stringAt(baseProfile, 'displayName'),
    baseBaseURL: stringAt(baseProfile, 'baseURL'),
    apiKeyEnv: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined,
    keyConfigured: credentials.ok && credentials.value[KEY_REF]?.configured === true,
    keyWritable: !(credentials.ok && credentials.value[KEY_REF]?.writable === false),
    models: rows,
    defaultModel,
    profileRevision: profileNs.revision,
    defaultRevision: defaultNs.revision,
    rawModels: raw,
  }
}

/**
 * Commit a draft: settings ops for the profile, the credentials store for the
 * raw key, a section replace for the default model. The profile write is
 * revision-fenced; a moved revision answers `conflict` and the dialog reloads.
 * @param ctx - the client root context.
 * @param draft - what the dialog holds.
 * @returns the outcome the dialog renders from.
 */
export async function saveModelsConfig(ctx: Context, draft: ModelsConfigDraft): Promise<ModelsConfigSaveResult> {
  const view = await loadModelsConfig(ctx)
  const ops = profileOps(view, draft)
  if (ops.length > 0) {
    const written = await ctx.remote.settings.mutate(PROFILE_NAMESPACE, ops, view.profileRevision)
    if (!written.ok) {
      return written.error.code === 'settings/conflict'
        ? { kind: 'conflict' }
        : { kind: 'refused', message: written.error.message }
    }
  }
  // A typed key goes to the credentials store only; the profile keeps the
  // reference name (hard rule 5). A settings write that succeeded but a key
  // store that refused leaves the dialog open with the draft intact — the
  // retry redoes just the key, since the settings ops are now no-ops.
  const rawKey = draft.apiKey.trim()
  if (rawKey !== '') {
    const stored = await ctx.remote.credentials.set(KEY_REF, rawKey)
    if (!stored.ok) return { kind: 'refused', message: stored.error.message }
    if (view.apiKeyEnv === undefined) {
      const linked = await ctx.remote.settings.mutate(
        PROFILE_NAMESPACE,
        [{ op: 'set', path: ['providers', PROVIDER_ROUTE, 'apiKeyEnv'], value: KEY_REF }],
        // The profile's revision moved with the first mutate; unfence rather
        // than re-read — the only writer here is this dialog.
        undefined,
      )
      if (!linked.ok) {
        return linked.error.code === 'settings/conflict'
          ? { kind: 'conflict' }
          : { kind: 'refused', message: linked.error.message }
      }
    }
  }
  if (draft.defaultModel !== view.defaultModel) {
    const replaced = await ctx.remote.settings.replace(
      DEFAULT_MODEL_NAMESPACE,
      { provider: PROVIDER_ROUTE, model: draft.defaultModel },
      view.defaultRevision,
    )
    if (!replaced.ok) {
      return replaced.error.code === 'settings/conflict'
        ? { kind: 'conflict' }
        : { kind: 'refused', message: replaced.error.message }
    }
  }
  return { kind: 'saved' }
}
