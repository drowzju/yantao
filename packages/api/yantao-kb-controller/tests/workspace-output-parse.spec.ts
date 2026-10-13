/**
 * Unit tests for the line-wise stream parser (output-parse.ts).
 *
 * The contract is `codebuddy -p --output-format stream-json`: newline-
 * delimited JSON, one event per line, arriving live. The parser must deliver
 * every event through onEvent as its line completes, keep only the latest
 * result event, and survive hostile input — lines split across chunks
 * (including inside UTF-8 multibyte sequences), garbage lines, blank lines,
 * an over-cap line, and a final line without its newline.
 */
import { describe, expect, it } from 'vitest'
import { CodebuddyOutputParser } from '../src/workspace/output-parse.ts'

const EVENTS = [
  { type: 'system', subtype: 'init', session_id: 'sessX' },
  { type: 'assistant', message: { content: [{ type: 'text', text: '正文' }] } },
  { type: 'result', subtype: 'success', is_error: false, result: '答', session_id: 'sessX' },
]

function ndjson(events: readonly unknown[]): string {
  return `${events.map(event => JSON.stringify(event)).join('\n')}\n`
}

describe('CodebuddyOutputParser (stream-json NDJSON)', () => {
  it('hands every parsed line to onEvent as it completes and keeps the last result', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    parser.feed(Buffer.from(ndjson(EVENTS), 'utf8'))
    expect(parser.finish()).toEqual({ ok: true, event: { result: '答', sessionId: 'sessX', isError: false } })
    expect(events).toHaveLength(3)
    expect((events[0] as { type?: string }).type).toBe('system')
    expect((events[1] as { message?: { content: unknown[] } }).message?.content).toHaveLength(1)
    expect((events[2] as { type?: string }).type).toBe('result')
  })

  it('maps snake_case result fields (session_id, is_error) to the step contract', () => {
    const parser = new CodebuddyOutputParser()
    parser.feed(Buffer.from(`${JSON.stringify({ type: 'result', result: '砸了', is_error: true, session_id: 'sessE' })}\n`, 'utf8'))
    expect(parser.finish()).toEqual({ ok: true, event: { result: '砸了', sessionId: 'sessE', isError: true } })
  })

  it('reassembles a line split across chunks, byte by byte', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    const raw = Buffer.from(ndjson([{ type: 'assistant', message: { content: [{ type: 'text', text: '拆开的行' }] } }, { type: 'result', result: '终', is_error: false }]), 'utf8')
    for (let i = 0; i < raw.length; i += 1) parser.feed(raw.subarray(i, i + 1))
    expect(events).toHaveLength(2)
    expect((events[0] as { message?: { content: { text?: string }[] } }).message?.content[0]?.text).toBe('拆开的行')
    expect(parser.finish()).toEqual({ ok: true, event: { result: '终', isError: false } })
  })

  it('parses several complete lines inside one chunk and holds the trailing partial', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    const raw = ndjson([
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: '其一' }] } },
      { type: 'result', result: '终', is_error: false },
    ])
    const cut = raw.length - 10
    parser.feed(Buffer.from(raw.slice(0, cut), 'utf8'))
    expect(events).toHaveLength(2) // the result line is still partial
    parser.feed(Buffer.from(raw.slice(cut), 'utf8'))
    expect(events).toHaveLength(3)
    expect(parser.finish()).toEqual({ ok: true, event: { result: '终', isError: false } })
  })

  it('accepts a final line without its trailing newline', () => {
    const parser = new CodebuddyOutputParser()
    parser.feed(Buffer.from(JSON.stringify({ type: 'result', result: '无换行结尾', is_error: false }), 'utf8'))
    expect(parser.finish()).toEqual({ ok: true, event: { result: '无换行结尾', isError: false } })
  })

  it('skips blank lines, whitespace lines, and a BOM; events still land', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    parser.feed(Buffer.from('\uFEFF\n\n   \n' + `${JSON.stringify({ type: 'result', result: '净', is_error: false })}\n`, 'utf8'))
    expect(events).toHaveLength(1)
    expect(parser.finish()).toEqual({ ok: true, event: { result: '净', isError: false } })
  })

  it('skips a garbage line without losing line sync — later lines still parse', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    parser.feed(Buffer.from([
      '这不是 json',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '还行' }] } }),
      JSON.stringify({ type: 'result', result: '救回来了', is_error: false }),
    ].join('\n') + '\n', 'utf8'))
    expect(events).toHaveLength(2)
    expect(parser.finish()).toEqual({ ok: true, event: { result: '救回来了', isError: false } })
  })

  it('reports 不是合法 JSON when every line is garbage', () => {
    const parser = new CodebuddyOutputParser()
    parser.feed(Buffer.from('这不是 json\n这也不是\n', 'utf8'))
    const settled = parser.finish()
    expect(settled.ok).toBe(false)
    if (!settled.ok) expect(settled.error).toContain('不是合法 JSON')
  })

  it('reports 没有任何输出 for an empty stream', () => {
    const parser = new CodebuddyOutputParser()
    expect(parser.finish()).toEqual({ ok: false, error: 'codebuddy 没有任何输出' })
  })

  it('reports 缺少 result 字段 when events arrived but no result line did', () => {
    const parser = new CodebuddyOutputParser()
    parser.feed(Buffer.from(`${JSON.stringify({ type: 'system', subtype: 'init' })}\n`, 'utf8'))
    expect(parser.finish()).toEqual({ ok: false, error: 'codebuddy 输出缺少 result 字段' })
  })

  it('drops an over-cap line but keeps parsing the result line after it', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    const giant = { type: 'assistant', message: { content: [{ type: 'text', text: '巨'.repeat(17 * 1024 * 1024) }] } }
    parser.feed(Buffer.from(`${JSON.stringify(giant)}\n${JSON.stringify({ type: 'result', result: '幸存', is_error: false })}\n`, 'utf8'))
    expect(events).toHaveLength(1) // the giant line never reaches onEvent
    expect(parser.finish()).toEqual({ ok: true, event: { result: '幸存', isError: false } })
  })

  it('tolerates UTF-8 multibyte sequences split across chunk borders (stride 3)', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    const raw = Buffer.from(ndjson([
      { type: 'assistant', message: { content: [{ type: 'text', text: '多字节切分的中文与 emoji 🙂' }] } },
      { type: 'result', result: '完', is_error: false },
    ]), 'utf8')
    for (let i = 0; i < raw.length; i += 3) parser.feed(raw.subarray(i, Math.min(i + 3, raw.length)))
    expect((events[0] as { message?: { content: { text?: string }[] } }).message?.content[0]?.text).toBe('多字节切分的中文与 emoji 🙂')
    expect(parser.finish()).toEqual({ ok: true, event: { result: '完', isError: false } })
  })

  it('keeps prose containing newlines inside one physical line (JSON-encoded)', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    parser.feed(Buffer.from(ndjson([
      { type: 'assistant', message: { content: [{ type: 'text', text: '第一行\n第二行' }] } },
      { type: 'result', result: '完', is_error: false },
    ]), 'utf8'))
    expect(events).toHaveLength(2)
    expect((events[0] as { message?: { content: { text?: string }[] } }).message?.content[0]?.text).toBe('第一行\n第二行')
    expect(parser.finish()).toEqual({ ok: true, event: { result: '完', isError: false } })
  })
})
