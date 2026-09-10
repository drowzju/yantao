import { describe, expect, it } from 'vitest'
import { addTodo, parseTodoFile, removeTodo, serializeTodoFile, toggleTodo, updateTodo } from '../src/todo.ts'
import { todoFileContent } from '../src/templates.ts'
import { KbError } from '../src/types.ts'

/** The canonical file every round-trip test starts from. */
const CANONICAL = [
  '---',
  'type: todo',
  'created: 2026-09-10',
  '---',
  '',
  '- [ ] [due::2026-09-12] 把季度汇报发给张三',
  '  正文第一行，缩进恰好两个空格',
  '  正文第二行',
  '- [x] [due::2026-09-10] [done::2026-09-09] 已完成的事',
  '',
].join('\n')

describe('parseTodoFile', () => {
  it('reads the checkbox, the title, and no fields at all', () => {
    const file = parseTodoFile('- [ ] 买牛奶\n')
    expect(file.preamble).toBe('')
    expect(file.items).toEqual([{ done: false, title: '买牛奶', body: '', extra: [] }])
  })

  it('reads due, done, and an uppercase X as checked', () => {
    const file = parseTodoFile('- [X] [due::2026-09-12] [done::2026-09-11] 交报告\n')
    expect(file.items).toEqual([{
      done: true,
      title: '交报告',
      due: '2026-09-12',
      doneOn: '2026-09-11',
      body: '',
      extra: [],
    }])
  })

  it('keeps unknown fields in extra, in the order they were written', () => {
    const file = parseTodoFile('- [ ] [prio::high] [due::2026-09-12] [who::张三] 汇报\n')
    expect(file.items[0]?.extra).toEqual(['[prio::high]', '[who::张三]'])
    expect(file.items[0]?.due).toBe('2026-09-12')
    expect(file.items[0]?.title).toBe('汇报')
  })

  it('reads a multiline body, stripping the two-space indent', () => {
    const file = parseTodoFile(CANONICAL)
    expect(file.items).toHaveLength(2)
    expect(file.items[0]?.body).toBe('正文第一行，缩进恰好两个空格\n正文第二行')
    expect(file.items[1]?.body).toBe('')
  })

  it('folds an unindented continuation line into the preceding item', () => {
    const file = parseTodoFile('- [ ] 标题\n手写的续行\n- [ ] 第二条\n')
    expect(file.items[0]?.body).toBe('手写的续行')
    expect(file.items[1]?.body).toBe('')
  })

  it('ends the body at a blank line but keeps lines that follow it in the same item', () => {
    const file = parseTodoFile('- [ ] 标题\n  正文\n\n  空行之后的正文\n- [ ] 第二条\n')
    expect(file.items[0]?.body).toBe('正文\n\n空行之后的正文')
  })

  it('keeps the preamble verbatim, frontmatter and heading included', () => {
    const file = parseTodoFile(CANONICAL)
    expect(file.preamble).toBe('---\ntype: todo\ncreated: 2026-09-10\n---\n')
    expect(parseTodoFile('# 待办\n\n- [ ] a\n').preamble).toBe('# 待办\n')
  })

  it('treats a file without items as one preamble', () => {
    expect(parseTodoFile('')).toEqual({ preamble: '', items: [] })
    expect(parseTodoFile('# 待办\n')).toEqual({ preamble: '# 待办\n', items: [] })
  })

  it('strips CR so a CRLF file parses like an LF one', () => {
    const file = parseTodoFile('- [ ] 标题\r\n  正文\r\n')
    expect(file.items[0]).toEqual({ done: false, title: '标题', body: '正文', extra: [] })
  })

  it('rejects a malformed due date', () => {
    expect(() => parseTodoFile('- [ ] [due::明天] 汇报\n')).toThrow(KbError)
    expect(() => parseTodoFile('- [ ] [due::明天] 汇报\n')).toThrow(/截止日期必须是 YYYY-MM-DD/)
  })

  it('treats an empty date field as no date', () => {
    const file = parseTodoFile('- [ ] [due::] 汇报\n')
    expect(file.items[0]?.due).toBeUndefined()
  })
})

describe('serializeTodoFile', () => {
  it('round trips the canonical file byte-for-byte', () => {
    expect(serializeTodoFile(parseTodoFile(CANONICAL))).toBe(CANONICAL)
  })

  it('round trips the template a fresh KB is initialized with', () => {
    const content = todoFileContent('2026-09-10')
    expect(serializeTodoFile(parseTodoFile(content))).toBe(content)
  })

  it('emits due before done, then the unknown fields, then the title', () => {
    const text = serializeTodoFile({
      preamble: '',
      items: [{ done: true, title: '汇报', due: '2026-09-12', doneOn: '2026-09-11', body: '', extra: ['[prio::high]'] }],
    })
    expect(text).toBe('- [x] [due::2026-09-12] [done::2026-09-11] [prio::high] 汇报\n')
  })

  it('indents every body line by two spaces and keeps the preamble verbatim', () => {
    const file = parseTodoFile(CANONICAL)
    const text = serializeTodoFile({ ...file, items: [{ done: false, title: 'a', body: '第一行\n第二行', extra: [] }] })
    expect(text).toBe('---\ntype: todo\ncreated: 2026-09-10\n---\n\n- [ ] a\n  第一行\n  第二行\n')
  })

  it('emits an empty file as an empty string', () => {
    expect(serializeTodoFile({ preamble: '', items: [] })).toBe('')
  })
})

describe('addTodo', () => {
  it('appends an unchecked item and leaves the rest of the file alone', () => {
    const file = parseTodoFile(CANONICAL)
    const next = addTodo(file, { title: '新待办', due: '2026-09-20', body: '正文' })
    expect(next.items).toHaveLength(3)
    expect(next.items[2]).toEqual({ done: false, title: '新待办', due: '2026-09-20', body: '正文', extra: [] })
    expect(next.items[0]).toEqual(file.items[0])
    expect(next.preamble).toBe(file.preamble)
    expect(serializeTodoFile(next).endsWith('- [ ] [due::2026-09-20] 新待办\n  正文\n')).toBe(true)
  })

  it('rejects a blank title and a malformed deadline', () => {
    const file = parseTodoFile(CANONICAL)
    expect(() => addTodo(file, { title: '   ' })).toThrow(/待办标题不能为空/)
    expect(() => addTodo(file, { title: 'x', due: '2026-9-20' })).toThrow(/截止日期必须是 YYYY-MM-DD/)
  })
})

describe('updateTodo', () => {
  it('patches the title, the deadline, and the body', () => {
    const file = parseTodoFile(CANONICAL)
    const next = updateTodo(file, 0, { title: '新标题', due: '2026-09-30', body: '新正文' })
    expect(next.items[0]).toEqual({
      done: false,
      title: '新标题',
      due: '2026-09-30',
      body: '新正文',
      extra: [],
    })
    expect(next.items[1]).toEqual(file.items[1])
  })

  it('leaves the fields the patch omits alone, checkbox state included', () => {
    const file = parseTodoFile(CANONICAL)
    const next = updateTodo(file, 1, { body: '补一句' })
    expect(next.items[1]?.done).toBe(true)
    expect(next.items[1]?.doneOn).toBe('2026-09-09')
    expect(next.items[1]?.due).toBe('2026-09-10')
    expect(next.items[1]?.body).toBe('补一句')
  })

  it('clears the deadline on an empty string', () => {
    const file = parseTodoFile(CANONICAL)
    expect(updateTodo(file, 0, { due: '' }).items[0]?.due).toBeUndefined()
  })

  it('throws on an out-of-range index', () => {
    const file = parseTodoFile(CANONICAL)
    expect(() => updateTodo(file, 2, { title: 'x' })).toThrow(KbError)
    expect(() => updateTodo(file, 2, { title: 'x' })).toThrow(/待办序号越界：2（共 2 条待办）/)
    expect(() => updateTodo(file, -1, { title: 'x' })).toThrow(/待办序号越界/)
  })

  it('rejects a malformed deadline', () => {
    const file = parseTodoFile(CANONICAL)
    expect(() => updateTodo(file, 0, { due: '2026/09/12' })).toThrow(/截止日期必须是 YYYY-MM-DD/)
  })
})

describe('removeTodo', () => {
  it('drops the item, body and all', () => {
    const file = parseTodoFile(CANONICAL)
    const next = removeTodo(file, 0)
    expect(next.items).toHaveLength(1)
    expect(next.items[0]?.title).toBe('已完成的事')
    expect(serializeTodoFile(next)).not.toContain('把季度汇报发给张三')
  })

  it('throws on an out-of-range index', () => {
    const file = parseTodoFile(CANONICAL)
    expect(() => removeTodo(file, 5)).toThrow(/待办序号越界：5（共 2 条待办）/)
  })
})

describe('toggleTodo', () => {
  it('stamps [done::今天] when checking an item', () => {
    const file = parseTodoFile(CANONICAL)
    const next = toggleTodo(file, 0, true, '2026-09-10')
    expect(next.items[0]?.done).toBe(true)
    expect(next.items[0]?.doneOn).toBe('2026-09-10')
    expect(serializeTodoFile(next)).toContain('- [x] [due::2026-09-12] [done::2026-09-10] 把季度汇报发给张三\n')
  })

  it('clears [done::] when unchecking an item', () => {
    const file = parseTodoFile(CANONICAL)
    const next = toggleTodo(file, 1, false, '2026-09-10')
    expect(next.items[1]?.done).toBe(false)
    expect(next.items[1]?.doneOn).toBeUndefined()
    expect(next.items[1]?.due).toBe('2026-09-10')
    expect(serializeTodoFile(next)).toContain('- [ ] [due::2026-09-10] 已完成的事\n')
  })

  it('rejects a malformed completion date and an out-of-range index', () => {
    const file = parseTodoFile(CANONICAL)
    expect(() => toggleTodo(file, 0, true, '今天')).toThrow(/完成日期必须是 YYYY-MM-DD/)
    expect(() => toggleTodo(file, -1, true, '2026-09-10')).toThrow(/待办序号越界/)
  })
})
