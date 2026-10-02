import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLog, createEntity, editSection, initKb, setEntityArchived, writeState } from '../src/core.ts'
import { linksOf, linkGraphOf } from '../src/links.ts'
import { todayStamp } from '../src/paths.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-archive-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

const TODAY = todayStamp()

async function read(path: string): Promise<string> {
  return readFile(join(kbRoot, path), 'utf8')
}

/** The canonical project file createEntity writes today. */
function projectFile(name: string, extraFrontmatter = '', extraLog = ''): string {
  return '---\n'
    + 'type: project\n'
    + 'areas: []\n'
    + 'tags: []\n'
    + `created: ${TODAY}\n`
    + extraFrontmatter
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
    + `- ${TODAY} 创建 ${name}\n`
    + extraLog
}

describe('archive write gate (ADR-0041 决定 5)', () => {
  beforeEach(async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    await setEntityArchived(kbRoot, 'project:dsh 学习', true)
  })

  it('kb_append_log refuses an archived entity', async () => {
    await expect(appendLog(kbRoot, 'project:dsh 学习', '一行')).rejects.toMatchObject({
      code: 'entity-archived',
      message: '实体已归档，请先还原',
    })
  })

  it('kb_write_state refuses an archived entity', async () => {
    await expect(writeState(kbRoot, 'project:dsh 学习', '进行中')).rejects.toMatchObject({
      code: 'entity-archived',
      message: '实体已归档，请先还原',
    })
  })

  it('kb_edit_section refuses an archived entity', async () => {
    await expect(editSection(kbRoot, 'project:dsh 学习', '目标', '学会')).rejects.toMatchObject({
      code: 'entity-archived',
      message: '实体已归档，请先还原',
    })
  })

  it('a refused write leaves the file untouched', async () => {
    const before = await read('entities/projects/dsh 学习.md')
    await expect(writeState(kbRoot, 'project:dsh 学习', '进行中')).rejects.toMatchObject({ code: 'entity-archived' })
    expect(await read('entities/projects/dsh 学习.md')).toBe(before)
  })

  it('the write gate lifts once the entity is restored', async () => {
    await setEntityArchived(kbRoot, 'project:dsh 学习', false)
    await expect(writeState(kbRoot, 'project:dsh 学习', '进行中')).resolves.toMatchObject({
      path: 'entities/projects/dsh 学习.md',
    })
  })
})

describe('setEntityArchived (ADR-0041 决定 6/10)', () => {
  it('archives: sets archive: true, appends one dated 归档 bullet, keeps every other byte', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    const result = await setEntityArchived(kbRoot, 'project:dsh 学习', true)
    expect(result).toEqual({ path: 'entities/projects/dsh 学习.md', archived: true })
    expect(await read('entities/projects/dsh 学习.md')).toBe(
      projectFile('dsh 学习', 'archive: true\n', `- ${TODAY} 归档\n`),
    )
  })

  it('restores: removes the key (never archive: false) and appends one dated 还原 bullet', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    await setEntityArchived(kbRoot, 'project:dsh 学习', true)
    const result = await setEntityArchived(kbRoot, 'project:dsh 学习', false)
    expect(result).toEqual({ path: 'entities/projects/dsh 学习.md', archived: false })
    const content = await read('entities/projects/dsh 学习.md')
    expect(content).toBe(projectFile('dsh 学习', '', `- ${TODAY} 归档\n- ${TODAY} 还原\n`))
    expect(content).not.toContain('archive:')
  })

  it('is idempotent: re-archiving an archived entity writes nothing, log included', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    await setEntityArchived(kbRoot, 'project:dsh 学习', true)
    const before = await read('entities/projects/dsh 学习.md')
    const again = await setEntityArchived(kbRoot, 'project:dsh 学习', true)
    expect(again).toEqual({ path: 'entities/projects/dsh 学习.md', archived: true })
    expect(await read('entities/projects/dsh 学习.md')).toBe(before)
  })

  it('is idempotent: restoring an active entity writes nothing, log included', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    const before = await read('entities/projects/dsh 学习.md')
    const result = await setEntityArchived(kbRoot, 'project:dsh 学习', false)
    expect(result).toEqual({ path: 'entities/projects/dsh 学习.md', archived: false })
    expect(await read('entities/projects/dsh 学习.md')).toBe(before)
  })

  it('locates the entity by path as well as by type:name', async () => {
    await createEntity(kbRoot, 'person', '张三')
    const result = await setEntityArchived(kbRoot, 'entities/people/张三.md', true)
    expect(result).toEqual({ path: 'entities/people/张三.md', archived: true })
    const content = await read('entities/people/张三.md')
    expect(content).toContain(`created: ${TODAY}\narchive: true\n---\n`)
    expect(content).toContain('relation: subordinate\n')
  })

  it('refuses the todo singleton (ADR-0041 决定 2)', async () => {
    await initKb(kbRoot)
    await expect(setEntityArchived(kbRoot, 'todo:todos', true)).rejects.toMatchObject({ code: 'singleton-entity' })
  })

  it('refuses a file carrying two archive: lines — the flag is ambiguous (malformed-frontmatter)', async () => {
    await createEntity(kbRoot, 'project', 'dsh 学习')
    await setEntityArchived(kbRoot, 'project:dsh 学习', true)
    const target = join(kbRoot, 'entities/projects/dsh 学习.md')
    // A hand-edited file with a stray second key: js-yaml refuses duplicated
    // mapping keys at parse time, and the line-splice guard refuses any
    // duplicate that ever slips past a parser — either way the ambiguous
    // flag is never silently resolved to "first" or "last".
    await writeFile(target, (await readFile(target, 'utf8')).replace('---\n\n## 目标', 'archive: true\n---\n\n## 目标'), 'utf8')
    await expect(setEntityArchived(kbRoot, 'project:dsh 学习', false)).rejects.toMatchObject({
      code: 'malformed-frontmatter',
    })
  })
})

describe('linkGraphOf archive filter (ADR-0041 决定 3)', () => {
  beforeEach(async () => {
    await createEntity(kbRoot, 'project', '甲')
    await createEntity(kbRoot, 'project', '乙')
    await createEntity(kbRoot, 'person', '张三')
    await writeState(kbRoot, 'project:甲', '依赖 [[乙]] 与 [[张三]]')
    await writeState(kbRoot, 'person:张三', '参与 [[甲]]')
  })

  it('drops the archived node together with every edge touching it', async () => {
    const before = await linkGraphOf(kbRoot)
    expect(before.nodes).toEqual(['entities/projects/乙.md', 'entities/projects/甲.md', 'entities/people/张三.md'])
    expect(before.edges).toEqual([
      { from: 'entities/projects/甲.md', target: '乙', to: 'entities/projects/乙.md' },
      { from: 'entities/projects/甲.md', target: '张三', to: 'entities/people/张三.md' },
      { from: 'entities/people/张三.md', target: '甲', to: 'entities/projects/甲.md' },
    ])
    await setEntityArchived(kbRoot, 'person:张三', true)
    const after = await linkGraphOf(kbRoot)
    expect(after.nodes).toEqual(['entities/projects/乙.md', 'entities/projects/甲.md'])
    expect(after.edges).toEqual([
      { from: 'entities/projects/甲.md', target: '乙', to: 'entities/projects/乙.md' },
    ])
  })
})

describe('linksOf keeps resolving archived targets (ADR-0041 决定 3)', () => {
  it('a link pointing at an archived entity still resolves in the reading view', async () => {
    await createEntity(kbRoot, 'project', '甲')
    await createEntity(kbRoot, 'person', '张三')
    await writeState(kbRoot, 'project:甲', '对接 [[张三]]')
    await setEntityArchived(kbRoot, 'person:张三', true)
    const links = await linksOf(kbRoot, 'entities/projects/甲.md')
    expect(links.outgoing).toEqual([{ target: '张三', path: 'entities/people/张三.md' }])
  })
})
