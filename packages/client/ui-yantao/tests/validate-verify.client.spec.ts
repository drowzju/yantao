import { describe, expect, it } from 'vitest'
import { normalizeEntityName, verifyValidateVerdict } from '../src/client/validate-verify.ts'
import type { ValidateVerdict } from '../src/client/validate.ts'

/** A verdict factory: every field overridable per test. */
function verdict(overrides: Partial<ValidateVerdict> = {}): ValidateVerdict {
  return {
    reason: 'r',
    findings: [],
    targets: [],
    questions: [],
    ...overrides,
  }
}

const ROSTER = ['飞书迁移', '李四', '孤岛', 'Full-Width']
const NAMED = ['孤岛', '飞书迁移'] // the model saw these two in full text
const BROKEN = ['邮箱迁移']

describe('normalizeEntityName', () => {
  it('folds NFKC twins, whitespace and case, leaves CJK untouched', () => {
    expect(normalizeEntityName('Ｆｕｌｌ－Width')).toBe(normalizeEntityName('full-width'))
    expect(normalizeEntityName(' 孤 岛 ')).toBe(normalizeEntityName('孤岛'))
    expect(normalizeEntityName('李四')).toBe('李四')
  })
})

describe('verifyValidateVerdict', () => {
  it('passes legitimate findings, targets and links through untouched', () => {
    const input = verdict({
      findings: [
        { kind: 'stale', subject: '飞书迁移', why: '状态声称已上线' },
        { kind: 'contradiction', subject: '[[孤岛]]', why: '目标与状态打架' },
        { kind: 'missing', subject: '邮箱迁移', why: '失链指向的主题不存在' },
      ],
      targets: [{ entity: '飞书迁移', edits: [], links: [{ to: '孤岛', why: '同域' }], log: 'l' }],
    })
    const { verdict: checked, counts } = verifyValidateVerdict({
      verdict: input, rosterNames: ROSTER, namedNames: NAMED, brokenTargets: BROKEN,
    })
    expect(checked.findings).toHaveLength(3)
    expect(checked.targets).toEqual(input.targets)
    expect(counts).toEqual({ findings: 0, targets: 0, links: 0 })
  })

  it('drops stale/contradiction findings that name nothing the model saw', () => {
    const { verdict: checked, counts } = verifyValidateVerdict({
      verdict: verdict({
        findings: [
          { kind: 'stale', subject: '凭空捏造', why: '不在花名册' },
          { kind: 'stale', subject: '李四', why: '在花名册但没被点名——模型没读过它的正文' },
          { kind: 'contradiction', subject: '[[真失链]]', why: '失链不在预扫里' },
        ],
      }),
      rosterNames: ROSTER, namedNames: NAMED, brokenTargets: BROKEN,
    })
    expect(checked.findings).toEqual([])
    expect(counts.findings).toBe(3)
  })

  it('resolves bracketed aliases; width folding never widens the named set', () => {
    const { verdict: checked } = verifyValidateVerdict({
      verdict: verdict({
        findings: [
          { kind: 'stale', subject: '[[飞书迁移|这个项目]]', why: '别名语法照常解析' },
          { kind: 'contradiction', subject: 'ｆｕｌｌ－ｗｉｄｔｈ', why: '全角写法——但模型没读过它的正文' },
        ],
      }),
      rosterNames: ROSTER, namedNames: NAMED, brokenTargets: BROKEN,
    })
    expect(checked.findings).toHaveLength(1)
    expect(checked.findings[0]?.subject).toBe('[[飞书迁移|这个项目]]')
  })

  it('drops a missing finding whose subject the roster already holds', () => {
    const { verdict: checked, counts } = verifyValidateVerdict({
      verdict: verdict({
        findings: [
          { kind: 'missing', subject: '李四', why: '他明明存在——这是幻觉' },
          { kind: 'missing', subject: '邮箱迁移', why: '真缺席（还是个失链 target）' },
          { kind: 'missing', subject: '全新主题', why: '库里没有，可信' },
        ],
      }),
      rosterNames: ROSTER, namedNames: NAMED, brokenTargets: BROKEN,
    })
    expect(checked.findings).toEqual([
      { kind: 'missing', subject: '邮箱迁移', why: '真缺席（还是个失链 target）' },
      { kind: 'missing', subject: '全新主题', why: '库里没有，可信' },
    ])
    expect(counts.findings).toBe(1)
  })

  it('drops a whole target off the roster but only the offending link rows', () => {
    const { verdict: checked, counts } = verifyValidateVerdict({
      verdict: verdict({
        targets: [
          { entity: '不存在的人', edits: [], links: [], log: '整条丢弃' },
          { entity: '飞书迁移', edits: [], links: [{ to: '孤岛', why: '真' }, { to: '幻影', why: '假' }], log: 'l' },
        ],
      }),
      rosterNames: ROSTER, namedNames: NAMED, brokenTargets: BROKEN,
    })
    expect(checked.targets).toEqual([
      { entity: '飞书迁移', edits: [], links: [{ to: '孤岛', why: '真' }], log: 'l' },
    ])
    expect(counts).toEqual({ findings: 0, targets: 1, links: 1 })
  })

  it('drops recited prescan kinds outright — the prescan owns them', () => {
    const { verdict: checked, counts } = verifyValidateVerdict({
      verdict: verdict({
        findings: [
          { kind: 'orphan', subject: '孤岛', why: '预扫已直出，复述即弃' },
          { kind: 'broken-link', subject: '[[邮箱迁移]]', why: '同上' },
        ],
      }),
      rosterNames: ROSTER, namedNames: NAMED, brokenTargets: BROKEN,
    })
    expect(checked.findings).toEqual([])
    expect(counts.findings).toBe(2)
  })
})
