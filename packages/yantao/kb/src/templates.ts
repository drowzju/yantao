/**
 * Canonical KB file templates. These strings ARE the domain format — the
 * frontmatter key order and the blank-line rhythm are part of the spec, so
 * files are emitted by hand here rather than through a YAML serializer.
 *
 * ADR-0026 决定 1: the entity file = code-generated frontmatter + a body
 * skeleton + a mechanically guaranteed `## 流水` section. The skeleton comes
 * from the user's `<kbRoot>/.yantao/templates/<type>.md` when present (body
 * only — the template's own frontmatter is ignored) and from the built-in
 * skeleton otherwise. 状态 is the template's call: whatever sections the body
 * carries are what the entity gets. 流水 is the mechanism's call: every entity
 * has one, appended at the end when the body lacks it, with the creation
 * bullet inside.
 * @module @deepseek-ai/dsh-yantao-kb/templates
 */

import type { EntityType, PersonRelation } from './types.ts'
import { appendToLogSection, logBullet } from './splice.ts'

/** Frontmatter knobs that only some entity kinds carry. */
export interface EntityTemplateOptions {
  /** Person-to-owner relation (default subordinate) — only meaningful for person. */
  relation?: PersonRelation
  /**
   * The person's e-mail address — only meaningful for person. Mail analysis
   * writes the sender address here so later batches match the sender to the
   * entity by address first, name second.
   */
  email?: string
  /** The meeting's own date (YYYY-MM-DD) — only meaningful for meeting; defaults to the creation date. */
  meetingDate?: string
}

/**
 * The built-in body skeletons, one per entity kind (ADR-0026 决定 1). The
 * `## 流水` section is deliberately absent from every skeleton — assembly
 * appends it, so built-in and user templates travel one code path. project
 * gains `## 目标` + `## 下一步` (a project has an end: north star, then next
 * action); area gains `## 标准` + `## 检视` (an area is a maintained standard,
 * the PARA sense); person and meeting carry only `## 状态` — their differences
 * live in frontmatter.
 */
export function builtinEntityBody(type: EntityType): string {
  switch (type) {
    case 'project': return '## 目标\n\n\n## 下一步\n\n\n## 状态'
    case 'area': return '## 标准\n\n\n## 检视\n\n\n## 状态'
    case 'person':
    case 'meeting': return '## 状态'
    case 'todo': return ''
  }
}

/**
 * The entity file's frontmatter block (no trailing blank line): a meeting
 * carries only its own date and title (ADR-0010); the other kinds keep
 * tags + created, with project adding `areas` and person `relation`/`email`.
 * @param type - the entity kind; `todo` has no frontmatter here (the singleton
 *   file is emitted whole by {@link todoFileContent}).
 * @param name - the entity display name written into frontmatter.
 * @param date - the creation date stamp (YYYY-MM-DD).
 * @param options - kind-specific frontmatter knobs.
 * @returns the frontmatter block, from the opening to the closing `---`.
 */
export function entityFrontmatter(
  type: EntityType,
  name: string,
  date: string,
  options: EntityTemplateOptions = {},
): string {
  if (type === 'meeting') return `---\ntype: meeting\ndate: ${options.meetingDate ?? date}\ntitle: ${name}\n---`
  const fields = [`type: ${type}`]
  if (type === 'project') fields.push('areas: []')
  if (type === 'person') fields.push(`relation: ${options.relation ?? 'subordinate'}`)
  if (type === 'person' && options.email !== undefined && options.email !== '') fields.push(`email: ${options.email}`)
  fields.push('tags: []', `created: ${date}`)
  return `---\n${fields.join('\n')}\n---`
}

/**
 * Assemble the complete entity file: frontmatter, a blank line, the body
 * skeleton, and the mechanically guaranteed `## 流水` section with the
 * creation bullet inside it (ADR-0026 决定 1). When the body already carries
 * a `## 流水` section — wherever the template placed it — the bullet lands at
 * the end of that section; when it does not, the section is appended after
 * the body with the canonical two-blank-line rhythm.
 * @param frontmatter - the code-generated frontmatter block (see {@link entityFrontmatter}).
 * @param body - the body skeleton (user template or {@link builtinEntityBody}); CRLF is normalized.
 * @param date - the creation date stamp (YYYY-MM-DD) for the creation bullet.
 * @param name - the entity display name written into the creation bullet.
 * @returns the complete canonical entity file content.
 */
export function assembleEntityFile(frontmatter: string, body: string, date: string, name: string): string {
  const trimmed = body.replace(/\r\n/g, '\n').trim()
  const ensured = /^## 流水[ \t]*$/m.test(trimmed)
    ? trimmed
    : trimmed === '' ? '## 流水' : `${trimmed}\n\n\n## 流水`
  const content = `${frontmatter}\n\n${ensured}\n`
  // When the body carries no 流水 content the bullet lands after the trailing
  // blank row, which would swallow the file's final newline — restore it so
  // the assembled file always ends with exactly one newline, like the old
  // hand-written templates did.
  const spliced = appendToLogSection(content, logBullet(date, `创建 ${name}`), name)
  return spliced.endsWith('\n') ? spliced : `${spliced}\n`
}

/** The outcome of parsing a user template file: a usable body, or a 流水 anchor the mechanism cannot locate. */
export type TemplateBody =
  | { kind: 'body'; body: string }
  | { kind: 'duplicate-log' }

/**
 * Parse a user template file into its body skeleton (ADR-0026 决定 1). The
 * template's own frontmatter — if the file opens with one — is stripped: the
 * entity's frontmatter is code-generated, so the file only contributes the
 * body. More than one `## 流水` heading is the one pathology the mechanism
 * cannot self-heal (the anchor must exist exactly once), and the caller falls
 * back to the built-in skeleton; a missing `## 流水` is fine — assembly
 * appends it.
 * @param text - the complete template file text.
 * @returns the body skeleton, or `duplicate-log` when the 流水 anchor repeats.
 */
export function templateBodyOf(text: string): TemplateBody {
  const normalized = text.replace(/\r\n/g, '\n')
  const stripped = /^---\n[\s\S]*?\n---\n?/.test(normalized)
    ? normalized.replace(/^---\n[\s\S]*?\n---\n?/, '')
    : normalized
  const body = stripped.trim()
  const logs = body.match(/^## 流水[ \t]*$/gm)
  if (logs !== null && logs.length > 1) return { kind: 'duplicate-log' }
  return { kind: 'body', body }
}

/**
 * The complete canonical entity file content from the built-in skeleton —
 * the fallback shape every entity takes when no user template file exists.
 * The layout: frontmatter, a blank line, the body skeleton, and the
 * append-only `## 流水` section carrying the creation bullet.
 * @param type - the entity kind; `todo` is the singleton checklist and returns {@link todoFileContent}
 *   instead — it carries no sections.
 * @param name - the entity display name written into frontmatter and the creation bullet.
 * @param date - the creation date stamp (YYYY-MM-DD).
 * @param options - kind-specific frontmatter knobs.
 * @returns the complete canonical entity file content.
 */
export function entityFileContent(
  type: EntityType,
  name: string,
  date: string,
  options: EntityTemplateOptions = {},
): string {
  if (type === 'todo') return todoFileContent(date)
  return assembleEntityFile(entityFrontmatter(type, name, date, options), builtinEntityBody(type), date, name)
}

/**
 * The singleton todo file: frontmatter and nothing but an Obsidian checkbox
 * list — no `## 状态` / `## 流水` sections, so the kb_ section tools do not
 * apply to it and the whole file is edited as a checklist. Each row is
 * `- [ ] [due::YYYY-MM-DD] 标题` with its markdown body on the lines below,
 * indented two spaces; see the todo module for the full format.
 * @param date - the creation date stamp (YYYY-MM-DD), also the example item's deadline.
 * @returns the complete todo file content with one placeholder checkbox.
 */
export function todoFileContent(date: string): string {
  return `---\ntype: todo\ncreated: ${date}\n---\n\n- [ ] [due::${date}] 写下第一个待办\n  缩进两格写正文：这里可以写多行 markdown\n`
}

/** The short Chinese readme written at the KB root by kb_init (never overwritten). */
export const KB_README = `# yantao 知识库

这个目录是 yantao 的个人知识库（PARA+P）。

- \`resources/\` — 原始材料，原样存放、永不改写。
- \`entities/projects/\`、\`entities/areas/\`、\`entities/people/\`、\`entities/meetings/\` — 实体笔记，每个实体一个 \`.md\` 文件。
- \`entities/todos.md\` — 待办单例，Obsidian 复选框清单，没有区段结构；每行形如 \`- [ ] [due::YYYY-MM-DD] 标题\`，条目正文缩进两格写在下方。
- \`.yantao/\` — 工作台的机器簿记与模板（\`.yantao/templates/<type>.md\` 可自定义新建实体的正文骨架），不进界面树。
- \`sessions/\` — 会话归档。

实体文件的「状态」区由人和 agent 共同维护（agent 通过 \`kb_write_state\` 写入）；「流水」区只追加、不改写。读写知识库请使用 \`kb_\` 系列工具。
`
