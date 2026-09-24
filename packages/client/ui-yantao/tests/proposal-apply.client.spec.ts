import { describe, expect, it, vi } from 'vitest'
import type { KbTodosResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { Proposal } from '../src/client/proposal.ts'
import type { ProposalTarget } from '../src/client/proposal-apply.ts'
import { applyProposal, insertIntoSection, replaceSection } from '../src/client/proposal-apply.ts'

const TODOS_PATH = 'entities/todos.md'
const TEXT = '- [ ] 已有的待办\n'

/** The KB seams, with spies standing in for every write; cast to a mock where a call list is read. */
function target(overrides: Partial<ProposalTarget> = {}): ProposalTarget {
  const todos: KbTodosResult = {
    path: TODOS_PATH,
    text: TEXT,
    items: [{ done: false, title: '已有的待办', body: '', extra: [] }],
  }
  return {
    createEntity: vi.fn(async () => 'entities/people/张三.md'),
    read: vi.fn(async () => '# 张三\n\n## 状态\n\n\n## 流水\n\n- 2026-01-01 创建\n'),
    write: vi.fn(async () => {}),
    todos: vi.fn(async () => todos),
    writeTodos: vi.fn(async () => ({ path: TODOS_PATH, text: TEXT })),
    memoryAdd: vi.fn(async (scope: string, text: string) => ({ path: `.dsh/yantao/memory/${scope}.md`, entry: { id: 'm1', text } })),
    ...overrides,
  }
}

describe('applyProposal', () => {
  it('creates an entity through the create seam', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'create-entity', entityType: 'person', name: '张三', reason: 'r' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.createEntity).toHaveBeenCalledWith('person', '张三', undefined)
    expect(result.written).toEqual(['实体 张三'])
    expect(result.skipped).toEqual([])
  })

  it('writes a person\'s e-mail address through the create seam', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'create-entity', entityType: 'person', name: '张三', reason: 'r', email: 'zhangsan@example.com' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.createEntity).toHaveBeenCalledWith('person', '张三', undefined, 'zhangsan@example.com')
    expect(result.written).toEqual(['实体 张三'])
  })

  it('hands a person action\'s relation to the create seam instead of the template default', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'create-entity', entityType: 'person', name: '张三', reason: 'r', relation: 'superior' }],
    }
    await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.createEntity).toHaveBeenCalledWith('person', '张三', 'superior')
  })

  it('appends a dated bullet to the 流水 and never rewrites it', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{
        kind: 'append-log', entityPath: 'entities/projects/飞书迁移.md', entityName: '飞书迁移', text: '确认了时间', reason: 'r',
      }],
    }
    await applyProposal({ proposal, ticked: [0], target: t })
    const [path, content] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(path).toBe('entities/projects/飞书迁移.md')
    expect(content).toContain('- 2026-01-01 创建')
    expect(content).toMatch(/- \d{4}-\d{2}-\d{2} 确认了时间/)
  })

  it('writes a state line into the 状态 section', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{
        kind: 'write-state', entityPath: 'entities/people/张三.md', entityName: '张三', text: '合作中', reason: 'r',
      }],
    }
    await applyProposal({ proposal, ticked: [0], target: t })
    const [, content] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(content).toContain('## 状态')
    expect(content).toContain('合作中')
  })

  it('falls back to the end of the file when the 状态 section is gone', () => {
    const content = '# 张三\n\n## 流水\n\n- 2026-01-01 创建\n'
    const next = insertIntoSection(content, '## 状态', '合作中')
    expect(next).toContain('合作中')
    expect(next.lastIndexOf('合作中')).toBeGreaterThan(next.indexOf('## 流水'))
  })

  it('writes a resource note under resources/', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'save-resource', path: 'resources/汇报模板.md', content: '---\n---\n', reason: 'r' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.write).toHaveBeenCalledWith('resources/汇报模板.md', '---\n---\n')
    expect(result.written).toEqual(['资源 resources/汇报模板.md'])
  })

  it('skips a resource whose name sanitises to nothing', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'save-resource', path: 'resources/.md', content: 'x', reason: '？？？' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.write).not.toHaveBeenCalled()
    expect(result.skipped).toEqual(['资源「？？？」：名字不能作为文件名'])
  })

  it('writes a link into the 状态 section', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{
        kind: 'create-link', entityPath: 'entities/projects/读书-《三体》.md', entityName: '读书-《三体》',
        link: '[[领域:科幻]]', reason: 'r',
      }],
    }
    await applyProposal({ proposal, ticked: [0], target: t })
    const [, content] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(content).toContain('[[领域:科幻]]')
  })

  it('skips an entity action whose path could not be resolved', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'append-log', entityPath: '', entityName: '不存在的项目', text: 'x', reason: 'r' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.read).not.toHaveBeenCalled()
    expect(result.skipped).toEqual(['实体 不存在的项目：知识库里没有这个实体'])
  })

  it('batches every ticked todo into one optimistic-concurrency write', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [
        { kind: 'add-todo', title: '发汇报', due: '2026-09-20', body: '给张三', reason: '给张三' },
        { kind: 'add-todo', title: '回邮件', body: '', reason: '' },
      ],
    }
    const result = await applyProposal({ proposal, ticked: [0, 1], target: t })
    expect(t.todos).toHaveBeenCalledTimes(1)
    expect(t.writeTodos).toHaveBeenCalledTimes(1)
    const args = (t.writeTodos as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      expectedText: string
      items: readonly { title: string; due?: string }[]
    }
    expect(args.expectedText).toBe(TEXT)
    expect(args.items.map(item => item.title)).toEqual(['已有的待办', '发汇报', '回邮件'])
    expect(args.items[1]?.due).toBe('2026-09-20')
    expect(result.written).toEqual(['待办 2 条（entities/todos.md）'])
  })

  it('records a memory through the memoryAdd seam (ADR-0032)', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'add-memory', scope: 'mail', text: '汇报先发给直属上级', reason: '上级主送' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.memoryAdd).toHaveBeenCalledWith('mail', '汇报先发给直属上级')
    expect(result.written).toEqual(['记忆（mail）汇报先发给直属上级'])
    expect(result.skipped).toEqual([])
  })

  it('treats an exact-duplicate memory as already known, not as a failure', async () => {
    const t = target({ memoryAdd: vi.fn(async () => { throw new Error('这条记忆已经存在（作用域 mail）：汇报先发给直属上级') }) })
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'add-memory', scope: 'mail', text: '汇报先发给直属上级', reason: '上级主送' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(result.written).toEqual([])
    expect(result.skipped).toEqual(['记忆（mail）汇报先发给直属上级：已记得，无需重记'])
  })

  it('runs the ticked actions in index order, not kind order', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [
        { kind: 'create-entity', entityType: 'area', name: '科幻', reason: 'r' },
        { kind: 'save-resource', path: 'resources/a.md', content: 'a', reason: 'r' },
      ],
    }
    await applyProposal({ proposal, ticked: [1, 0], target: t })
    const writeOrder = (t.write as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] as number
    const createOrder = (t.createEntity as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] as number
    expect(writeOrder).toBeLessThan(createOrder)
  })
})

describe('create-follows-create (ADR-0030)', () => {
  it('lands a create\'s own edits in the freshly created entity', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [
        { kind: 'create-entity', entityType: 'project', name: '邮箱迁移', reason: 'r' },
        { kind: 'edit-section', path: '', afterCreate: '邮箱迁移', section: '目标', before: '', after: '迁完', why: 'w' },
        { kind: 'append-log', entityPath: '', entityName: '邮箱迁移', afterCreate: '邮箱迁移', text: '新建', reason: 'r' },
      ],
    }
    const result = await applyProposal({ proposal, ticked: [0, 1, 2], target: t })
    expect(t.createEntity).toHaveBeenCalledWith('project', '邮箱迁移', undefined)
    const editCall = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(editCall[0]).toBe('entities/people/张三.md') // the path the create seam resolved
    expect(editCall[1]).toContain('迁完')
    const logCall = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [string, string]
    expect(logCall[0]).toBe('entities/people/张三.md')
    expect(logCall[1]).toMatch(/- \d{4}-\d{2}-\d{2} 新建/)
    expect(result.skipped).toEqual([])
  })

  it('skips a follower when its create was not ticked', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [
        { kind: 'create-entity', entityType: 'project', name: '邮箱迁移', reason: 'r' },
        { kind: 'edit-section', path: '', afterCreate: '邮箱迁移', section: '目标', before: '', after: '迁完', why: 'w' },
      ],
    }
    const result = await applyProposal({ proposal, ticked: [1], target: t })
    expect(t.createEntity).not.toHaveBeenCalled()
    expect(t.read).not.toHaveBeenCalled()
    expect(result.skipped).toEqual(['章节 目标（邮箱迁移）：前置的新建「邮箱迁移」没有落地'])
  })

  it('skips a follower when its create failed, and still lands the rest', async () => {
    const t = target({ createEntity: vi.fn(async () => { throw new Error('已存在') }) })
    const proposal: Proposal = {
      title: 't',
      actions: [
        { kind: 'create-entity', entityType: 'project', name: '邮箱迁移', reason: 'r' },
        { kind: 'edit-section', path: '', afterCreate: '邮箱迁移', section: '目标', before: '', after: '迁完', why: 'w' },
        { kind: 'save-resource', path: 'resources/note.md', content: 'n', reason: 'r' },
      ],
    }
    const result = await applyProposal({ proposal, ticked: [0, 1, 2], target: t })
    expect(result.skipped).toHaveLength(2)
    expect(result.written).toEqual(['资源 resources/note.md'])
  })

  it('resolves a create-linked backlink into the new entity', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [
        { kind: 'create-entity', entityType: 'person', name: '李四', reason: 'r' },
        { kind: 'create-link', entityPath: '', entityName: '李四', afterCreate: '李四', link: '[[飞书迁移]]', reason: 'r' },
      ],
    }
    const result = await applyProposal({ proposal, ticked: [0, 1], target: t })
    expect(result.skipped).toEqual([])
    const [, content] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(content).toContain('[[飞书迁移]]')
  })
})

describe('create-project actions (ADR-0034 决定 4)', () => {
  // The project template guarantees an `areas: []` frontmatter line.
  const PROJECT_CONTENT = '---\nkind: project\nareas: []\n---\n\n# 机房搬迁\n\n## 状态\n\n\n## 流水\n\n- 2026-01-01 创建\n'

  it('creates the project and writes the suggested areas into the frontmatter', async () => {
    const t = target({ read: vi.fn(async () => PROJECT_CONTENT) })
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'create-project', name: '机房搬迁', reason: 'r', areas: ['基础设施'] }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.createEntity).toHaveBeenCalledWith('project', '机房搬迁')
    const [path, next] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(path).toBe('entities/people/张三.md') // the path the create seam resolved
    expect(next).toContain('areas: ["基础设施"]')
    expect(next).not.toContain('areas: []')
    expect(result.written).toEqual(['项目 机房搬迁'])
    expect(result.skipped).toEqual([])
  })

  it('lets the human\'s 领域勾选 override the model\'s suggestion', async () => {
    const t = target({ read: vi.fn(async () => PROJECT_CONTENT) })
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'create-project', name: '机房搬迁', reason: 'r', areas: ['模型建议'] }],
    }
    const result = await applyProposal({ proposal, ticked: [0], areaPicks: { 0: ['人工勾选'] }, target: t })
    const [, next] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(next).toContain('areas: ["人工勾选"]')
    expect(next).not.toContain('模型建议')
    expect(result.skipped).toEqual([])
  })

  it('touches no frontmatter when no areas are associated', async () => {
    const t = target()
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'create-project', name: '机房搬迁', reason: 'r' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.read).not.toHaveBeenCalled()
    expect(t.write).not.toHaveBeenCalled()
    expect(result.written).toEqual(['项目 机房搬迁'])
  })

  it('reports a file without the `areas: []` line, and still lands the project', async () => {
    const t = target({ read: vi.fn(async () => '---\nkind: project\n---\n\n# 机房搬迁\n') })
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'create-project', name: '机房搬迁', reason: 'r', areas: ['基础设施'] }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(result.written).toEqual(['项目 机房搬迁'])
    expect(result.skipped).toEqual(['项目 机房搬迁 的领域关联：frontmatter 里没有 areas: [] 可写'])
  })
})

describe('append-section actions (ADR-0034 决定 4)', () => {
  const MEETING = 'entities/meetings/周会.md'
  const CONTENT = '# 周会\n\n## 状态\n\n每周一\n\n## 决议\n\n- 旧决议\n\n## 待办\n\n\n## 流水\n\n- 2026-01-01 创建\n'
  // A project-shaped body for the afterCreate chain: the create seam resolves
  // to this path and the fresh file carries the section the follower fills.
  const FRESH_PROJECT = '---\nkind: project\nareas: []\n---\n\n# 机房搬迁\n\n## 目标\n\n\n## 流水\n\n- 2026-01-01 创建\n'

  function targetWith(content: string): ProposalTarget {
    return target({ read: vi.fn(async () => content) })
  }

  it('appends at the section\'s end and preserves what was there', async () => {
    const t = targetWith(CONTENT)
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'append-section', path: MEETING, section: '决议', text: '- 通过了预算', why: 'w' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.read).toHaveBeenCalledWith(MEETING)
    const [path, next] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(path).toBe(MEETING)
    expect(next).toContain('- 旧决议')
    expect(next).toContain('- 通过了预算')
    expect(next.indexOf('- 通过了预算')).toBeGreaterThan(next.indexOf('- 旧决议'))
    expect(next.indexOf('- 通过了预算')).toBeLessThan(next.indexOf('## 待办'))
    expect(result.written).toEqual([`章节 决议（${MEETING}）`])
    expect(result.skipped).toEqual([])
  })

  it('lands in the freshly created project through afterCreate', async () => {
    const t = targetWith(FRESH_PROJECT)
    const proposal: Proposal = {
      title: 't',
      actions: [
        { kind: 'create-project', name: '机房搬迁', reason: 'r' },
        { kind: 'append-section', path: '', afterCreate: '机房搬迁', section: '目标', text: '季度内完成', why: 'w' },
      ],
    }
    const result = await applyProposal({ proposal, ticked: [0, 1], target: t })
    expect(result.skipped).toEqual([])
    const [path, next] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(path).toBe('entities/people/张三.md')
    expect(next).toContain('季度内完成')
  })

  it('refuses a 流水 target: the append-only section has no UI bypass', async () => {
    const t = targetWith(CONTENT)
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'append-section', path: MEETING, section: '流水', text: 'x', why: 'w' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.read).not.toHaveBeenCalled()
    expect(t.write).not.toHaveBeenCalled()
    expect(result.skipped).toEqual([`章节 流水（${MEETING}）：流水只增不改`])
  })

  it('skips an action whose path could not be resolved', async () => {
    const t = targetWith(CONTENT)
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'append-section', path: '', section: '决议', text: 'x', why: 'w' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.read).not.toHaveBeenCalled()
    expect(result.skipped).toEqual(['章节 决议（）：知识库里没有这个实体'])
  })
})

describe('replaceSection', () => {
  it('replaces the section body and keeps the rest of the file', () => {
    const content = '# 张三\n\n## 状态\n\n旧内容\n\n## 流水\n\n- 2026-01-01 创建\n'
    const next = replaceSection(content, '## 状态', '新内容')
    expect(next).toContain('新内容')
    expect(next).not.toContain('旧内容')
    expect(next).toContain('## 流水')
    expect(next).toContain('- 2026-01-01 创建')
    expect(next.indexOf('新内容')).toBeLessThan(next.indexOf('## 流水'))
  })

  it('creates a section the file does not carry at the end of the file', () => {
    const content = '# 张三\n\n## 状态\n\n合作中\n'
    const next = replaceSection(content, '## 目标', '年内跑通')
    expect(next).toContain('## 目标')
    expect(next).toContain('年内跑通')
    expect(next.indexOf('## 目标')).toBeGreaterThan(next.indexOf('合作中'))
  })

  it('refuses a heading the file carries twice instead of picking one', () => {
    const content = '## 状态\n\n一\n\n## 状态\n\n二\n'
    expect(() => replaceSection(content, '## 状态', '三')).toThrow(/2 次/)
  })
})

describe('edit-section actions', () => {
  const ENTITY = 'entities/projects/飞书迁移.md'
  const CONTENT = '# 飞书迁移\n\n## 目标\n\n旧目标\n\n## 流水\n\n- 2026-01-01 创建\n'

  function targetWith(content: string): ProposalTarget {
    return target({ read: vi.fn(async () => content) })
  }

  it('replaces the section body in the freshly read file', async () => {
    const t = targetWith(CONTENT)
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'edit-section', path: ENTITY, section: '目标', before: '旧目标', after: '新目标', why: 'w' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.read).toHaveBeenCalledWith(ENTITY)
    const [path, next] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(path).toBe(ENTITY)
    expect(next).toContain('新目标')
    expect(next).not.toContain('旧目标')
    expect(result.written).toEqual([`章节 目标（${ENTITY}）`])
  })

  it('creates a missing section instead of failing the row', async () => {
    const t = targetWith('# 飞书迁移\n\n## 状态\n\n进行中\n')
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'edit-section', path: ENTITY, section: '下一步', before: '', after: '迁移邮箱', why: 'w' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(result.skipped).toEqual([])
    const [, next] = (t.write as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(next).toContain('## 下一步')
    expect(next).toContain('迁移')
  })

  it('refuses a 流水 target: the append-only section has no UI bypass', async () => {
    const t = targetWith(CONTENT)
    const proposal: Proposal = {
      title: 't',
      actions: [{ kind: 'edit-section', path: ENTITY, section: '流水', before: '', after: '改写', why: 'w' }],
    }
    const result = await applyProposal({ proposal, ticked: [0], target: t })
    expect(t.read).not.toHaveBeenCalled()
    expect(t.write).not.toHaveBeenCalled()
    expect(result.skipped).toEqual(['章节 流水（entities/projects/飞书迁移.md）：流水只增不改'])
  })

  it('marks one failed action red and still lands the rest', async () => {
    // The file carries the section twice — the one pathology replaceSection
    // refuses rather than guessing which body "the" section has.
    const t = targetWith('# 飞书迁移\n\n## 状态\n\n一\n\n## 状态\n\n二\n')
    const proposal: Proposal = {
      title: 't',
      actions: [
        { kind: 'edit-section', path: ENTITY, section: '状态', before: '', after: '三', why: 'w' },
        { kind: 'save-resource', path: 'resources/note.md', content: 'n', reason: 'r' },
      ],
    }
    const result = await applyProposal({ proposal, ticked: [0, 1], target: t })
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toContain('出现 2 次')
    expect(result.written).toEqual(['资源 resources/note.md'])
  })
})
