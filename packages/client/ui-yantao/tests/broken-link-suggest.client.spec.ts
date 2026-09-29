import { describe, expect, it, vi } from 'vitest'
import type { RefineEntityView } from '../src/client/refine.ts'
import type { ProposalTarget } from '../src/client/proposal-apply.ts'
import { applyProposal } from '../src/client/proposal-apply.ts'
import {
  HIGH_CONFIDENCE,
  MAX_CANDIDATES,
  brokenLinkSectionFixes,
  nameSimilarity,
  rewriteWikilinkTarget,
  suggestLinkFixes,
} from '../src/client/broken-link-suggest.ts'
import { brokenLinkFixesOf, verdictToValidateProposal } from '../src/client/validate.ts'
import type { ValidatePreScan, ValidateVerdict } from '../src/client/validate.ts'

describe('nameSimilarity', () => {
  it('rates an exact name 1', () => {
    expect(nameSimilarity('飞书迁移', '飞书迁移')).toBe(1)
  })

  it('folds case and width differences to 1', () => {
    expect(nameSimilarity('Ｆｕｌｌ－Width', 'full-width')).toBe(1)
  })

  it('rates a one-hanzi CJK slip above the bar (张三丰 vs 张三峰)', () => {
    expect(nameSimilarity('张三丰', '张三峰')).toBeGreaterThanOrEqual(HIGH_CONFIDENCE)
  })

  it('scores a one-hanzi slip of a short name above the bar, unrelated names far below', () => {
    // 三字名里错一个字（三→叁）：加权距离 0.5/3 → 0.833，稳过阈值；
    // 完全无关的名字远低于阈值，不会产生候选。
    expect(nameSimilarity('张三丰', '张叁丰')).toBeGreaterThanOrEqual(HIGH_CONFIDENCE)
    expect(nameSimilarity('邮箱迁移', '李四')).toBeLessThan(HIGH_CONFIDENCE)
  })

  it('rates containment 0.82 in both directions', () => {
    expect(nameSimilarity('飞书', '飞书迁移')).toBe(0.82)
    expect(nameSimilarity('飞书迁移', '飞书')).toBe(0.82)
  })

  it('mixes latin edit distance and bigram dice, and refuses empty names', () => {
    expect(nameSimilarity('abcd', 'abce')).toBe(0.75)
    expect(nameSimilarity('张', '李')).toBe(0.5)
    expect(nameSimilarity('', '李四')).toBe(0)
  })
})

describe('suggestLinkFixes', () => {
  const ROSTER = [
    { name: '邮箱迁移' },
    { name: '邮箱迁移计划' },
    { name: '李四' },
  ]

  it('ranks candidates best first and strips a 类型: locator before scoring', () => {
    const withLocator = suggestLinkFixes('项目:邮箱迁移', ROSTER)
    const bare = suggestLinkFixes('邮箱迁移', ROSTER)
    expect(withLocator).toEqual(bare)
    expect(withLocator[0]).toEqual({ name: '邮箱迁移', score: 1 })
    expect(withLocator[1]).toEqual({ name: '邮箱迁移计划', score: 0.82 })
  })

  it('returns at most three candidates, tie-broken by name', () => {
    const roster = ['飞书A', '飞书B', '飞书C', '飞书D'].map(name => ({ name }))
    const candidates = suggestLinkFixes('飞书', roster)
    expect(candidates).toHaveLength(MAX_CANDIDATES)
    expect(candidates.map(candidate => candidate.name)).toEqual(['飞书A', '飞书B', '飞书C'])
  })

  it('returns nothing when no name clears the bar', () => {
    expect(suggestLinkFixes('凭空捏造', ROSTER)).toEqual([])
  })
})

describe('rewriteWikilinkTarget', () => {
  const BODY = [
    '前文 [[油箱迁移]] 与 [[李四]] 并列。',
    '别名一行 [[油箱迁移|老项目]] 保留别名。',
    '```text',
    '围栏里的 [[油箱迁移]] 不许动。',
    '```',
    '收尾又一处 [[油箱迁移]]。',
  ].join('\n')

  it('rewrites only the links whose folded target matches, alias preserved', () => {
    const after = rewriteWikilinkTarget(BODY, '油箱迁移', '邮箱迁移')
    expect(after).toContain('前文 [[邮箱迁移]] 与 [[李四]] 并列。')
    expect(after).toContain('别名一行 [[邮箱迁移|老项目]] 保留别名。')
    expect(after).toContain('围栏里的 [[油箱迁移]] 不许动。')
    expect(after).toContain('收尾又一处 [[邮箱迁移]]。')
  })

  it('replaces a 类型: locator target wholesale with the bare suggestion', () => {
    expect(rewriteWikilinkTarget('见 [[人物:油箱迁移|背景]]。', '人物:油箱迁移', '邮箱迁移'))
      .toBe('见 [[邮箱迁移|背景]]。')
  })

  it('returns the text unchanged when nothing matches, and is idempotent', () => {
    const stranger = '这里只有 [[李四]] 和 [[王五]]。'
    expect(rewriteWikilinkTarget(stranger, '油箱迁移', '邮箱迁移')).toBe(stranger)
    const once = rewriteWikilinkTarget(BODY, '油箱迁移', '邮箱迁移')
    expect(rewriteWikilinkTarget(once, '油箱迁移', '邮箱迁移')).toBe(once)
  })

  it('refuses a target that folds to nothing', () => {
    expect(rewriteWikilinkTarget(BODY, '　 ', '邮箱迁移')).toBe(BODY)
  })
})

describe('brokenLinkSectionFixes', () => {
  it('reports one fix per affected section, document order, 流水 included', () => {
    const content = [
      '# 张三',
      '',
      '## 状态',
      '',
      '推进 [[坏名]] 中。',
      '',
      '## 流水',
      '',
      '- 提到 [[坏名]]。',
    ].join('\n')
    const fixes = brokenLinkSectionFixes(content, '坏名', '好名')
    expect(fixes.map(fix => fix.section)).toEqual(['状态', '流水'])
    expect(fixes[0]).toMatchObject({
      section: '状态',
      before: '\n推进 [[坏名]] 中。\n',
      after: '\n推进 [[好名]] 中。\n',
    })
    expect(fixes[1]?.after).toBe('\n- 提到 [[好名]]。')
  })

  it('skips sections the link does not touch, and fences inside a section', () => {
    const content = [
      '# 张三',
      '',
      '## 状态',
      '',
      '没有链接。',
      '',
      '## 备注',
      '',
      '```',
      '[[坏名]] 在围栏里',
      '```',
      '',
      '真正要改的 [[坏名]]。',
    ].join('\n')
    const fixes = brokenLinkSectionFixes(content, '坏名', '好名')
    expect(fixes).toHaveLength(1)
    expect(fixes[0]?.section).toBe('备注')
    expect(fixes[0]?.after).toBe('\n```\n[[坏名]] 在围栏里\n```\n\n真正要改的 [[好名]]。')
  })

  it('ignores a link before the first heading, and an empty target', () => {
    expect(brokenLinkSectionFixes('引言里的 [[坏名]]。\n\n## 状态\n\n干净\n', '坏名', '好名')).toEqual([])
    expect(brokenLinkSectionFixes('# 张三\n\n[[坏名]]\n', '　', '好名')).toEqual([])
  })
})

/** A two-entity view set: 张三 hosts the broken links, 李四 merely exists. */
const ZHANG_PATH = 'entities/people/张三.md'
const LI_PATH = 'entities/people/李四.md'

function viewsWith(zhangContent: string): RefineEntityView[] {
  return [
    { name: '张三', path: ZHANG_PATH, content: zhangContent },
    { name: '李四', path: LI_PATH, content: '# 李四\n\n## 状态\n\n\n' },
  ]
}

function preScanWith(host: string, target: string): ValidatePreScan {
  return { entities: 2, orphans: [], broken: [{ host, target }] }
}

const ROSTER = [{ name: '邮箱迁移' }, { name: '李四' }]

describe('brokenLinkFixesOf', () => {
  it('builds a tickable edit-section action per affected section for a high-confidence candidate', () => {
    const content = '# 张三\n\n## 状态\n\n推进 [[油箱迁移]] 中。\n\n## 流水\n\n- 提到 [[油箱迁移]]。\n'
    const fixes = brokenLinkFixesOf(preScanWith(ZHANG_PATH, '油箱迁移'), viewsWith(content), ROSTER)
    expect(fixes.actions).toHaveLength(1)
    expect(fixes.actions[0]).toMatchObject({
      kind: 'edit-section',
      path: ZHANG_PATH,
      section: '状态',
      before: '\n推进 [[油箱迁移]] 中。\n',
      after: '\n推进 [[邮箱迁移]] 中。\n',
      why: '将 [[油箱迁移]]（位于 张三）改写为 [[邮箱迁移]]',
    })
    // 同一条失链还出现在流水里——那一处降级为展示行，动作行只管状态节。
    expect(fixes.findings).toEqual([
      { kind: 'broken-link', subject: '[[油箱迁移]]', why: '「流水」只增不改（位于 张三），这条失链请手工处理' },
    ])
  })

  it('degrades a 流水-only link to a display row — the append-only iron law outranks the fix', () => {
    const content = '# 张三\n\n## 流水\n\n- 提到 [[油箱迁移]]。\n'
    const fixes = brokenLinkFixesOf(preScanWith(ZHANG_PATH, '油箱迁移'), viewsWith(content), ROSTER)
    expect(fixes.actions).toEqual([])
    expect(fixes.findings).toEqual([
      { kind: 'broken-link', subject: '[[油箱迁移]]', why: '「流水」只增不改（位于 张三），这条失链请手工处理' },
    ])
  })

  it('keeps a link with no credible candidate display-only', () => {
    const content = '# 张三\n\n## 状态\n\n提到 [[凭空捏造]]。\n'
    const fixes = brokenLinkFixesOf(preScanWith(ZHANG_PATH, '凭空捏造'), viewsWith(content), ROSTER)
    expect(fixes.actions).toEqual([])
    expect(fixes.findings).toEqual([
      { kind: 'broken-link', subject: '[[凭空捏造]]', why: '无可信修复候选（位于 张三），请手工改写' },
    ])
  })

  it('degrades a link no section body holds (preamble or frontmatter)', () => {
    const content = '---\nkind: person\n---\n\n引言提到 [[邮箱迁移]]。\n\n## 状态\n\n干净\n'
    const fixes = brokenLinkFixesOf(preScanWith(ZHANG_PATH, '邮箱迁移'), viewsWith(content), ROSTER)
    expect(fixes.actions).toEqual([])
    expect(fixes.findings).toEqual([
      { kind: 'broken-link', subject: '[[邮箱迁移]]', why: '失链不在任何小节正文里（位于 张三），请手工改写' },
    ])
  })

  it('collapses a duplicate (host, target) pair and skips a host the views lack', () => {
    const content = '# 张三\n\n## 状态\n\n两处 [[油箱迁移]] 与 [[油箱迁移]]。\n'
    const duplicated: ValidatePreScan = {
      entities: 2,
      orphans: [],
      broken: [
        { host: ZHANG_PATH, target: '油箱迁移' },
        { host: ZHANG_PATH, target: '油箱迁移' },
        { host: 'entities/people/幽灵.md', target: '油箱迁移' },
      ],
    }
    const fixes = brokenLinkFixesOf(duplicated, viewsWith(content), ROSTER)
    expect(fixes.actions).toHaveLength(1)
    expect(fixes.findings).toEqual([])
  })
})

describe('verdictToValidateProposal with broken-link fixes', () => {
  const VERDICT: ValidateVerdict = {
    reason: 'r',
    findings: [{ kind: 'stale', subject: '张三', why: '状态过期' }],
    targets: [],
    questions: [],
  }

  it('appends the fix actions after the model-built ones and trails the display rows', () => {
    const proposal = verdictToValidateProposal(VERDICT, { roster: viewsWith('# 张三\n') }, 't', {
      actions: [{ kind: 'edit-section', path: ZHANG_PATH, section: '状态', before: 'a', after: 'b', why: 'w' }],
      findings: [{ kind: 'broken-link', subject: '[[坏名]]', why: '无可信修复候选' }],
    })
    expect(proposal.actions).toHaveLength(1)
    expect(proposal.findings).toEqual([
      { kind: 'stale', subject: '张三', why: '状态过期' },
      { kind: 'broken-link', subject: '[[坏名]]', why: '无可信修复候选' },
    ])
  })

  it('leaves the actions untouched when the fixes carry none', () => {
    const bare = verdictToValidateProposal(VERDICT, { roster: viewsWith('# 张三\n') }, 't')
    const empty = verdictToValidateProposal(VERDICT, { roster: viewsWith('# 张三\n') }, 't', { actions: [], findings: [] })
    expect(empty.actions).toEqual(bare.actions)
    expect(empty.findings).toEqual(bare.findings)
  })
})

describe('end-to-end: a fix action lands through the applier', () => {
  const FIXTURE = [
    '---',
    'kind: person',
    '---',
    '',
    '# 张三',
    '',
    '## 状态',
    '',
    '正在推进 [[油箱迁移]]，对接人 [[李四]]。',
    '',
    '```text',
    '示例：[[油箱迁移]] 保持原样',
    '```',
    '',
    '## 流水',
    '',
    '- 2026-09-29 创建，提到 [[油箱迁移]]。',
    '',
  ].join('\n')

  // The applier's replaceSection trims the section body and rebuilds it with
  // exactly one blank line on each side — the boundary blank between ``` and
  // ## 流水 belonged to the 状态 body and is consumed by that trim. Everything
  // outside the ticked section (frontmatter, fence, 流水) is byte-identical.
  const EXPECTED = [
    '---',
    'kind: person',
    '---',
    '',
    '# 张三',
    '',
    '## 状态',
    '',
    '正在推进 [[邮箱迁移]]，对接人 [[李四]]。',
    '',
    '```text',
    '示例：[[油箱迁移]] 保持原样',
    '```',
    '## 流水',
    '',
    '- 2026-09-29 创建，提到 [[油箱迁移]]。',
    '',
  ].join('\n')

  function storeTarget(store: Map<string, string>): ProposalTarget {
    return {
      createEntity: vi.fn(async () => ''),
      read: vi.fn(async (path: string) => store.get(path)!),
      write: vi.fn(async (path: string, content: string) => { store.set(path, content) }),
      todos: vi.fn(async () => ({ path: 'entities/todos.md', text: '', items: [] })),
      writeTodos: vi.fn(async () => ({ path: 'entities/todos.md', text: '' })),
      memoryAdd: vi.fn(async (_scope: string, text: string) => ({ path: '.dsh/yantao/memory/mail.md', entry: { id: 'm1', text } })),
    }
  }

  it('rewrites the 状态 section in place and leaves every other byte intact', async () => {
    const store = new Map([[ZHANG_PATH, FIXTURE]])
    const fixes = brokenLinkFixesOf(preScanWith(ZHANG_PATH, '油箱迁移'), viewsWith(FIXTURE), ROSTER)
    expect(fixes.actions).toHaveLength(1)
    expect(fixes.findings).toEqual([
      { kind: 'broken-link', subject: '[[油箱迁移]]', why: '「流水」只增不改（位于 张三），这条失链请手工处理' },
    ])
    const result = await applyProposal({
      proposal: { title: 't', actions: [...fixes.actions] },
      ticked: [0],
      target: storeTarget(store),
    })
    expect(result.written).toHaveLength(1)
    expect(store.get(ZHANG_PATH)).toBe(EXPECTED)
  })
})
