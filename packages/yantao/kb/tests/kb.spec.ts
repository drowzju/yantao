import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLog, createEntity, editSection, initKb, listEntities, readEntity, readResource, registerResource, registerResourceContent, writeResource, writeState } from '../src/core.ts'
import { appendToLogSection, logBullet, replaceSection, replaceStateSection } from '../src/splice.ts'
import { sanitizeFileName, todayStamp } from '../src/paths.ts'
import { entityFileContent, todoFileContent } from '../src/templates.ts'
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
      + '## 目标\n'
      + '\n'
      + '\n'
      + '## 下一步\n'
      + '\n'
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

  it('gives an area the 标准 and 检视 sections ahead of 状态', () => {
    const content = entityFileContent('area', '健康', '2026-09-05')
    expect(content).toContain('## 标准\n\n\n## 检视\n\n\n## 状态\n')
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
    expect(content).toBe(
      '---\ntype: todo\ncreated: 2026-09-07\n---\n\n- [ ] [due::2026-09-07] 写下第一个待办\n  缩进两格写正文：这里可以写多行 markdown\n',
    )
    expect(content).not.toContain('## 状态')
    expect(content).not.toContain('## 流水')
  })
})

describe('custom entity templates', () => {
  const templateDir = () => join(kbRoot, '.yantao', 'templates')

  it('uses the custom body skeleton and strips the template frontmatter', async () => {
    await mkdir(templateDir(), { recursive: true })
    await writeFile(
      join(templateDir(), 'project.md'),
      '---\nnote: 模板自己的 frontmatter 会被忽略\n---\n\n## 目标\n\n北极星\n\n## 里程碑\n',
    )
    const { path } = await createEntity(kbRoot, 'project', 'dsh 学习')
    const content = await read(path)
    expect(content).toContain('## 里程碑\n')
    expect(content).not.toContain('note:')
    expect(content).toMatch(/^---\ntype: project\n/)
    // 流水 is appended mechanically at the end, with the creation bullet inside.
    expect(content.trimEnd().endsWith(`## 流水\n\n- ${TODAY} 创建 dsh 学习`)).toBe(true)
    expect(content.indexOf('## 流水')).toBeGreaterThan(content.indexOf('## 里程碑'))
  })

  it('appends the creation bullet at the end of a template-provided 流水 section', async () => {
    await mkdir(templateDir(), { recursive: true })
    await writeFile(join(templateDir(), 'area.md'), '## 标准\n\n\n## 流水\n\n- 预置条目\n')
    const { path } = await createEntity(kbRoot, 'area', '健康')
    const content = await read(path)
    expect(content).toContain('## 流水\n\n- 预置条目\n')
    expect(content).toContain(`- 预置条目\n- ${TODAY} 创建 健康\n`)
  })

  it('keeps 状态 absent when the template omits it, and kb_write_state then errors', async () => {
    await mkdir(templateDir(), { recursive: true })
    await writeFile(join(templateDir(), 'person.md'), '## 相识\n\n如何认识、现状如何\n')
    const { path } = await createEntity(kbRoot, 'person', '张三')
    const content = await read(path)
    expect(content).not.toContain('## 状态')
    expect(content).toContain('## 流水')
    await expect(writeState(kbRoot, 'person:张三', 'x')).rejects.toThrow(/缺少『## 状态』锚点/)
  })

  it('falls back to the built-in template when the 流水 anchor repeats, with a notice', async () => {
    await mkdir(templateDir(), { recursive: true })
    await writeFile(join(templateDir(), 'project.md'), '## 流水\n\n- 甲\n\n## 目标\n\n\n## 流水\n\n- 乙\n')
    const result = await createEntity(kbRoot, 'project', 'dsh 学习')
    expect(result.notice).toContain('已回落内置模板')
    expect(await read('entities/projects/dsh 学习.md')).toBe(entityFileContent('project', 'dsh 学习', TODAY))
  })

  it('leaves entities without a template file on the built-in skeletons', async () => {
    const { path } = await createEntity(kbRoot, 'project', '内置')
    expect(await read(path)).toBe(entityFileContent('project', '内置', TODAY))
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
    expect(() => appendToLogSection(broken, ['- x y'], 'demo.md')).toThrow(KbError)
    expect(() => appendToLogSection(broken, ['- x y'], 'demo.md')).toThrow(/缺少『## 流水』锚点/)
  })

  it('throws ambiguous-log-anchor on duplicated anchors', () => {
    const doubled = `${base}\n## 流水\n`
    expect(() => appendToLogSection(doubled, ['- x y'], 'demo.md')).toThrow(/2 个『## 流水』锚点/)
  })

  it('rejects an empty insert', () => {
    expect(() => appendToLogSection(base, [], 'demo.md')).toThrow(/追加内容为空/)
  })
})

describe('replaceStateSection', () => {
  const base = entityFileContent('project', 'demo', '2026-09-05')
  const logTail = '\n## 流水\n\n- 2026-09-05 创建 demo\n'

  it('fills the empty State section and preserves every other byte', () => {
    const next = replaceStateSection(base, '进行中：等待评审', 'demo.md')
    expect(next).toBe(
      '---\ntype: project\nareas: []\ntags: []\ncreated: 2026-09-05\n---\n\n## 目标\n\n\n## 下一步\n\n\n## 状态\n\n进行中：等待评审\n' + logTail,
    )
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
    expect(() => replaceStateSection(broken, 'x', 'demo.md')).toThrow(/缺少『## 状态』锚点/)
  })

  it('throws ambiguous-state-anchor on duplicated anchors', () => {
    const doubled = base.replace('## 状态\n', '## 状态\n\n## 状态\n')
    expect(() => replaceStateSection(doubled, 'x', 'demo.md')).toThrow(/2 个『## 状态』锚点/)
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
    await expect(createEntity(kbRoot, 'project', 'dsh 学习')).rejects.toThrow(/已存在/)
    expect(await read('entities/projects/dsh 学习.md')).toBe(entityFileContent('project', 'dsh 学习', TODAY))
  })

  it('sanitizes unsafe names into the file name', async () => {
    const { path } = await createEntity(kbRoot, 'area', '工作/生活')
    expect(path).toBe('entities/areas/工作_生活.md')
  })

  it('files a meeting under its own date, keeping the frontmatter name clean', async () => {
    const { path } = await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-09' })
    expect(path).toBe('entities/meetings/2026-09-09 周会.md')
    expect(await read(path)).toBe(entityFileContent('meeting', '周会', TODAY, { meetingDate: '2026-09-09' }))
    const content = await read(path)
    expect(content).toContain('title: 周会\n')
    expect(content).toContain(`- ${TODAY} 创建 周会\n`)
  })

  it('files a meeting without a date under today, and refuses a second one that day', async () => {
    const { path } = await createEntity(kbRoot, 'meeting', '周会')
    expect(path).toBe(`entities/meetings/${TODAY} 周会.md`)
    expect(await read(path)).toContain(`date: ${TODAY}\ntitle: 周会\n`)
    await expect(createEntity(kbRoot, 'meeting', '周会')).rejects.toThrow(/已存在/)
  })

  it('refuses to create the todo singleton', async () => {
    await expect(createEntity(kbRoot, 'todo', 'todos')).rejects.toThrow(/单例实体/)
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
    await writeState(kbRoot, `entities/meetings/${TODAY} 周会.md`, '已改期')
    expect(await read(`entities/meetings/${TODAY} 周会.md`)).toContain('## 状态\n\n已改期\n')
    await initKb(kbRoot)
    await expect(writeState(kbRoot, 'todo:todos', 'x')).rejects.toThrow(/缺少『## 状态』锚点/)
  })

  it('rejects locators escaping the KB root', async () => {
    await expect(writeState(kbRoot, '../outside.md', 'x')).rejects.toThrow(/越出了知识库根目录/)
  })

  it('finds a dated meeting file from its bare name', async () => {
    await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-09' })
    const result = await writeState(kbRoot, 'meeting:周会', '已确认')
    expect(result.path).toBe('entities/meetings/2026-09-09 周会.md')
    expect(await read('entities/meetings/2026-09-09 周会.md')).toContain('## 状态\n\n已确认\n')
  })

  it('still resolves a meeting whose locator carries the date prefix', async () => {
    await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-09' })
    await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-16' })
    const result = await writeState(kbRoot, 'meetings:2026-09-16 周会', '第二周')
    expect(result.path).toBe('entities/meetings/2026-09-16 周会.md')
  })

  it('refuses an ambiguous meeting name instead of guessing', async () => {
    await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-09' })
    await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-16' })
    await expect(writeState(kbRoot, 'meeting:周会', 'x')).rejects.toThrow(/匹配到多个会议文件/)
  })

  it('reports a missing meeting as not found', async () => {
    await expect(writeState(kbRoot, 'meeting:周会', 'x')).rejects.toThrow(/找不到实体文件/)
  })

  it('errors on a missing entity with a not-found message', async () => {
    await expect(writeState(kbRoot, 'project:不存在', 'x')).rejects.toThrow(/找不到实体文件/)
  })
})

describe('replaceSection', () => {
  const base = entityFileContent('project', 'demo', '2026-09-05')

  it('replaces an arbitrary section and preserves every other byte', () => {
    const next = replaceSection(base, '目标', '吃透 cordis 的组装链', 'demo.md')
    expect(next).toBe(base.replace('## 目标\n\n\n## 下一步', '## 目标\n\n吃透 cordis 的组装链\n\n## 下一步'))
  })

  it('accepts the ## heading spelling and matches metacharacters literally', () => {
    expect(replaceSection(base, '## 目标', 'x', 'demo.md')).toBe(base.replace('## 目标\n\n\n## 下一步', '## 目标\n\nx\n\n## 下一步'))
    const tricky = base.replace('## 目标', '## 目标 (v2)')
    expect(replaceSection(tricky, '目标 (v2)', 'y', 'demo.md')).toBe(tricky.replace('## 目标 (v2)\n\n\n## 下一步', '## 目标 (v2)\n\ny\n\n## 下一步'))
  })

  it('refuses the 流水 section outright', () => {
    expect(() => replaceSection(base, '流水', 'x', 'demo.md')).toThrow(/只追加、不改写/)
  })

  it('rejects an empty heading', () => {
    expect(() => replaceSection(base, '  ', 'x', 'demo.md')).toThrow(/区段锚点为空/)
  })
})

describe('kb_edit_section', () => {
  it('rewrites an arbitrary section and preserves every other byte', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    const before = await read('entities/projects/dsh 学习.md')
    const result = await editSection(kbRoot, 'project:dsh 学习', '下一步', '接入 kb_edit_section')
    expect(result.path).toBe('entities/projects/dsh 学习.md')
    expect(result.section).toBe('下一步')
    const after = await read('entities/projects/dsh 学习.md')
    expect(after).toBe(before.replace('## 下一步\n\n\n## 状态', '## 下一步\n\n接入 kb_edit_section\n\n## 状态'))
  })

  it('accepts plural spellings, path locators and ## heading spellings', async () => {
    await createEntity(kbRoot, 'area', '健康')
    await editSection(kbRoot, 'areas:健康', '标准', '每周三次运动')
    await editSection(kbRoot, 'entities/areas/健康.md', '## 检视', '周日晚检视')
    const after = await read('entities/areas/健康.md')
    expect(after).toContain('## 标准\n\n每周三次运动\n')
    expect(after).toContain('## 检视\n\n周日晚检视\n')
  })

  it('refuses the 流水 section and leaves the file unchanged', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    const before = await read('entities/projects/dsh 学习.md')
    await expect(editSection(kbRoot, 'project:dsh 学习', '流水', 'x')).rejects.toThrow(/只追加、不改写/)
    expect(await read('entities/projects/dsh 学习.md')).toBe(before)
  })

  it('errors on a missing anchor without modifying the file', async () => {
    await createEntity(kbRoot, 'project', 'broken')
    const target = join(kbRoot, 'entities/projects/broken.md')
    const broken = (await read('entities/projects/broken.md')).replace('## 目标\n', '## 愿景\n')
    await writeFile(target, broken)
    await expect(editSection(kbRoot, 'project:broken', '目标', 'x')).rejects.toThrow(/缺少『## 目标』锚点/)
    expect(await read('entities/projects/broken.md')).toBe(broken)
  })

  it('refuses the todo singleton explicitly', async () => {
    await initKb(kbRoot)
    await expect(editSection(kbRoot, 'todo:todos', '状态', 'x')).rejects.toThrow(/单例文件/)
  })

  it('errors on malformed frontmatter without modifying the file', async () => {
    await createEntity(kbRoot, 'project', 'bad')
    const target = join(kbRoot, 'entities/projects/bad.md')
    const malformed = (await read('entities/projects/bad.md')).replace('type: project', 'type: [unclosed')
    await writeFile(target, malformed)
    await expect(editSection(kbRoot, 'project:bad', '目标', 'x')).rejects.toThrow(/frontmatter/)
    expect(await read('entities/projects/bad.md')).toBe(malformed)
  })

  it('empties the section when the text is blank', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    await editSection(kbRoot, 'project:dsh 学习', '目标', '先写一版')
    await editSection(kbRoot, 'project:dsh 学习', '目标', '  \n\n')
    const after = await read('entities/projects/dsh 学习.md')
    expect(after).toContain('## 目标\n\n\n## 下一步')
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
    await expect(appendLog(kbRoot, '../outside.md', 'x')).rejects.toThrow(/越出了知识库根目录/)
  })

  it('errors on a missing 流水 anchor without modifying the file', async () => {
    await createEntity(kbRoot, 'project', 'broken')
    const target = join(kbRoot, 'entities/projects/broken.md')
    const broken = (await read('entities/projects/broken.md')).replace('## 流水\n', '## 日志\n')
    await writeFile(target, broken)
    await expect(appendLog(kbRoot, 'project:broken', 'x')).rejects.toThrow(/缺少『## 流水』锚点/)
    expect(await read('entities/projects/broken.md')).toBe(broken)
  })

  it('errors on malformed frontmatter without modifying the file', async () => {
    await createEntity(kbRoot, 'project', 'bad')
    const target = join(kbRoot, 'entities/projects/bad.md')
    const malformed = (await read('entities/projects/bad.md')).replace('type: project', 'type: [unclosed')
    await writeFile(target, malformed)
    await expect(appendLog(kbRoot, 'project:bad', 'x')).rejects.toThrow(/frontmatter/)
    expect(await read('entities/projects/bad.md')).toBe(malformed)
  })

  it('errors on a missing entity with a not-found message', async () => {
    await expect(appendLog(kbRoot, 'project:不存在', 'x')).rejects.toThrow(/找不到实体文件/)
  })
})

describe('kb_read_entity', () => {
  it('returns the complete file content', async () => {
    await createEntity(kbRoot, 'area', '健康')
    const result = await readEntity(kbRoot, 'area', '健康')
    expect(result.path).toBe('entities/areas/健康.md')
    expect(result.content).toBe(entityFileContent('area', '健康', TODAY))
  })

  it('finds a dated meeting by its bare name, title still clean', async () => {
    await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-09' })
    const result = await readEntity(kbRoot, 'meeting', '周会')
    expect(result.path).toBe('entities/meetings/2026-09-09 周会.md')
    expect(result.content).toContain('title: 周会\n')
  })

  it('refuses an ambiguous meeting name', async () => {
    await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-09' })
    await createEntity(kbRoot, 'meeting', '周会', { meetingDate: '2026-09-16' })
    await expect(readEntity(kbRoot, 'meeting', '周会')).rejects.toThrow(/匹配到多个会议文件/)
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
    expect(rows).toContain(`meeting:${TODAY} 周会`)
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
  it('copies the file and writes no shadow note', async () => {
    const source = join(kbRoot, '周报.eml')
    await writeFile(source, 'raw mail bytes')
    const result = await registerResource(kbRoot, source)
    expect(result.resource).toBe('resources/周报.eml')
    expect(await read('resources/周报.eml')).toBe('raw mail bytes')
    expect(existsSync(join(kbRoot, 'resources/周报.eml.md'))).toBe(false)
  })

  it('refuses to overwrite an already-registered resource', async () => {
    const source = join(kbRoot, '周报.eml')
    await writeFile(source, 'v1')
    await mkdir(join(kbRoot, 'inbox'), { recursive: true })
    const second = join(kbRoot, 'inbox/周报.eml')
    await writeFile(second, 'v2')
    await registerResource(kbRoot, source)
    await expect(registerResource(kbRoot, second)).rejects.toThrow(/已登记过/)
    expect(await read('resources/周报.eml')).toBe('v1')
  })

  it('errors on a missing source file', async () => {
    await expect(registerResource(kbRoot, join(kbRoot, '不存在.pdf'))).rejects.toThrow(/找不到要登记的文件/)
  })
})

describe('registerResourceContent', () => {
  it('writes the bytes under the sanitized name', async () => {
    const result = await registerResourceContent(kbRoot, '三体.epub', new Uint8Array([1, 2, 3]))
    expect(result.resource).toBe('resources/三体.epub')
    expect(await readFile(join(kbRoot, 'resources/三体.epub'))).toEqual(Buffer.from([1, 2, 3]))
  })

  it('sanitizes hostile names and refuses overwrites', async () => {
    await registerResourceContent(kbRoot, 'a/b.txt', new Uint8Array([1]))
    await expect(registerResourceContent(kbRoot, 'a/b.txt', new Uint8Array([4])))
      .rejects.toThrow(/已登记过/)
    expect(existsSync(join(kbRoot, 'resources/a_b.txt'))).toBe(true)
  })
})

describe('kb_write_resource', () => {
  it('creates a new text file under resources/, including new subdirectories', async () => {
    const result = await writeResource(kbRoot, 'resources/报告/2026-09/周报.md', '# 周报\n\n本周接入 kb_write_resource。')
    expect(result.resource).toBe('resources/报告/2026-09/周报.md')
    expect(await read('resources/报告/2026-09/周报.md')).toBe('# 周报\n\n本周接入 kb_write_resource。')
  })

  it('refuses an existing target and leaves its content untouched', async () => {
    await writeResource(kbRoot, 'resources/笔记.md', '第一版')
    await expect(writeResource(kbRoot, 'resources/笔记.md', '第二版')).rejects.toThrow(/不覆盖/)
    expect(await read('resources/笔记.md')).toBe('第一版')
  })

  it('refuses targets outside the resources plane', async () => {
    await expect(writeResource(kbRoot, 'entities/projects/x.md', 'x')).rejects.toThrow(/必须在 resources\/ 下/)
    await expect(writeResource(kbRoot, 'notes.md', 'x')).rejects.toThrow(/必须在 resources\/ 下/)
    await expect(writeResource(kbRoot, 'resources/', 'x')).rejects.toThrow(/资源名不能为空/)
  })

  it('refuses relative directory segments outright', async () => {
    await expect(writeResource(kbRoot, 'resources/../secrets.md', 'x')).rejects.toThrow(/不合法/)
    await expect(writeResource(kbRoot, 'resources/a/./b.md', 'x')).rejects.toThrow(/不合法/)
    expect(existsSync(join(kbRoot, 'secrets.md'))).toBe(false)
  })

  it('sanitizes hostile path segments', async () => {
    const result = await writeResource(kbRoot, 'resources/a<b>/周报?.md', 'x')
    expect(result.resource).toBe('resources/a_b_/周报_.md')
    expect(await read('resources/a_b_/周报_.md')).toBe('x')
  })
})

describe('kb_read_resource', () => {
  it('reads a file back as its UTF-8 full text', async () => {
    await writeResource(kbRoot, 'resources/报告/周报.md', '# 周报\n\n正文。')
    expect(await readResource(kbRoot, 'resources/报告/周报.md'))
      .toEqual({ kind: 'file', path: 'resources/报告/周报.md', content: '# 周报\n\n正文。' })
  })

  it('refuses a binary file and reports its size', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', '照片.png'), new Uint8Array([0x50, 0x4b, 0x00, 0x03]))
    await expect(readResource(kbRoot, 'resources/照片.png')).rejects.toThrow(/二进制文件（4 字节）/)
  })

  it('lists a directory recursively with byte sizes, relative to the listed directory', async () => {
    await writeResource(kbRoot, 'resources/报告/2026-09/周报.md', '本周')
    await writeResource(kbRoot, 'resources/报告/笔记.md', '笔记')
    expect(await readResource(kbRoot, 'resources/报告')).toEqual({
      kind: 'dir',
      path: 'resources/报告',
      entries: [
        { path: '2026-09/周报.md', size: 6 },
        { path: '笔记.md', size: 6 },
      ],
    })
  })

  it('caps a listing at one hundred entries and marks it truncated', async () => {
    for (let index = 0; index < 101; index++) {
      await writeResource(kbRoot, `resources/many/f${String(index).padStart(3, '0')}.txt`, 'x')
    }
    const listed = await readResource(kbRoot, 'resources/many')
    if (listed.kind !== 'dir') throw new Error('预期目录清单')
    expect(listed.entries).toHaveLength(100)
    expect(listed.truncated).toBe(true)
  })

  it('refuses paths outside the resources plane and empty names', async () => {
    await expect(readResource(kbRoot, 'entities/projects/dsh 学习.md')).rejects.toThrow(/只能读取 resources\/ 下/)
    await expect(readResource(kbRoot, 'notes.md')).rejects.toThrow(/只能读取 resources\/ 下/)
    await expect(readResource(kbRoot, 'resources/')).rejects.toThrow(/资源路径不能为空/)
    await expect(readResource(kbRoot, 'resources/../secrets.md')).rejects.toThrow(/不合法/)
    await expect(readResource(kbRoot, 'resources/a/./b.md')).rejects.toThrow(/不合法/)
  })

  it('refuses a path that does not exist, pointing at the directory form', async () => {
    await expect(readResource(kbRoot, 'resources/不存在.md')).rejects.toThrow(/找不到资源/)
  })
})
