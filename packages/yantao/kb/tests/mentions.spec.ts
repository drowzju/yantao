import { describe, expect, it } from 'vitest'
import {
  MAX_DIR_ENTRIES, MAX_MENTIONS, MAX_MENTION_CHARS, kbMentions, renderKbMentions,
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

  it('reads a directory mention with or without the trailing slash', () => {
    expect(kbMentions('@resources/报告/ 里的周报')).toEqual(['resources/报告/'])
    expect(kbMentions('@resources/报告 里的周报')).toEqual(['resources/报告'])
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

  it('renders a cited binary file as a placeholder carrying its size', () => {
    const text = renderKbMentions([{ kind: 'binary', path: 'resources/照片.png', size: 2048 }])
    expect(text).toContain('<kb-file path="resources/照片.png">')
    expect(text).toContain('（二进制文件，未注入内容；大小 2048 字节）')
    expect(text).not.toContain('PNG')
  })

  it('renders a cited directory as a kb-dir block with inline text files', () => {
    const text = renderKbMentions([{
      kind: 'dir',
      path: 'resources/报告',
      files: [
        { path: 'resources/报告/笔记.md', content: '目录里的笔记' },
        { path: 'resources/报告/照片.png', content: null, reason: 'binary', size: 3 },
        { path: 'resources/报告/大.txt', content: null, reason: 'budget' },
      ],
    }])
    expect(text).toContain('<kb-dir path="resources/报告" files="3">')
    expect(text).toContain('<kb-file path="resources/报告/笔记.md">\n目录里的笔记\n</kb-file>')
    expect(text).toContain('（二进制文件，未注入内容；大小 3 字节）')
    expect(text).toContain('（超出目录内容预算，未注入内容）')
    expect(text).not.toContain('已截断')
  })

  it('notes the truncation on a directory past the entry cap', () => {
    const files = Array.from({ length: MAX_DIR_ENTRIES + 1 }, (_unused, index) => ({
      path: `resources/many/f${index}.txt`, content: null as string | null, reason: 'budget' as const,
    }))
    const text = renderKbMentions([{ kind: 'dir', path: 'resources/many', files, truncated: true }])
    expect(text).toContain(`（目录条目超过 ${MAX_DIR_ENTRIES} 个，已截断）`)
  })
})
