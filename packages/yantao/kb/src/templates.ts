/**
 * Canonical KB file templates. These strings ARE the domain format — the
 * frontmatter key order and the blank-line rhythm are part of the spec, so
 * files are emitted by hand here rather than through a YAML serializer.
 * @module @deepseek-ai/dsh-yantao-kb/templates
 */

import type { EntityType, PersonRelation } from './types.ts'

/**
 * The entity file layout: frontmatter, a blank line, the human-only
 * `## 状态` section, two blank lines, the append-only `## 流水` section, a
 * blank line, and the creation bullet.
 */
export function entityFileContent(type: EntityType, name: string, date: string, relation?: PersonRelation): string {
  const fields = [`type: ${type}`]
  if (type === 'project') fields.push('areas: []')
  if (type === 'person') fields.push(`relation: ${relation ?? 'subordinate'}`)
  fields.push('tags: []', `created: ${date}`)
  return `---\n${fields.join('\n')}\n---\n\n## 状态\n\n\n## 流水\n\n- ${date} 创建 ${name}\n`
}

/** The shadow-note skeleton living beside a registered resource file. */
export function shadowNoteContent(source: string, date: string): string {
  return `---\ntype: resource\nsource: ${source}\ncreated: ${date}\ntags: []\n---\n\n## 摘要\n\n\n## 提炼记录\n`
}

/** The short Chinese readme written at the KB root by kb_init (never overwritten). */
export const KB_README = `# yantao 知识库

这个目录是 yantao 的个人知识库（PARA+P）。

- \`resources/\` — 原始材料，原样存放、永不改写；每个资源文件配一个同名 \`.md\` 影子笔记。
- \`entities/projects/\`、\`entities/areas/\`、\`entities/people/\` — 实体笔记，每个实体一个 \`.md\` 文件。
- \`sessions/\` — 会话归档。

实体文件的「状态」区只有人类可以修改；「流水」区只追加、不改写。读写知识库请使用 \`kb_\` 系列工具。
`
