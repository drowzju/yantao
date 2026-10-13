/**
 * The proposed-action vocabulary's controller-side twin (ADR-0055): the one
 * table the `kb_propose_actions` tool validates against before an agent's
 * nomination may enter the proposal inbox. The schema authority stays with
 * the client's unified proposal module (ADR-0021 决定 4, ADR-0047 决定 3) —
 * this file is a deliberate copy of the client's `capability-match.ts`
 * tables (KINDS / REQUIRED_FIELDS / EMPTY_OK_FIELDS, plus the `mails` range
 * normalization), pinned to it by a parity spec: the tool must refuse
 * exactly what the card would refuse, or a nomination enqueued here would
 * die on the card later.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/proposal-actions
 */

/** The action kinds the applier knows — mirror of the client's KINDS.
 * Exported for the parity spec that pins this twin to the client's table. */
export const KINDS = [
  'create-entity', 'create-project', 'append-log', 'write-state', 'save-resource', 'create-link',
  'add-todo', 'edit-section', 'append-section', 'add-memory', 'delete-mails', 'archive-mails',
  'skill-rewrite',
] as const

type ActionKind = typeof KINDS[number]

/** The payload fields each kind needs as non-empty strings — mirror of the client's REQUIRED_FIELDS.
 * Exported for the parity spec (ADR-0055). */
export const REQUIRED_FIELDS: Partial<Record<ActionKind, readonly string[]>> = {
  'create-entity': ['entityType', 'name'],
  'create-project': ['name'],
  'append-log': ['entityPath', 'entityName', 'text'],
  'write-state': ['entityPath', 'entityName', 'text'],
  'save-resource': ['path', 'content'],
  'create-link': ['entityPath', 'entityName', 'link'],
  'add-todo': ['title', 'body'],
  'edit-section': ['path', 'section', 'after', 'why'],
  'append-section': ['path', 'section', 'text'],
  'add-memory': ['scope', 'text'],
  'delete-mails': ['entryId', 'sender', 'subject'],
  'archive-mails': ['entryId', 'sender', 'subject'],
  'skill-rewrite': ['name', 'file', 'original', 'new', 'why'],
}

/** Kind-scoped fields tolerated as '' — mirror of the client's EMPTY_OK_FIELDS.
 * Exported for the parity spec (ADR-0055). */
export const EMPTY_OK_FIELDS: ReadonlySet<string> = new Set([
  'append-log:entityPath', 'write-state:entityPath', 'create-link:entityPath',
  'edit-section:path', 'append-section:path', 'add-todo:body',
])

/**
 * The entity-bodied kinds whose `entityPath` names an entity: beyond being a
 * string, it must be a locator the applier can resolve — a `type:name`
 * locator (the examples' form; the applier resolves it through the
 * controller's `resolveEntity`) or an entity file path. A bare display name
 * (`某项目`) or a directory-ish value passes the field tables but can only
 * die as a not-found at apply time — named back here instead, while the
 * model can still repair the row in the same turn (2026-10-13 周报流水事故
 * 的姊妹防线).
 */
const ENTITY_PATH_KINDS: ReadonlySet<string> = new Set(['append-log', 'write-state', 'create-link'])

const ENTITY_TYPE_PREFIX = /^(project|projects|area|areas|person|people|meeting|meetings|todo|todos)[:：]/

/** One minimal valid example per kind, inlined into missing-field
 * diagnostics (2026-10-10 补提事故：the drop note named the missing fields
 * but not the shape, and a post-compaction repair rebuilt the rows without
 * `entityPath` — costing two extra supplement cards. Teaching the shape in
 * the same breath as the verdict makes the repair one-shot.). For kinds
 * with an EMPTY_OK field the example shows it as `""` — the subtle contract
 * (key must exist, value may be empty) is exactly what guessing gets wrong.
 * Presentation-only: the parity spec pins the field tables, not this prose. */
const KIND_EXAMPLES: Record<ActionKind, string> = {
  'create-entity': '{"kind":"create-entity","entityType":"project","name":"某项目"}',
  'create-project': '{"kind":"create-project","name":"某项目"}',
  'append-log': '{"kind":"append-log","entityPath":"project:某项目","entityName":"某项目","text":"一条动态"}',
  'write-state': '{"kind":"write-state","entityPath":"","entityName":"某项目","text":"当前状态一行"}',
  'save-resource': '{"kind":"save-resource","path":"resources/某文件.md","content":"文件全文"}',
  'create-link': '{"kind":"create-link","entityPath":"project:某项目","entityName":"某项目","link":"https://…"}',
  'add-todo': '{"kind":"add-todo","title":"待办标题","body":"详情，可为空串"}',
  'edit-section': '{"kind":"edit-section","path":"某实体.md","section":"某节","after":"锚定原文","why":"修改理由"}',
  'append-section': '{"kind":"append-section","path":"某实体.md","section":"某节","text":"补充内容"}',
  'add-memory': '{"kind":"add-memory","scope":"user","text":"记忆内容"}',
  'delete-mails': '{"kind":"delete-mails","entryId":"…","sender":"…","subject":"…"}',
  'archive-mails': '{"kind":"archive-mails","entryId":"…","sender":"…","subject":"…"}',
  'skill-rewrite': '{"kind":"skill-rewrite","name":"mail","file":"SKILL.md","original":"原文","new":"新文","why":"理由"}',
}

/**
 * Diagnose one proposed action against the kind tables (ADR-0055): the one
 * row-level check both the whole-list and the per-item tolerant faces share.
 * @param entry - one action exactly as the model handed it over.
 * @param at - the action's 0-based position, for the named diagnostic.
 * @returns the diagnostic line, or '' when the row passes.
 */
function diagnoseAction(entry: unknown, at: number): string {
  if (typeof entry !== 'object' || entry === null) return `第 ${at + 1} 项不是对象`
  const bag = entry as Record<string, unknown>
  const kind = typeof bag.kind === 'string' ? bag.kind : undefined
  if (kind === undefined || !KINDS.includes(kind as ActionKind)) {
    return `第 ${at + 1} 项「${kind ?? '（缺 kind）'}」不是已知的动作类别`
  }
  const required = REQUIRED_FIELDS[kind as ActionKind] ?? []
  const missing = required.filter(field =>
    typeof bag[field] !== 'string'
    || (bag[field] === '' && !EMPTY_OK_FIELDS.has(`${kind}:${field}`)))
  if (missing.length > 0) {
    return `第 ${at + 1} 项「${kind}」缺必填字段 ${missing.join('、')}（该项形如 ${KIND_EXAMPLES[kind as ActionKind]}）`
  }
  if (ENTITY_PATH_KINDS.has(kind as string)) {
    const entityPath = bag.entityPath as string
    if (entityPath !== '' && !ENTITY_TYPE_PREFIX.test(entityPath) && !entityPath.endsWith('.md')) {
      return `第 ${at + 1} 项「${kind}」的 entityPath 不是可解析的实体定位（应为 type:name 或实体文件路径，形如 ${KIND_EXAMPLES[kind as ActionKind]}）`
    }
  }
  return ''
}

/**
 * Validate one proposed `actions` array field-by-field (ADR-0055): unlike
 * the client's parser — which silently drops unknown rows — the tool is the
 * nomination's front door, so every bad row is named back to the model.
 * @param raw - the `actions` array exactly as the model handed it over.
 * @returns one diagnostic line per offending action; empty means the whole
 *   list passes and may be enqueued verbatim.
 */
export function validateProposedActions(raw: readonly unknown[]): readonly string[] {
  if (raw.length === 0) return ['actions 不能为空——没有值得提议的就不要调用本工具']
  return raw.map((entry, at) => diagnoseAction(entry, at)).filter(line => line !== '')
}

/**
 * Split a proposed `actions` array into the rows that pass the kind tables
 * and named diagnostics for the rest (2026-10-10 裁决：逐项容错). The old
 * whole-order gate made one bad row sink a whole run-sized nomination — the
 * mail schedule's one-card-per-run shape needs the opposite: valid rows
 * enqueue, bad rows are named back for an in-turn repair.
 * @param raw - the `actions` array exactly as the model handed it over.
 * @returns the passing rows (enqueue these) and one diagnostic line per
 *   dropped row; an empty `raw` yields no valid rows and the empty-input
 *   diagnostic, so the caller's all-dropped face covers it naturally.
 */
export function partitionProposedActions(raw: readonly unknown[]): {
  valid: readonly unknown[]
  diagnostics: readonly string[]
} {
  if (raw.length === 0) {
    return { valid: [], diagnostics: ['actions 不能为空——没有值得提议的就不要调用本工具'] }
  }
  const valid: unknown[] = []
  const diagnostics: string[] = []
  raw.forEach((entry, at) => {
    const line = diagnoseAction(entry, at)
    if (line === '') valid.push(entry)
    else diagnostics.push(line)
  })
  return { valid, diagnostics }
}

/**
 * The optional `mails` watermark range, normalized the way the client's
 * parser does (ADR-0047 验收修正 2): both stamps must parse as dates and are
 * canonicalized to ISO Z-form — the watermark writer stores verbatim and the
 * mail reader parses `--since` strictly, so a loose shape would poison the
 * cursor. Anything else is simply no range.
 * @param raw - the `mails` field as the model handed it over.
 * @returns the normalized range, or undefined when absent/invalid.
 */
export function normalizeMailRange(raw: unknown): { lastReadAt: string; firstReadAt?: string } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as Record<string, unknown>
  const isoOf = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (trimmed === '' || Number.isNaN(Date.parse(trimmed))) return undefined
    return new Date(trimmed).toISOString()
  }
  const lastReadAt = isoOf(candidate.lastReadAt)
  if (lastReadAt === undefined) return undefined
  const firstReadAt = isoOf(candidate.firstReadAt)
  return { lastReadAt, ...(firstReadAt !== undefined ? { firstReadAt } : {}) }
}

/**
 * The inbox note's coverage span (ADR-0047 决定 8's visible bookkeeping),
 * formatted like the scheduler's own `inboxNoteOf`: 「覆盖邮件 M-D → M-D」.
 * @param range - the normalized mails range.
 * @returns the span text, or undefined when the range carries no usable stamps.
 */
export function mailSpanNote(range: { lastReadAt: string; firstReadAt?: string } | undefined): string | undefined {
  if (range === undefined) return undefined
  const day = (iso: string): string => {
    const at = new Date(iso)
    return Number.isNaN(at.getTime()) ? iso : `${at.getMonth() + 1}-${at.getDate()}`
  }
  const span = range.firstReadAt !== undefined ? `${day(range.firstReadAt)} → ${day(range.lastReadAt)}` : day(range.lastReadAt)
  return `覆盖邮件 ${span}`
}
