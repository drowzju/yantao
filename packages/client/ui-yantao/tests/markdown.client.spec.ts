import { describe, expect, it } from 'vitest'
import {
  collapseEmptySections, fileDirOf, frontmatterSummary, headingOutline, localImageRefs, restoreTableBreaks,
  resolveLocalImagePath, splitFrontmatter, taskLines, toggleTask,
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

describe('collapseEmptySections', () => {
  it('collapses a run of empty template sections into placeholder lines', () => {
    const body = ['# 公共BMT', '', '## 状态', '', '## 决议', '', '## 待办', '', '## 流水', '', '- 2026-09-22 创建'].join('\n')
    expect(collapseEmptySections(body)).toBe([
      '# 公共BMT',
      '',
      '**状态**（空）',
      '**决议**（空）',
      '**待办**（空）',
      '## 流水',
      '',
      '- 2026-09-22 创建',
    ].join('\n'))
  })

  it('never collapses the document title', () => {
    const body = ['# 标题', '', '## 状态', '', '进行中'].join('\n')
    expect(collapseEmptySections(body)).toBe(body)
  })

  it('leaves non-empty sections byte-for-byte', () => {
    const body = ['## 状态', '', '进行中', '', '## 流水', '', '- 2026-09-22 创建'].join('\n')
    expect(collapseEmptySections(body)).toBe(body)
  })

  it('counts a fenced block as content and ignores headings inside it', () => {
    const body = ['## 状态', '', '```', '## 不是区段', '```', '', '## 流水', '', '- x'].join('\n')
    expect(collapseEmptySections(body)).toBe(body)
  })

  it('collapses a trailing empty section', () => {
    const body = ['## 流水', '', '- x', '', '## 备注', ''].join('\n')
    expect(collapseEmptySections(body)).toBe(['## 流水', '', '- x', '', '**备注**（空）'].join('\n'))
  })

  it('leaves a document with no headings unchanged', () => {
    expect(collapseEmptySections('正文第一段\n\n正文第二段')).toBe('正文第一段\n\n正文第二段')
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

describe('restoreTableBreaks', () => {
  it('turns a cell\'s <br> tags into break references the grammar decodes', () => {
    const row = '| 事项 | 进展 |\n|---|---|\n| a | 一<br>二<br />三<br/> |'
    expect(restoreTableBreaks(row)).toBe('| 事项 | 进展 |\n|---|---|\n| a | 一&#10;二&#10;三&#10; |')
  })

  it('opens each <li> on its own line and strips the tags the renderer drops anyway', () => {
    const row = '| a | [日期]<br><ul><li>1. 甲</li><br><li>2. <span style="color:red">乙</span></li><br>[日期] |'
    expect(restoreTableBreaks(row)).toBe('| a | [日期]&#10;1. 甲&#10;2. 乙&#10;[日期] |')
  })

  it('leaves prose comparisons alone', () => {
    const row = '| a | 3 < 5 且 b > 2 |'
    expect(restoreTableBreaks(row)).toBe(row)
  })

  it('leaves lines that are not table rows alone', () => {
    const text = '一段<br>不换\n\n```\n| 围栏里的<br>不动 |\n```'
    expect(restoreTableBreaks(text)).toBe(text)
  })

  it('keeps a <br> inside a code span literal', () => {
    const row = '| a | 用 `<br>` 换行<br>下一行 |'
    expect(restoreTableBreaks(row)).toBe('| a | 用 `<br>` 换行&#10;下一行 |')
  })
})

describe('localImageRefs', () => {
  it('collects inline and reference-style destinations, deduplicated in order', () => {
    const body = [
      '![首图](_assets/a.png)',
      '',
      '![别名][second]',
      '',
      '[second]: _assets/b.jpg',
      '![重复](_assets/a.png)',
    ].join('\n')
    expect(localImageRefs(body)).toEqual(['_assets/a.png', '_assets/b.jpg'])
  })

  it('drops remote, scheme-carrying, and fragment destinations', () => {
    const body = [
      '![远](https://example.com/x.png)',
      '![数据](data:image/png;base64,AAAA)',
      '![锚](#section)',
      '![本地](_assets/a.png)',
    ].join('\n')
    expect(localImageRefs(body)).toEqual(['_assets/a.png'])
  })

  it('skips image mentions inside a fenced block', () => {
    const body = ['```', '![示例](sample.png)', '```', '![真](real.png)'].join('\n')
    expect(localImageRefs(body)).toEqual(['real.png'])
  })

  it('reads a title suffix and angle-wrapped destination', () => {
    expect(localImageRefs('![图](<_assets/a b.png> "标题")')).toEqual(['_assets/a b.png'])
  })
})

describe('resolveLocalImagePath', () => {
  it('resolves a sibling reference against the file\'s directory', () => {
    expect(resolveLocalImagePath('entities/projects', '_assets/a.png')).toBe('entities/projects/_assets/a.png')
  })

  it('folds ./ and ../ segments', () => {
    expect(resolveLocalImagePath('entities/projects', './a.png')).toBe('entities/projects/a.png')
    expect(resolveLocalImagePath('entities/projects', '../shared/a.png')).toBe('entities/shared/a.png')
  })

  it('treats a leading slash as KB-root-relative', () => {
    expect(resolveLocalImagePath('entities/projects', '/_assets/a.png')).toBe('_assets/a.png')
  })

  it('decodes percent escapes', () => {
    expect(resolveLocalImagePath('', '%E5%9B%BE%20%E7%89%87.png')).toBe('图 片.png')
  })

  it('refuses schemes, fragments, escapes past the root, and non-images', () => {
    expect(resolveLocalImagePath('entities', 'https://a/b.png')).toBeNull()
    expect(resolveLocalImagePath('entities', '#frag')).toBeNull()
    expect(resolveLocalImagePath('entities', '../../outside.png')).toBeNull()
    expect(resolveLocalImagePath('entities', '../notes.md')).toBeNull()
    expect(resolveLocalImagePath('entities', '')).toBeNull()
  })

  it('tolerates backslashes the way Windows writers leave them', () => {
    expect(resolveLocalImagePath('entities', '..\\_assets\\a.png')).toBe('_assets/a.png')
  })
})

describe('fileDirOf', () => {
  it('returns the directory before the last slash, empty at the root', () => {
    expect(fileDirOf('entities/projects/todo.md')).toBe('entities/projects')
    expect(fileDirOf('todo.md')).toBe('')
  })
})
