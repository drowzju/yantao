import { describe, expect, it } from 'vitest'
import {
  frontmatterSummary, headingOutline, splitFrontmatter, taskLines, toggleTask,
} from '../src/client/markdown.ts'

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

describe('taskLines', () => {
  it('numbers the task items in document order', () => {
    const text = ['# 待办', '', '- [ ] 第一', '- [x] 第二', '', '正文', '- [ ] 第三'].join('\n')
    expect(taskLines(text)).toEqual([2, 3, 6])
  })

  it('counts nested and star-bulleted items too', () => {
    expect(taskLines(['- [ ] 外', '  * [x] 内'].join('\n'))).toEqual([0, 1])
  })

  it('skips a checklist inside a fenced block', () => {
    const text = ['- [ ] 真', '```', '- [ ] 示例', '```', '- [ ] 也真'].join('\n')
    expect(taskLines(text)).toEqual([0, 4])
  })
})

describe('toggleTask', () => {
  const text = ['# 待办', '', '- [ ] 第一', '- [x] 第二'].join('\n')

  it('checks an unchecked line', () => {
    expect(toggleTask(text, 0)).toBe(['# 待办', '', '- [x] 第一', '- [x] 第二'].join('\n'))
  })

  it('unchecks a checked line', () => {
    expect(toggleTask(text, 1)).toBe(['# 待办', '', '- [ ] 第一', '- [ ] 第二'].join('\n'))
  })

  it('keeps the rest of the line exactly', () => {
    expect(toggleTask('- [ ] 写下第一个待办  ', 0)).toBe('- [x] 写下第一个待办  ')
  })

  it('refuses an ordinal that is not a task', () => {
    expect(toggleTask(text, 2)).toBeNull()
    expect(toggleTask('- [ ] 只有一个', 1)).toBeNull()
  })

  it('toggles only the line it means to', () => {
    const file = ['---', 'type: todo', '---', '', '- [ ] a', '- [ ] b'].join('\n')
    expect(toggleTask(file, 1)).toBe(['---', 'type: todo', '---', '', '- [ ] a', '- [x] b'].join('\n'))
  })
})

describe('headingOutline', () => {
  it('lists headings in order with their level', () => {
    const body = ['# 标题', '正文', '## 状态', '', '进行中', '### 备注'].join('\n')
    expect(headingOutline(body)).toEqual([
      { level: 1, text: '标题' },
      { level: 2, text: '状态' },
      { level: 3, text: '备注' },
    ])
  })

  it('ignores a heading inside a fenced block', () => {
    const body = ['## 真', '```', '# 不是标题', '```', '## 也是真'].join('\n')
    expect(headingOutline(body).map(entry => entry.text)).toEqual(['真', '也是真'])
  })

  it('ignores a # with no text after it', () => {
    expect(headingOutline('#')).toEqual([])
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
