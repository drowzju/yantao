/**
 * Canonical KB file templates. These strings ARE the domain format — the
 * frontmatter key order and the blank-line rhythm are part of the spec, so
 * files are emitted by hand here rather than through a YAML serializer.
 * @module @deepseek-ai/dsh-yantao-kb/templates
 */

import type { EntityType, PersonRelation } from './types.ts'

/** Frontmatter knobs that only some entity kinds carry. */
export interface EntityTemplateOptions {
  /** Person-to-owner relation (default subordinate) — only meaningful for person. */
  relation?: PersonRelation
  /** The meeting's own date (YYYY-MM-DD) — only meaningful for meeting; defaults to the creation date. */
  meetingDate?: string
}

/**
 * The entity file layout: frontmatter, a blank line, the `## 状态` section,
 * two blank lines, the append-only `## 流水` section, a blank line, and the
 * creation bullet.
 * @param type - the entity kind: project adds `areas`, person adds `relation`, and meeting carries
 *   only `date` + `title`; `todo` is the singleton checklist and returns {@link todoFileContent}
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
  // A meeting carries only its own date and title (ADR-0010); the other kinds keep tags + created.
  if (type === 'meeting') {
    return `---\ntype: meeting\ndate: ${options.meetingDate ?? date}\ntitle: ${name}\n---\n\n## 状态\n\n\n## 流水\n\n- ${date} 创建 ${name}\n`
  }
  const fields = [`type: ${type}`]
  if (type === 'project') fields.push('areas: []')
  if (type === 'person') fields.push(`relation: ${options.relation ?? 'subordinate'}`)
  fields.push('tags: []', `created: ${date}`)
  return `---\n${fields.join('\n')}\n---\n\n## 状态\n\n\n## 流水\n\n- ${date} 创建 ${name}\n`
}

/**
 * The singleton todo file: frontmatter and nothing but an Obsidian checkbox
 * list — no `## 状态` / `## 流水` sections, so the kb_ section tools do not
 * apply to it and the whole file is edited as a checklist.
 * @param date - the creation date stamp (YYYY-MM-DD).
 * @returns the complete todo file content with one placeholder checkbox.
 */
export function todoFileContent(date: string): string {
  return `---\ntype: todo\ncreated: ${date}\n---\n\n- [ ] 写下第一个待办\n`
}

/** The shadow-note skeleton living beside a registered resource file.
 * @param source - the resource's sanitized basename (the frontmatter `source` field).
 * @param date - the creation date stamp (YYYY-MM-DD).
 * @returns the complete shadow-note file content.
 */
export function shadowNoteContent(source: string, date: string): string {
  return `---\ntype: resource\nsource: ${source}\ncreated: ${date}\ntags: []\n---\n\n## 摘要\n\n\n## 提炼记录\n`
}

/** The short Chinese readme written at the KB root by kb_init (never overwritten). */
export const KB_README = `# yantao 知识库

这个目录是 yantao 的个人知识库（PARA+P）。

- \`resources/\` — 原始材料，原样存放、永不改写；每个资源文件配一个同名 \`.md\` 影子笔记。
- \`entities/projects/\`、\`entities/areas/\`、\`entities/people/\`、\`entities/meetings/\` — 实体笔记，每个实体一个 \`.md\` 文件。
- \`entities/todos.md\` — 待办单例，Obsidian 复选框清单，没有区段结构。
- \`sessions/\` — 会话归档。

实体文件的「状态」区由人和 agent 共同维护（agent 通过 \`kb_write_state\` 写入）；「流水」区只追加、不改写。读写知识库请使用 \`kb_\` 系列工具。
`
