import { describe, expect, it, vi } from 'vitest'
import type { KbTodosResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { Proposal } from '../src/client/proposal.ts'
import type { ProposalTarget } from '../src/client/proposal-apply.ts'
import { applyProposal, insertIntoSection } from '../src/client/proposal-apply.ts'

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
