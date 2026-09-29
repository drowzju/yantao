import { describe, expect, it } from 'vitest'
import type { KbGraphResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { parseValidateVerdict, preScanOf, validatePrompt, verdictToValidateProposal } from '../src/client/validate.ts'

/** A graph builder: nodes are entity paths, edges are `[from, target, to]` triples (to=null ⇒ broken). */
function graph(nodes: readonly string[], edges: readonly (readonly [string, string, string | null])[]): KbGraphResult {
  return { nodes: [...nodes], edges: edges.map(([from, target, to]) => ({ from, target, to })) }
}

describe('preScanOf', () => {
  it('counts orphans by resolved incoming links and never flags the todo singleton', () => {
    const scan = preScanOf(graph(
      [
        'entities/todos.md',
        'entities/projects/飞书迁移.md',
        'entities/people/李四.md',
        'entities/areas/孤岛.md',
      ],
      [
        ['entities/projects/飞书迁移.md', '李四', 'entities/people/李四.md'],
        ['entities/people/李四.md', '飞书迁移', 'entities/projects/飞书迁移.md'],
        ['entities/areas/孤岛.md', '不存在', null],
      ],
    ))
    expect(scan.entities).toBe(4)
    // The rule is 入链≤1: the mutually-linked pair (1 inbound each) are
    // orphans too; only the todo singleton — zero inbound, but a structural
    // singleton — is spared. 孤岛's own outbound link is broken, so it has 0.
    expect(scan.orphans.map(orphan => orphan.name).sort()).toEqual(['孤岛', '李四', '飞书迁移'])
    expect(scan.orphans.find(orphan => orphan.name === '孤岛')).toMatchObject({ path: 'entities/areas/孤岛.md', type: 'area', incoming: 0 })
  })

  it('keeps a singly-linked entity as an orphan and spares one with two inbound links', () => {
    const scan = preScanOf(graph(
      ['entities/projects/a.md', 'entities/projects/b.md', 'entities/people/c.md'],
      [
        ['entities/projects/a.md', 'c', 'entities/people/c.md'],
        ['entities/projects/b.md', 'c', 'entities/people/c.md'],
      ],
    ))
    // c has two inbound links; a and b have none.
    expect(scan.orphans.map(orphan => orphan.name).sort()).toEqual(['a', 'b'])
  })

  it('reports every unresolved link with its host, whatever the direction', () => {
    const scan = preScanOf(graph(
      ['entities/projects/a.md', 'entities/projects/b.md'],
      [
        ['entities/projects/a.md', '幽灵', null],
        ['entities/projects/b.md', '含糊', null],
      ],
    ))
    expect(scan.broken).toEqual([
      { host: 'entities/projects/a.md', target: '幽灵' },
      { host: 'entities/projects/b.md', target: '含糊' },
    ])
  })
})

describe('validatePrompt', () => {
  it('carries the prescan lists, the roster, and the named entities, and pins the L1 whitelist', () => {
    const text = validatePrompt({
      preScan: {
        entities: 3,
        orphans: [{ path: 'entities/areas/孤岛.md', name: '孤岛', type: 'area', incoming: 0 }],
        broken: [{ host: 'entities/projects/飞书迁移.md', target: '邮箱迁移' }],
      },
      roster: [
        { name: '飞书迁移', type: 'project' },
        { name: '李四', type: 'person' },
        { name: '孤岛', type: 'area' },
      ],
      named: [{ name: '孤岛', content: '# 孤岛\n\n没有人和它相连。' }],
    })
    expect(text).toContain('【预扫 · 孤儿条目（入链不超过 1）】共 1 条')
    expect(text).toContain('- 孤岛（area，入链 0）')
    expect(text).toContain('【预扫 · 失效双链】共 1 条')
    expect(text).toContain('- [[邮箱迁移]]（写在 entities/projects/飞书迁移.md）')
    expect(text).toContain('【实体花名册】共 3 个')
    expect(text).toContain('- 李四（person）')
    expect(text).toContain('【点名实体：孤岛】')
    expect(text).toContain('没有人和它相连。')
    // The L1 whitelist is pinned twice: in the JSON shape and in the rules.
    expect(text).toContain('"edits": []')
    expect(text).toContain('todos 一律空数组')
    expect(text).toContain('"todos": []')
  })

  it('prints （无） for an empty prescan list instead of nothing', () => {
    const text = validatePrompt({ preScan: { entities: 0, orphans: [], broken: [] }, roster: [], named: [] })
    expect(text).toContain('（无）')
  })

  it('frames a scoped run: the angle narrows the prescan, links may still go anywhere', () => {
    const text = validatePrompt({
      preScan: { entities: 1, orphans: [], broken: [] },
      roster: [{ name: '李四', type: 'person' }],
      named: [],
      angle: '人物',
    })
    expect(text).toContain('视角限定在「人物」')
    expect(text).toContain('补链可以指向任何实体')
    // The unscoped intro is gone.
    expect(text).not.toContain('全库体检')
  })
})

describe('parseValidateVerdict', () => {
  /** A validate verdict as fenced JSON, overridable per test. */
  function verdict(overrides: Record<string, unknown> = {}): string {
    return `\`\`\`json\n${JSON.stringify({
      reason: '整体健康，两处需要补链',
      findings: [
        { kind: 'orphan', subject: '孤岛', why: '没有任何入链' },
        { kind: 'broken-link', subject: '[[邮箱迁移]]', why: '指向不存在的实体' },
      ],
      targets: [{ entity: '飞书迁移', edits: [{ section: '状态', after: '不该出现', why: 'w' }], links: [{ to: '孤岛', why: '同域' }], log: '体检补链' }],
      creates: [],
      todos: [],
      questions: [],
      ...overrides,
    })}\n\`\`\``
  }

  it('peels findings and todos off and hands the rest to the v2 parser', () => {
    const parsed = parseValidateVerdict(verdict())
    expect(parsed.reason).toBe('整体健康，两处需要补链')
    expect(parsed.findings).toEqual([
      { kind: 'orphan', subject: '孤岛', why: '没有任何入链' },
      { kind: 'broken-link', subject: '[[邮箱迁移]]', why: '指向不存在的实体' },
    ])
    expect(parsed.targets).toHaveLength(1)
    expect(parsed.creates).toEqual([])
    expect(parsed.questions).toEqual([])
  })

  it('drops findings with an unknown kind or no subject, not guessing', () => {
    const parsed = parseValidateVerdict(verdict({
      findings: [
        { kind: 'orphan', subject: '孤岛', why: 'w' },
        { kind: 'catastrophe', subject: 'x', why: 'w' },
        { kind: 'stale', subject: '', why: 'w' },
        { subject: '无种类', why: 'w' },
      ],
    }))
    expect(parsed.findings).toEqual([{ kind: 'orphan', subject: '孤岛', why: 'w' }])
  })

  it('parses todos with a title and an optional due', () => {
    const parsed = parseValidateVerdict(verdict({
      todos: [
        { title: '盘点陈旧条目', due: '2026-10-01', body: 'b' },
        { title: '没有截止日的', body: 'b' },
        { title: '', body: '无名的不算' },
      ],
    }))
    expect(parsed.todos).toEqual([
      { title: '盘点陈旧条目', due: '2026-10-01', body: 'b' },
      { title: '没有截止日的', body: 'b' },
    ])
  })

  it('throws on unreadable JSON — silence would read as nothing to do', () => {
    expect(() => parseValidateVerdict('这不是 JSON')).toThrow()
  })
})

describe('verdictToValidateProposal', () => {
  const VIEWS = {
    roster: [
      { name: '飞书迁移', path: 'entities/projects/飞书迁移.md', content: '# 飞书迁移\n\n## 流水\n' },
      { name: '孤岛', path: 'entities/areas/孤岛.md', content: '# 孤岛' },
    ],
  }

  it('strips targets\' edits (L1) but keeps their links and log', () => {
    const proposal = verdictToValidateProposal(
      {
        reason: 'r',
        findings: [],
        targets: [{ entity: '飞书迁移', edits: [{ section: '状态', after: '违禁改写', why: 'w' }], links: [{ to: '孤岛', why: '同域' }], log: '体检补链' }],
        creates: [],
        todos: [],
        questions: [],
      },
      VIEWS,
      '实体校验 2026-09-29',
    )
    expect(proposal.title).toBe('实体校验 2026-09-29')
    expect(proposal.actions.some(action => action.kind === 'edit-section')).toBe(false)
    expect(proposal.actions).toEqual(expect.arrayContaining([
      { kind: 'create-link', entityPath: 'entities/projects/飞书迁移.md', entityName: '飞书迁移', link: '[[孤岛]]', reason: '同域' },
    ]))
    expect(proposal.actions.some(action => action.kind === 'append-log')).toBe(true)
  })

  it('attaches the findings as the card\'s display rows and never turns todos into actions', () => {
    const proposal = verdictToValidateProposal(
      {
        reason: 'r',
        findings: [{ kind: 'orphan', subject: '孤岛', why: '没有入链' }],
        targets: [],
        creates: [],
        todos: [{ title: 'L2 才许做的事', body: 'b' }],
        questions: [],
      },
      VIEWS,
      't',
    )
    expect(proposal.findings).toEqual([{ kind: 'orphan', subject: '孤岛', why: '没有入链' }])
    expect(proposal.actions.some(action => action.kind === 'add-todo')).toBe(false)
  })

  it('still proposes new entities when the model called for them', () => {
    const proposal = verdictToValidateProposal(
      {
        reason: 'r',
        findings: [],
        targets: [],
        creates: [{ entityType: 'project', name: '邮箱迁移', why: '失效双链的本意', edits: [], links: [], log: '' }],
        todos: [],
        questions: [],
      },
      VIEWS,
      't',
    )
    expect(proposal.actions[0]).toEqual({ kind: 'create-entity', entityType: 'project', name: '邮箱迁移', reason: '失效双链的本意' })
  })
})
