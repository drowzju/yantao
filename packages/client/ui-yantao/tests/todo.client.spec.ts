import { describe, expect, it } from 'vitest'
import { appendTodo, parseTodos, toggleTodo } from '../src/client/todo.ts'

/** A todo file shaped exactly like the KB's singleton template. */
const file = [
  '---',
  'type: todo',
  'created: 2026-09-08',
  '---',
  '',
  '- [ ] 写下第一个待办',
  '- [x] 已经做掉的',
  '',
].join('\n')

describe('parseTodos', () => {
  it('reads every checkbox row and ignores the frontmatter', () => {
    expect(parseTodos(file)).toEqual([
      { line: 5, done: false, text: '写下第一个待办' },
      { line: 6, done: true, text: '已经做掉的' },
    ])
  })

  it('tolerates an uppercase X and indented rows; answers none for a file without rows', () => {
    expect(parseTodos('- [X] done\n  - [ ] nested')).toEqual([
      { line: 0, done: true, text: 'done' },
      { line: 1, done: false, text: 'nested' },
    ])
    expect(parseTodos('---\ntype: todo\n---\n')).toEqual([])
  })
})

describe('toggleTodo', () => {
  it('rewrites only the addressed line', () => {
    const next = toggleTodo(file, 5)
    expect(next.split('\n')[5]).toBe('- [x] 写下第一个待办')
    expect(next.split('\n')[6]).toBe('- [x] 已经做掉的')
    expect(next.split('\n').slice(0, 5)).toEqual(file.split('\n').slice(0, 5))
  })

  it('unchecks a done row and leaves a non-row line alone', () => {
    expect(toggleTodo(file, 6).split('\n')[6]).toBe('- [ ] 已经做掉的')
    expect(toggleTodo(file, 1)).toBe(file)
    expect(toggleTodo(file, 99)).toBe(file)
  })
})

describe('appendTodo', () => {
  it('appends an unchecked row, keeping a trailing newline', () => {
    expect(appendTodo(file, '新待办').endsWith('- [ ] 新待办\n')).toBe(true)
    expect(appendTodo(file, '新待办').startsWith(file)).toBe(true)
  })

  it('closes a file that does not end in a newline', () => {
    expect(appendTodo('- [ ] a', 'b')).toBe('- [ ] a\n- [ ] b\n')
    expect(appendTodo('', 'b')).toBe('- [ ] b\n')
  })
})
