import { describe, expect, it } from 'vitest'
import { frontmatterSummary, splitFrontmatter } from '../src/client/markdown.ts'

const ENTITY = [
  '---',
  'type: project',
  'areas: []',
  'created: 2026-09-08',
  '---',
  '',
  '## 状态',
  '',
  '进行中',
].join('\n')

describe('splitFrontmatter', () => {
  it('splits the envelope off the body and keeps its fields in order', () => {
    const split = splitFrontmatter(ENTITY)
    expect(split.hasFrontmatter).toBe(true)
    expect(split.fields).toEqual([
      { key: 'type', value: 'project' },
      { key: 'areas', value: '[]' },
      { key: 'created', value: '2026-09-08' },
    ])
    expect(split.body.startsWith('## 状态')).toBe(true)
  })

  it('keeps a bare key with an empty value', () => {
    const split = splitFrontmatter('---\nrelation:\n---\n正文')
    expect(split.fields).toEqual([{ key: 'relation', value: '' }])
    expect(split.body).toBe('正文')
  })

  it('drops only the blank line under the envelope', () => {
    expect(splitFrontmatter('---\ntype: todo\n---\n\n\n第一行').body).toBe('\n第一行')
  })

  it('accepts ... as the closing delimiter', () => {
    const split = splitFrontmatter('---\ntype: area\n...\n正文')
    expect(split.hasFrontmatter).toBe(true)
    expect(split.body).toBe('正文')
  })

  it('reads a CRLF file', () => {
    const split = splitFrontmatter('---\r\ntype: meeting\r\ntitle: 周会\r\n---\r\n\r\n正文')
    expect(split.fields.map(field => field.key)).toEqual(['type', 'title'])
    expect(split.body).toBe('正文')
  })

  it('treats an unclosed envelope as no envelope rather than showing junk', () => {
    const text = '---\ntype: project\n\n正文'
    const split = splitFrontmatter(text)
    expect(split.hasFrontmatter).toBe(false)
    expect(split.body).toBe(text)
  })

  it('treats a file that does not start with --- as no envelope', () => {
    const text = '正文\n---\n分割线'
    expect(splitFrontmatter(text)).toEqual({ fields: [], body: text, hasFrontmatter: false })
  })

  it('ignores lines inside the envelope that are not key: value', () => {
    const split = splitFrontmatter('---\n# 注释\ntype: person\n- 列表\n---\n正文')
    expect(split.fields).toEqual([{ key: 'type', value: 'person' }])
  })

  it('keeps a colon inside the value', () => {
    expect(splitFrontmatter('---\nurl: http://a.b/c\n---\nx').fields)
      .toEqual([{ key: 'url', value: 'http://a.b/c' }])
  })
})

describe('frontmatterSummary', () => {
  it('shows only fields that carry a value', () => {
    expect(frontmatterSummary(splitFrontmatter(ENTITY).fields)).toBe('type: project · areas: [] · created: 2026-09-08')
  })

  it('is empty when every field is empty', () => {
    expect(frontmatterSummary([{ key: 'relation', value: '' }])).toBe('')
  })
})
