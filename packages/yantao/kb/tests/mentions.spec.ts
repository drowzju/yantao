import { describe, expect, it } from 'vitest'
import {
  MAX_MENTIONS, MAX_MENTION_CHARS, kbMentions, renderKbMentions,
} from '../src/mentions.ts'

describe('kbMentions', () => {
  it('reads a bare mention and a quoted one with spaces', () => {
    expect(kbMentions('看看 @entities/people/张三.md')).toEqual(['entities/people/张三.md'])
    expect(kbMentions('@"entities/projects/dsh 学习.md" 进展如何'))
      .toEqual(['entities/projects/dsh 学习.md'])
  })

  it('ignores mentions that are not KB paths', () => {
    expect(kbMentions('@dinner @here @我 都行')).toEqual([])
    expect(kbMentions('mail me at a@entities/x.com')).toEqual([])
  })

  it('refuses a mention that climbs out of the root or names a drive', () => {
    expect(kbMentions('@entities/../../etc/passwd')).toEqual([])
    expect(kbMentions('@/etc/passwd')).toEqual([])
    expect(kbMentions('@C:\\Windows')).toEqual([])
  })

  it('deduplicates and caps one turn', () => {
    expect(kbMentions('@entities/areas/健康.md 再看 @entities/areas/健康.md'))
      .toEqual(['entities/areas/健康.md'])
    const many = Array.from({ length: MAX_MENTIONS + 3 }, (_unused, index) =>
      `@entities/areas/a${index}.md`).join(' ')
    expect(kbMentions(many)).toHaveLength(MAX_MENTIONS)
  })

  it('reads a resource original too', () => {
    expect(kbMentions('@resources/周报.eml')).toEqual(['resources/周报.eml'])
  })
})

describe('renderKbMentions', () => {
  it('renders nothing when nothing was cited', () => {
    expect(renderKbMentions([])).toBe('')
  })

  it('renders one tagged block per cited file', () => {
    const text = renderKbMentions([{ path: 'entities/people/张三.md', content: '张三的内容' }])
    expect(text).toContain('<kb-file path="entities/people/张三.md">')
    expect(text).toContain('张三的内容')
  })

  it('truncates a file past the character budget', () => {
    const text = renderKbMentions([{ path: 'entities/areas/健康.md', content: 'x'.repeat(MAX_MENTION_CHARS + 10) }])
    expect(text).toContain('已截断')
    expect(text.length).toBeLessThan(MAX_MENTION_CHARS + 200)
  })
})
