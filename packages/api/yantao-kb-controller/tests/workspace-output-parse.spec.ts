/**
 * Unit tests for the incremental codebuddy-output extractor (output-parse.ts).
 *
 * The 2026-10-12 incident this suite pins down: a 2h10m 定时 review session
 * produced an event array that blew past the runtime's old 1 MiB stdout cap;
 * the silently-truncated buffer failed the old whole-stream JSON.parse and a
 * successful run was recorded as "codebuddy 输出不是合法 JSON". These tests
 * pin the extractor's promises: boundary-sync survives oversized elements,
 * the closing bracket is not load-bearing, and UTF-8 splits across chunks
 * decode correctly.
 */
import { describe, expect, it } from 'vitest'
import { CodebuddyOutputParser } from '../src/workspace/output-parse.ts'

/** Feed one string as a single buffer and settle. */
function parseOnce(raw: string) {
  const parser = new CodebuddyOutputParser()
  parser.feed(Buffer.from(raw, 'utf8'))
  return parser.finish()
}

describe('CodebuddyOutputParser', () => {
  it('extracts the result event from the real event-array contract', () => {
    const raw = JSON.stringify([
      { type: 'system', subtype: 'init', session_id: 'sess0' },
      { type: 'assistant', message: { content: [{ type: 'text', text: '干完了' }] } },
      { type: 'result', result: '# review 完成\n\n全部通过', session_id: 'sess0', is_error: false },
    ])
    expect(parseOnce(raw)).toEqual({
      ok: true,
      event: { result: '# review 完成\n\n全部通过', sessionId: 'sess0', isError: false },
    })
  })

  it('extracts the legacy single-object shape', () => {
    expect(parseOnce(JSON.stringify({ result: '答案', session_id: 'sess9' }))).toEqual({
      ok: true,
      event: { result: '答案', sessionId: 'sess9', isError: false },
    })
  })

  it('passes is_error through for the runtime to report', () => {
    const raw = JSON.stringify([{ type: 'result', result: '模型额度耗尽', is_error: true }])
    expect(parseOnce(raw)).toEqual({ ok: true, event: { result: '模型额度耗尽', isError: true } })
  })

  it('settles a stream truncated after the result event — the closing ] is not load-bearing', () => {
    // The 2026-10-12 incident shape: the tail of the array is chopped off.
    const raw = '[{"type":"system"},{"type":"result","result":"晚上的审查结论","session_id":"s1","is_error":false},{"type":"hist'
    expect(parseOnce(raw)).toEqual({
      ok: true,
      event: { result: '晚上的审查结论', sessionId: 's1', isError: false },
    })
  })

  it('skips an over-cap element without losing boundary sync — the result after it still lands', () => {
    // 16 MiB + slack of filler text inside one element; the parser drops the
    // text but keeps walking, so the result event after it still parses.
    const giant = 'x'.repeat(17 * 1024 * 1024)
    const raw = JSON.stringify([
      { type: 'snapshot', blob: giant },
      { type: 'result', result: '仍在', session_id: 's2', is_error: false },
    ])
    expect(parseOnce(raw)).toEqual({
      ok: true,
      event: { result: '仍在', sessionId: 's2', isError: false },
    })
  })

  it('decodes UTF-8 multibyte characters split across chunk boundaries', () => {
    const raw = JSON.stringify([{ type: 'result', result: '中文结果——破折号与引号"都在"', is_error: false }])
    const bytes = Buffer.from(raw, 'utf8')
    const parser = new CodebuddyOutputParser()
    // Cut through the middle of every multibyte sequence: stride 3 bytes.
    for (let i = 0; i < bytes.length; i += 3) parser.feed(bytes.subarray(i, Math.min(i + 3, bytes.length)))
    expect(parser.finish()).toEqual({
      ok: true,
      event: { result: '中文结果——破折号与引号"都在"', isError: false },
    })
  })

  it('tracks element boundaries through escaped quotes and braces inside strings', () => {
    const tricky = '文本里有 "} 和 \\{ { 不是边界'
    const raw = JSON.stringify([
      { type: 'note', text: tricky },
      { type: 'result', result: tricky, is_error: false },
    ])
    expect(parseOnce(raw)).toEqual({ ok: true, event: { result: tricky, isError: false } })
  })

  it('reports an empty stream as no output', () => {
    expect(parseOnce('')).toEqual({ ok: false, error: 'codebuddy 没有任何输出' })
  })

  it('reports an array without a result event as missing result', () => {
    const raw = JSON.stringify([{ type: 'system' }, { type: 'assistant' }])
    expect(parseOnce(raw)).toEqual({ ok: false, error: 'codebuddy 输出缺少 result 字段' })
  })

  it('reports pure garbage with a head clip for diagnostics', () => {
    const output = parseOnce('这不是 json')
    expect(output.ok).toBe(false)
    if (output.ok) return
    expect(output.error).toContain('不是合法 JSON')
    expect(output.error).toContain('这不是 json')
  })

  it('tolerates a BOM and leading whitespace before the document', () => {
    const raw = `\uFEFF  ${JSON.stringify([{ type: 'result', result: 'ok', is_error: false }])}`
    expect(parseOnce(raw)).toEqual({ ok: true, event: { result: 'ok', isError: false } })
  })

  it('feeds many small chunks — element state carries across feed calls', () => {
    const raw = JSON.stringify([{ type: 'result', result: '跨块', session_id: 's3', is_error: false }])
    const parser = new CodebuddyOutputParser()
    for (const byte of Buffer.from(raw, 'utf8')) parser.feed(Buffer.from([byte]))
    expect(parser.finish()).toEqual({
      ok: true,
      event: { result: '跨块', sessionId: 's3', isError: false },
    })
  })

  it('hands every parsed element to onEvent as it completes', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    parser.feed(Buffer.from(JSON.stringify([
      { type: 'system', subtype: 'init' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '正文' }] },
      { type: 'result', result: '答', is_error: false },
    ]), 'utf8'))
    expect(parser.finish()).toEqual({ ok: true, event: { result: '答', isError: false } })
    expect(events).toHaveLength(3)
    expect((events[0] as { type?: string }).type).toBe('system')
    expect((events[1] as { role?: string }).role).toBe('assistant')
    expect((events[2] as { type?: string }).type).toBe('result')
  })

  it('never invokes onEvent for legacy single-object output — there is no process to distill', () => {
    const events: unknown[] = []
    const parser = new CodebuddyOutputParser({ onEvent: (event) => { events.push(event) } })
    parser.feed(Buffer.from(JSON.stringify({ result: '单对象', session_id: 's4' }), 'utf8'))
    expect(parser.finish()).toEqual({ ok: true, event: { result: '单对象', sessionId: 's4', isError: false } })
    expect(events).toHaveLength(0)
  })
})
