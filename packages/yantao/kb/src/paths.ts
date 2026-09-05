/**
 * Path and naming primitives for the yantao KB plugin. Everything the tools
 * write lands under kbRoot; entity names are sanitized before they become
 * file names, and KB-relative resolution refuses to escape kbRoot.
 * @module @deepseek-ai/dsh-yantao-kb/paths
 */

import { isAbsolute, resolve, sep } from 'node:path'
import type { EntityType } from './types.ts'
import { ENTITY_DIRS, KbError } from './types.ts'

/**
 * Map an arbitrary entity or resource name to a safe file name: path and
 * shell metacharacters collapse to `_`, the result is trimmed, trailing dots
 * and spaces are stripped (Windows forbids them), and an empty remainder
 * falls back to `未命名`.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim().replace(/[. ]+$/, '')
  return cleaned === '' ? '未命名' : cleaned
}

/** Today's date in local time, formatted YYYY-MM-DD for frontmatter and log bullets. */
export function todayStamp(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Resolve segments against kbRoot, refusing any result outside it. Entity
 * names are sanitized before they reach this function, so an escape requires
 * a caller-supplied path (the `kb_append_log` path form) — that is exactly
 * the input this guard exists for.
 */
export function resolveWithinKb(kbRoot: string, ...segments: readonly string[]): string {
  const root = resolve(kbRoot)
  const target = resolve(root, ...segments)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new KbError('path-escape', `路径越出了知识库根目录：${segments.join('/')}`)
  }
  return target
}

/** Absolute path of an entity file from its kind and display name. */
export function entityFilePath(kbRoot: string, type: EntityType, name: string): string {
  return resolveWithinKb(kbRoot, 'entities', ENTITY_DIRS[type], `${sanitizeFileName(name)}.md`)
}

/** Normalize a kind spelling — singular type name or plural directory name — to the canonical type. */
export function normalizeEntityType(spelling: string): EntityType {
  const lowered = spelling.toLowerCase()
  for (const type of ['project', 'area', 'person'] as const) {
    if (lowered === type || lowered === ENTITY_DIRS[type]) return type
  }
  throw new KbError(
    'unknown-entity-type',
    `无法识别的实体类型「${spelling}」；可用类型：project / area / person（或目录名 projects / areas / people）`,
  )
}

/**
 * Resolve the `kb_append_log` entity locator: either the `type:name` form
 * (`project:dsh 学习`, plural spellings accepted) or an entity file path —
 * KB-relative (`entities/projects/dsh 学习.md`) or absolute under kbRoot.
 * A Windows absolute path contains a drive colon, so the `type:` match only
 * fires on a known type spelling and absolute paths are probed first.
 */
export function resolveEntityLocator(kbRoot: string, locator: string): string {
  const trimmed = locator.trim()
  if (isAbsolute(trimmed)) {
    const target = resolve(trimmed)
    const root = resolve(kbRoot)
    if (target !== root && !target.startsWith(root + sep)) {
      throw new KbError('path-escape', `实体路径越出了知识库根目录：${trimmed}`)
    }
    return target
  }
  const typeMatch = /^([A-Za-z]+)[:：](.+)$/s.exec(trimmed)
  if (typeMatch !== null) {
    const prefix = typeMatch[1] as string
    if (/^(project|projects|area|areas|person|people)$/i.test(prefix)) {
      return entityFilePath(kbRoot, normalizeEntityType(prefix), (typeMatch[2] as string).trim())
    }
  }
  return resolveWithinKb(kbRoot, trimmed)
}
