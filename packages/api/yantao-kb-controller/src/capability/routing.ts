/**
 * The central capability routing file (ADR-0025 落地注记二; ADR-0052 决定 1
 * 升格): the ONE capability configuration file —
 * `<kbRoot>/.dsh/skills/yantao.json`. Each entry is pure *reachability*:
 * `{path, invocation, appliesTo}` — where the skill directory sits (any
 * depth inside the skills root) and who may reach it. There is no other
 * declaration anywhere: no sidecar, no frontmatter section, no entry/runtime
 * (ADR-0052 决定 2 — the form layer evaporated with the spawn execution
 * model). The upstream scanner ignores the file (it only reads `*.md` flat
 * files and one-level directories), so a dropped third-party tree is never
 * moved, renamed, or merged.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/routing
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { parseFrontmatter } from '@deepseek-ai/dsh-yantao-kb'
import { CapabilityError, appliesToOf, invocationOf } from './run.ts'
import type { CapabilityAppliesTo, CapabilityInvoker } from './run.ts'

/** The KB-relative path of the routing file, for prose. */
export const ROUTES_PATH = '.dsh/skills/yantao.json'

/**
 * One route entry: where the capability's skill directory sits and who may
 * reach it — the whole configuration there is (ADR-0052 决定 1).
 */
export interface CapabilityRoute {
  /** The skill directory's path, relative to `.dsh/skills/`, with forward slashes. */
  readonly path: string
  /** Who may invoke the capability (ADR-0023 决定 2); a subset of `['human', 'agent']`. */
  readonly invocation: readonly CapabilityInvoker[]
  /** What the capability accepts; absent means "offered from the 能力 tab only". */
  readonly appliesTo?: CapabilityAppliesTo
}

/** One routed skill as the controller resolves it: its directory and its SKILL.md. */
export interface RoutedSkill {
  /** Absolute path of the routed skill directory. */
  readonly directory: string
  /** The SKILL.md frontmatter's description, `''` when it declares none. */
  readonly description: string
  /** The SKILL.md body after the frontmatter. */
  readonly body: string
}

/** A route name must be one safe path segment — the same shape a skill name has. */
function routeNameOf(name: string): string {
  if (name === '.' || name === '..' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new CapabilityError(
      'bad-manifest',
      `中央路由的能力名只能是单个安全路径段：${name}`,
      `请修正 ${ROUTES_PATH} 里 capabilities 下的这个键名。`,
    )
  }
  return name
}

/** Validate one route entry's `path`: relative, forward slashes, no escape from the skills root. */
function routePathOf(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new CapabilityError(
      'bad-manifest',
      '中央路由条目的 path 必须是非空字符串（相对 .dsh/skills/ 的目录路径）。',
      `请修正 ${ROUTES_PATH} 里的 path 字段。`,
    )
  }
  const normalized = value.replaceAll('\\', '/')
  if (isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new CapabilityError(
      'bad-manifest',
      `中央路由条目的 path 不得越出 .dsh/skills/：${value}`,
      `请修正 ${ROUTES_PATH} 里的 path 字段。`,
    )
  }
  return normalized
}

/** Validate one route entry: reachability only — `path`, `invocation`, `appliesTo`, nothing else. */
function routeOf(name: string, declared: unknown): CapabilityRoute {
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new CapabilityError(
      'bad-manifest',
      `能力「${name}」的中央路由条目必须是对象。`,
      `请修正 ${ROUTES_PATH} 里 capabilities.${name} 的形状。`,
    )
  }
  const keys = Object.keys(declared)
  const unknownKey = keys.find(key => key !== 'path' && key !== 'invocation' && key !== 'appliesTo')
  if (unknownKey !== undefined) {
    throw new CapabilityError(
      'bad-manifest',
      `能力「${name}」的中央路由条目只支持 path/invocation/appliesTo（ADR-0052：路由只存可达），发现了「${unknownKey}」。`,
      `请从 ${ROUTES_PATH} 里 capabilities.${name} 删除「${unknownKey}」字段。`,
    )
  }
  const { path, invocation, appliesTo } = declared as {
    path?: unknown
    invocation?: unknown
    appliesTo?: unknown
  }
  return {
    path: routePathOf(path),
    invocation: invocationOf(name, invocation),
    ...appliesTo !== undefined ? { appliesTo: appliesToOf(name, appliesTo) } : {},
  }
}

/**
 * Read and validate the central routing file, answering `{}` when there is
 * none. A malformed file is a broken declaration, not a silent empty: every
 * caller surfaces the error (the run path as bad-manifest; the listing and
 * the pre-step hooks catch it and go on without routes).
 */
export async function readRoutes(skillsRoot: string): Promise<Record<string, CapabilityRoute>> {
  let raw: string
  try {
    raw = await readFile(join(skillsRoot, 'yantao.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new CapabilityError(
      'bad-manifest',
      `无法读取中央路由文件 ${ROUTES_PATH}：${(error as Error).message}`,
      '请检查文件权限，或删除该文件后重新注册。',
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CapabilityError(
      'bad-manifest',
      `中央路由文件 ${ROUTES_PATH} 不是合法 JSON。`,
      '请修复或删除该文件后重试。',
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CapabilityError(
      'bad-manifest',
      `中央路由文件 ${ROUTES_PATH} 必须是 JSON 对象。`,
      '请修复或删除该文件后重试。',
    )
  }
  const { version, capabilities } = parsed as { version?: unknown; capabilities?: unknown }
  if (version !== 1) {
    throw new CapabilityError(
      'bad-manifest',
      `中央路由文件 ${ROUTES_PATH} 的 version 必须是 1。`,
      '请修复或删除该文件后重试。',
    )
  }
  if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
    throw new CapabilityError(
      'bad-manifest',
      `中央路由文件 ${ROUTES_PATH} 的 capabilities 必须是对象。`,
      '请修复或删除该文件后重试。',
    )
  }
  const routes: Record<string, CapabilityRoute> = {}
  for (const [name, entry] of Object.entries(capabilities)) {
    routes[routeNameOf(name)] = routeOf(name, entry)
  }
  return routes
}

/**
 * One read-modify-write over the routing file's capabilities map: the mutator
 * receives the parsed (unvalidated) capabilities object and answers its
 * replacement; unknown top-level keys survive, `version` is pinned to 1. A
 * file that exists but is unreadable is reported, never silently reset.
 */
async function mutateRoutes(
  skillsRoot: string,
  action: 'append' | 'update' | 'remove',
  mutate: (capabilities: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  let existing: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await readFile(join(skillsRoot, 'yantao.json'), 'utf8'))
    existing = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new CapabilityError(
        'bad-manifest',
        `中央路由文件 ${ROUTES_PATH} 损坏，无法${action === 'append' ? '追加' : action === 'update' ? '更新' : '删除'}路由：${(error as Error).message}`,
        '请先修复或删除该文件，再重试。',
      )
    }
    existing = {}
  }
  const capabilities = typeof existing.capabilities === 'object' && existing.capabilities !== null
    && !Array.isArray(existing.capabilities)
    ? existing.capabilities as Record<string, unknown>
    : {}
  try {
    await mkdir(skillsRoot, { recursive: true })
    await writeFile(
      join(skillsRoot, 'yantao.json'),
      `${JSON.stringify({ ...existing, version: 1, capabilities: mutate(capabilities) }, null, 2)}\n`,
      'utf8',
    )
  } catch (error) {
    throw new CapabilityError(
      'bad-manifest',
      `无法写入中央路由文件 ${ROUTES_PATH}：${(error as Error).message}`,
      '请检查 .dsh/skills/ 的写权限。',
    )
  }
}

/**
 * Add route entries to the central routing file — registration's whole
 * filesystem effect. Unknown top-level keys and unrelated entries survive.
 */
export async function addRoutes(
  skillsRoot: string,
  entries: Record<string, CapabilityRoute>,
): Promise<void> {
  await mutateRoutes(skillsRoot, 'append', capabilities => ({ ...capabilities, ...entries }))
}

/**
 * Rewrite one entry's reachability (ADR-0053 决定 2's 写回): the entry must
 * already exist — toggling reachability is not a hidden re-registration.
 * The `path` is never touched; only `invocation`/`appliesTo` are replaced.
 */
export async function updateRoute(
  skillsRoot: string,
  name: string,
  reach: Pick<CapabilityRoute, 'invocation' | 'appliesTo'>,
): Promise<void> {
  await mutateRoutes(skillsRoot, 'update', (capabilities) => {
    const raw = capabilities[name]
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new CapabilityError(
        'bad-manifest',
        `中央路由文件 ${ROUTES_PATH} 里没有能力「${name}」的条目，无法更新。`,
        '请先在能力清单里注册该能力。',
      )
    }
    // Validate the untouched entry too: a broken file must not be rewritten
    // into a "fixed-looking" one with the other entries silently dropped.
    const validated = routeOf(name, raw)
    return { ...capabilities, [name]: { ...validated, ...reach } }
  })
}

/**
 * Remove one entry from the central routing file — unregistration's whole
 * filesystem effect (ADR-0053 决定 2). Answers whether an entry was actually
 * removed; removing an absent name is a caller-visible miss, not an error.
 */
export async function removeRoute(skillsRoot: string, name: string): Promise<boolean> {
  let removed = false
  await mutateRoutes(skillsRoot, 'remove', (capabilities) => {
    if (!(name in capabilities)) return capabilities
    removed = true
    const { [name]: _dropped, ...rest } = capabilities
    return rest
  })
  return removed
}

/**
 * Resolve one route to its skill directory and SKILL.md. The target must
 * exist and carry a readable frontmatter — a route whose target was deleted
 * or renamed answers `undefined` (a stale route, not a broken file).
 */
export async function routedSkill(
  skillsRoot: string,
  route: CapabilityRoute,
): Promise<RoutedSkill | undefined> {
  const directory = resolve(skillsRoot, route.path)
  let raw: string
  try {
    raw = await readFile(join(directory, 'SKILL.md'), 'utf8')
  } catch {
    return undefined
  }
  let description = ''
  let body: string
  try {
    const frontmatter = parseFrontmatter(raw, `${route.path}/SKILL.md`)
    const declared = frontmatter.data.description
    if (typeof declared === 'string') description = declared
    body = frontmatter.body
  } catch {
    return undefined
  }
  return { directory, description, body }
}

/** Re-export for the controller's error wrapping. */
export { CapabilityError }
export type { CapabilityAppliesTo, CapabilityInvoker }
