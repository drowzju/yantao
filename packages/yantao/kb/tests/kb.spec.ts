import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLog, createEntity, initKb, listEntities, readEntity, registerResource, writeState } from '../src/core.ts'
import { appendToLogSection, logBullet, replaceStateSection } from '../src/splice.ts'
import { sanitizeFileName, todayStamp } from '../src/paths.ts'
import { entityFileContent, shadowNoteContent, todoFileContent } from '../src/templates.ts'
import { KbError } from '../src/types.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

const TODAY = todayStamp()

async function read(path: string): Promise<string> {
  return readFile(join(kbRoot, path), 'utf8')
}

describe('sanitizeFileName', () => {
  it('replaces path and shell metacharacters with underscores', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })
  it('trims whitespace and strips trailing dots and spaces', () => {
    expect(sanitizeFileName('  报告  ')).toBe('报告')
    expect(sanitizeFileName('周报. ')).toBe('周报')
    expect(sanitizeFileName('name...')).toBe('name')
  })
  it('falls back to 未命名 for empty remainders', () => {
    expect(sanitizeFileName('')).toBe('未命名')
    expect(sanitizeFileName('   ')).toBe('未命名')
    expect(sanitizeFileName('...')).toBe('未命名')
  })
  it('keeps ordinary Chinese names intact', () => {
    expect(sanitizeFileName('dsh 学习')).toBe('dsh 学习')
    expect(sanitizeFileName('周报.eml')).toBe('周报.eml')
  })
})

describe('entity template', () => {
  it('matches the canonical project layout byte-for-byte', () => {
    expect(entityFileContent('project', 'dsh 学习', '2026-09-05')).toBe(
      '---\n'
      + 'type: project\n'
      + 'areas: []\n'
      + 'tags: []\n'
      + 'created: 2026-09-05\n'
      + '---\n'
      + '\n'
      + '## 状态\n'
      + '\n'
      + '\n'
      + '## 流水\n'
      + '\n'
      + '- 2026-09-05 创建 dsh 学习\n',
    )
  })
  it('places relation before tags for a person', () => {
    const content = entityFileContent('person', '我自己', '2026-09-05', { relation: 'self' })
    expect(content).toContain('type: person\nrelation: self\ntags: []')
  })

  it('carries the meeting date and title, defaulting the date to the creation day', () => {
    expect(entityFileContent('meeting', '周会', '2026-09-07', { meetingDate: '2026-09-09' })).toBe(
      '---\n'
      + 'type: meeting\n'
      + 'date: 2026-09-09\n'
      + 'title: 周会\n'
      + '---\n'
      + '\n'
      + '## 状态\n'
      + '\n'
      + '\n'
      + '## 流水\n'
      + '\n'
      + '- 2026-09-07 创建 周会\n',
    )
    expect(entityFileContent('meeting', '周会', '2026-09-07')).toContain('date: 2026-09-07\n')
  })

  it('emits the todo singleton as a checkbox list with no sections', () => {
    const content = entityFileContent('todo', 'todos', '2026-09-07')
    expect(content).toBe(todoFileContent('2026-09-07'))
    expect(content).toBe('---\ntype: todo\ncreated: 2026-09-07\n---\n\n- [ ] 写下第一个待办\n')
    expect(content).not.toContain('## 状态')
    expect(content).not.toContain('## 流水')
  })
  it('matches the canonical shadow-note layout byte-for-byte', () => {
    expect(shadowNoteContent('周报.eml', '2026-09-05')).toBe(
      '---\n'
      + 'type: resource\n'
      + 'source: 周报.eml\n'
      + 'created: 2026-09-05\n'
      + 'tags: []\n'
      + '---\n'
      + '\n'
      + '## 摘要\n'
      + '\n'
      + '\n'
      + '## 提炼记录\n',
    )
  })
})

describe('appendToLogSection', () => {
  const base = entityFileContent('project', 'demo', '2026-09-05')

  it('appends after the last bullet and preserves every other byte', () => {
    const next = appendToLogSection(base, ['- 2026-09-06 第二条'], 'demo.md')
    expect(next).toBe(base.replace(
      '- 2026-09-05 创建 demo\n',
      '- 2026-09-05 创建 demo\n- 2026-09-06 第二条\n',
    ))
  })

  it('preserves a human-written State section byte-for-byte', () => {
    const state = '\n## 状态\n\n进行中：等待评审\n- 人类手写的内容，\n  包含缩进与空行\n\n\n## 流水\n'
    const human = base.replace('\n## 状态\n\n\n## 流水\n', state)
    const next = appendToLogSection(human, ['- 2026-09-06 追加'], 'demo.md')
    expect(next).toContain(state)
    expect(next.indexOf(state)).toBe(human.indexOf(state))
    expect(next.endsWith('- 2026-09-06 追加\n')).toBe(true)
  })

  it('appends at EOF when the file lacks a trailing newline', () => {
    const noEol = base.endsWith('\n') ? base.slice(0, -1) : base
    const next = appendToLogSection(noEol, ['- 2026-09-06 追加'], 'demo.md')
    expect(next.startsWith(noEol)).toBe(true)
    expect(next).toBe(`${noEol}\n- 2026-09-06 追加`)
  })

  it('keeps bullets contiguous when the section has trailing blank lines', () => {
    const padded = `${base}\n\n\n`
    const next = appendToLogSection(padded, ['- 2026-09-06 追加'], 'demo.md')
    expect(next).toBe(base.replace(
      '- 2026-09-05 创建 demo\n',
      '- 2026-09-05 创建 demo\n- 2026-09-06 追加\n',
    ) + '\n\n\n')
  })

  it('appends below the heading separator in an empty 流水 section', () => {
    const emptied = base.replace('- 2026-09-05 创建 demo\n', '')
    const next = appendToLogSection(emptied, ['- 2026-09-06 首条'], 'demo.md')
    expect(next).toBe(emptied.replace('## 流水\n\n', '## 流水\n\n- 2026-09-06 首条\n'))
  })

  it('stops at the next level-two section but not at a level-three heading', () => {
    const withH3 = base.replace('## 流水\n\n- 2026-09-05 创建 demo\n', '## 流水\n\n- 2026-09-05 创建 demo\n\n### 备注\n\n人类备注\n\n## 附录\n')
    const next = appendToLogSection(withH3, ['- 2026-09-06 追加'], 'demo.md')
    expect(next).toContain('人类备注\n- 2026-09-06 追加\n\n## 附录\n')
  })

  it('throws missing-log-anchor without touching the content', () => {
    const broken = base.replace('## 流水\n', '## 日志\n')
    expect(() => appendToLogSection(broken, ['- x y'], 'demo.md')).toThrowError(KbError)
    expect(() => appendToLogSection(broken, ['- x y'], 'demo.md')).toThrowError(/缺少『## 流水』锚点/)
  })

  it('throws ambiguous-log-anchor on duplicated anchors', () => {
    const doubled = `${base}\n## 流水\n`
    expect(() => appendToLogSection(doubled, ['- x y'], 'demo.md')).toThrowError(/2 个『## 流水』锚点/)
  })

  it('rejects an empty insert', () => {
    expect(() => appendToLogSection(base, [], 'demo.md')).toThrowError(/追加内容为空/)
  })
})

describe('replaceStateSection', () => {
  const base = entityFileContent('project', 'demo', '2026-09-05')
  const logTail = '\n## 流水\n\n- 2026-09-05 创建 demo\n'

  it('fills the empty State section and preserves every other byte', () => {
    const next = replaceStateSection(base, '进行中：等待评审', 'demo.md')
    expect(next).toBe('---\ntype: project\nareas: []\ntags: []\ncreated: 2026-09-05\n---\n\n## 状态\n\n进行中：等待评审\n' + logTail)
  })

  it('replaces existing State content instead of appending to it', () => {
    const filled = replaceStateSection(base, '旧状态\n第二行', 'demo.md')
    const next = replaceStateSection(filled, '新状态', 'demo.md')
    expect(next).not.toContain('旧状态')
    expect(next).toContain('## 状态\n\n新状态\n')
  })

  it('writes multi-line markdown and normalizes CRLF and outer blank lines', () => {
    const next = replaceStateSection(base, '\r\n- 目标 A\r\n- 目标 B\r\n\r\n', 'demo.md')
    expect(next).toContain('## 状态\n\n- 目标 A\n- 目标 B\n')
  })

  it('empties the section back to the template layout when text is blank', () => {
    const filled = replaceStateSection(base, '进行中', 'demo.md')
    expect(replaceStateSection(filled, '   \n\n', 'demo.md')).toBe(base)
  })

  it('leaves a human-written 流水 section byte-for-byte intact', () => {
    const human = base.replace(
      logTail,
      '\n## 流水\n\n- 2026-09-05 创建 demo\n- 2026-09-06 人类手写\n  带缩进续行\n',
    )
    const next = replaceStateSection(human, '新状态', 'demo.md')
    expect(next.endsWith('- 2026-09-05 创建 demo\n- 2026-09-06 人类手写\n  带缩进续行\n')).toBe(true)
    expect(next.indexOf('## 状态')).toBe(human.indexOf('## 状态'))
  })

  it('throws missing-state-anchor on a file without a State section', () => {
    const broken = base.replace('## 状态\n', '## 近况\n')
    expect(() => replaceStateSection(broken, 'x', 'demo.md')).toThrowError(/缺少『## 状态』锚点/)
  })

  it('throws ambiguous-state-anchor on duplicated anchors', () => {
    const doubled = base.replace('## 状态\n', '## 状态\n\n## 状态\n')
    expect(() => replaceStateSection(doubled, 'x', 'demo.md')).toThrowError(/2 个『## 状态』锚点/)
  })
})

describe('logBullet', () => {
  it('indents continuation lines by two spaces', () => {
    expect(logBullet('2026-09-05', '第一行\n第二行\n第三行')).toEqual([
      '- 2026-09-05 第一行',
      '  第二行',
      '  第三行',
    ])
  })
})

describe('kb_init', () => {
  it('creates the layout, README, and the owner entity, then is idempotent', async () => {
    const first = await initKb(kbRoot)
    expect(first.created).toContain('resources')
    expect(first.created).toContain('entities/people')
    expect(first.created).toContain('sessions')
    expect(first.created).toContain('README.md')
    expect(first.created).toContain('entities/people/我自己.md')
    expect(first.created).toContain('entities/meetings')
    expect(first.created).toContain('entities/todos.md')
    const self = await read('entities/people/我自己.md')
    expect(self).toBe(entityFileContent('person', '我自己', TODAY, { relation: 'self' }))
    expect(await read('entities/todos.md')).toBe(todoFileContent(TODAY))
    const readme = await read('README.md')
    expect(readme).toContain('# yantao 知识库')

    const second = await initKb(kbRoot)
    expect(second.created).toEqual([])
    expect(second.existing).toContain('entities/people/我自己.md')
    expect(second.existing).toContain('entities/todos.md')
    expect(second.existing).toContain('README.md')
  })

  it('never overwrites a todo list the human already wrote', async () => {
    await initKb(kbRoot)
    await writeFile(join(kbRoot, 'entities/todos.md'), '---\ntype: todo\ncreated: 2026-01-01\n---\n\n- [x] 已完成的待办\n')
    const result = await initKb(kbRoot)
    expect(result.created).toEqual([])
    expect(await read('entities/todos.md')).toContain('- [x] 已完成的待办\n')
  })

  it('does not create 我自己 when another person already carries relation: self', async () => {
    await initKb(kbRoot)
    await rm(join(kbRoot, 'entities/people/我自己.md'))
    await writeFile(join(kbRoot, 'entities/people/老板.md'), entityFileContent('person', '老板', TODAY, { relation: 'self' }))
    const result = await initKb(kbRoot)
    expect(result.created).not.toContain('entities/people/我自己.md')
    expect(existsSync(join(kbRoot, 'entities/people/我自己.md'))).toBe(false)
  })
})

describe('kb_create_entity', () => {
  it('creates a project file matching the template', async () => {
    const { path } = await createEntity(kbRoot, 'project', 'dsh 学习')
    expect(path).toBe('entities/projects/dsh 学习.md')
    expect(await read(path)).toBe(entityFileContent('project', 'dsh 学习', TODAY))
  })

  it('refuses to overwrite an existing entity', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    await expect(createEntity(kbRoot, 'project', 'dsh 学习')).rejects.toThrowError(/已存在/)
    expect(await read('entities/projects/dsh 学习.md')).toBe(entityFileContent('project', 'dsh 学习', TODAY))
  })

  it('sanitizes unsafe names into the file name', async () => {
    const { path } = await createEntity(kbRoot, 'area', '工作/生活')
    expect(path).toBe('entities/areas/工作_生活.md')
  })

  it('creates a meeting with the given date', async () => {
    const { path } = await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-09' })
    expect(path).toBe('entities/meetings/周会.md')
    expect(await read(path)).toBe(entityFileContent('meeting', '周会', TODAY, { meetingDate: '2026-09-09' }))
  })

  it('refuses to create the todo singleton', async () => {
    await expect(createEntity(kbRoot, 'todo', 'todos')).rejects.toThrowError(/单例实体/)
  })
})

describe('kb_write_state', () => {
  it('rewrites the State section and leaves the Log section untouched', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    const before = await read('entities/projects/dsh 学习.md')
    const logSection = before.slice(before.indexOf('## 流水'))
    const result = await writeState(kbRoot, 'project:dsh 学习', '进行中：等待评审')
    expect(result.path).toBe('entities/projects/dsh 学习.md')
    expect(result.state).toBe('进行中：等待评审')
    const after = await read('entities/projects/dsh 学习.md')
    expect(after.slice(after.indexOf('## 流水'))).toBe(logSection)
    expect(after).toBe(before.replace('## 状态\n\n\n## 流水\n', '## 状态\n\n进行中：等待评审\n\n## 流水\n'))
  })

  it('accepts plural spellings and paths, and errors on a singleton without a State section', async () => {
    await createEntity(kbRoot, 'meeting', '周会')
    await writeState(kbRoot, 'meetings:周会', '已确认')
    await writeState(kbRoot, 'entities/meetings/周会.md', '已改期')
    expect(await read('entities/meetings/周会.md')).toContain('## 状态\n\n已改期\n')
    await initKb(kbRoot)
    await expect(writeState(kbRoot, 'todo:todos', 'x')).rejects.toThrowError(/缺少『## 状态』锚点/)
  })

  it('rejects locators escaping the KB root', async () => {
    await expect(writeState(kbRoot, '../outside.md', 'x')).rejects.toThrowError(/越出了知识库根目录/)
  })

  it('errors on a missing entity with a not-found message', async () => {
    await expect(writeState(kbRoot, 'project:不存在', 'x')).rejects.toThrowError(/找不到实体文件/)
  })
})

describe('kb_append_log', () => {
  it('appends a dated bullet and leaves the State section untouched', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    const before = await read('entities/projects/dsh 学习.md')
    const stateSection = before.slice(before.indexOf('\n## 状态'), before.indexOf('## 流水'))
    const result = await appendLog(kbRoot, 'project:dsh 学习', '今天完成了 yantao profile 接入。')
    expect(result.appended).toBe(`- ${TODAY} 今天完成了 yantao profile 接入。`)
    const after = await read('entities/projects/dsh 学习.md')
    expect(after.slice(after.indexOf('\n## 状态'), after.indexOf('## 流水'))).toBe(stateSection)
    expect(after).toBe(before.replace(
      `- ${TODAY} 创建 dsh 学习\n`,
      `- ${TODAY} 创建 dsh 学习\n- ${TODAY} 今天完成了 yantao profile 接入。\n`,
    ))
  })

  it('accepts plural type spellings and file paths as the locator', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    await appendLog(kbRoot, 'projects:dsh 学习', '复数拼写')
    await appendLog(kbRoot, 'entities/projects/dsh 学习.md', '路径形式')
    const after = await read('entities/projects/dsh 学习.md')
    expect(after).toContain(`- ${TODAY} 复数拼写\n- ${TODAY} 路径形式\n`)
  })

  it('rejects locators escaping the KB root', async () => {
    await expect(appendLog(kbRoot, '../outside.md', 'x')).rejects.toThrowError(/越出了知识库根目录/)
  })

  it('errors on a missing 流水 anchor without modifying the file', async () => {
    await createEntity(kbRoot, 'project', 'broken')
    const target = join(kbRoot, 'entities/projects/broken.md')
    const broken = (await read('entities/projects/broken.md')).replace('## 流水\n', '## 日志\n')
    await writeFile(target, broken)
    await expect(appendLog(kbRoot, 'project:broken', 'x')).rejects.toThrowError(/缺少『## 流水』锚点/)
    expect(await read('entities/projects/broken.md')).toBe(broken)
  })

  it('errors on malformed frontmatter without modifying the file', async () => {
    await createEntity(kbRoot, 'project', 'bad')
    const target = join(kbRoot, 'entities/projects/bad.md')
    const malformed = (await read('entities/projects/bad.md')).replace('type: project', 'type: [unclosed')
    await writeFile(target, malformed)
    await expect(appendLog(kbRoot, 'project:bad', 'x')).rejects.toThrowError(/frontmatter/)
    expect(await read('entities/projects/bad.md')).toBe(malformed)
  })

  it('errors on a missing entity with a not-found message', async () => {
    await expect(appendLog(kbRoot, 'project:不存在', 'x')).rejects.toThrowError(/找不到实体文件/)
  })
})

describe('kb_read_entity', () => {
  it('returns the complete file content', async () => {
    await createEntity(kbRoot, 'area', '健康')
    const result = await readEntity(kbRoot, 'area', '健康')
    expect(result.path).toBe('entities/areas/健康.md')
    expect(result.content).toBe(entityFileContent('area', '健康', TODAY))
  })
})

describe('kb_list_entities', () => {
  it('lists names by type and hides archived entities by default', async () => {
    await createEntity(kbRoot, 'project', 'A')
    await createEntity(kbRoot, 'project', 'B')
    await createEntity(kbRoot, 'person', '张三')
    const target = join(kbRoot, 'entities/projects/B.md')
    await writeFile(target, (await read('entities/projects/B.md')).replace('tags: []', 'archive: true\ntags: []'))

    const visible = await listEntities(kbRoot)
    expect(visible.entities.map(entry => entry.name).sort()).toEqual(['A', '张三'])
    const projectsOnly = await listEntities(kbRoot, 'project')
    expect(projectsOnly.entities.map(entry => entry.name)).toEqual(['A'])
    const withArchived = await listEntities(kbRoot, 'project', true)
    expect(withArchived.entities.map(entry => `${entry.name}:${String(entry.archived)}`)).toEqual(['A:false', 'B:true'])
    const people = await listEntities(kbRoot, 'person')
    expect(people.entities[0]?.relation).toBe('subordinate')
  })

  it('lists meetings and the todo singleton', async () => {
    await createEntity(kbRoot, 'meeting', '周会')
    await initKb(kbRoot)
    const rows = (await listEntities(kbRoot)).entities.map(entry => `${entry.type}:${entry.name}`)
    expect(rows).toContain('meeting:周会')
    expect(rows).toContain('todo:todos')
    const todos = await listEntities(kbRoot, 'todo')
    expect(todos.entities).toEqual([{ type: 'todo', name: 'todos', archived: false }])
    const result = await readEntity(kbRoot, 'todo', 'todos')
    expect(result.path).toBe('entities/todos.md')
  })

  it('omits the todo singleton when its file is absent', async () => {
    expect((await listEntities(kbRoot, 'todo')).entities).toEqual([])
  })
})

describe('kb_register_resource', () => {
  it('copies the file and writes the shadow-note skeleton', async () => {
    const source = join(kbRoot, '周报.eml')
    await writeFile(source, 'raw mail bytes')
    const result = await registerResource(kbRoot, source)
    expect(result.resource).toBe('resources/周报.eml')
    expect(result.note).toBe('resources/周报.eml.md')
    expect(await read('resources/周报.eml')).toBe('raw mail bytes')
    expect(await read('resources/周报.eml.md')).toBe(shadowNoteContent('周报.eml', TODAY))
  })

  it('refuses to overwrite an already-registered resource', async () => {
    const source = join(kbRoot, '周报.eml')
    await writeFile(source, 'v1')
    await mkdir(join(kbRoot, 'inbox'), { recursive: true })
    const second = join(kbRoot, 'inbox/周报.eml')
    await writeFile(second, 'v2')
    await registerResource(kbRoot, source)
    await expect(registerResource(kbRoot, second)).rejects.toThrowError(/已登记过/)
    expect(await read('resources/周报.eml')).toBe('v1')
  })

  it('errors on a missing source file', async () => {
    await expect(registerResource(kbRoot, join(kbRoot, '不存在.pdf'))).rejects.toThrowError(/找不到要登记的文件/)
  })
})
