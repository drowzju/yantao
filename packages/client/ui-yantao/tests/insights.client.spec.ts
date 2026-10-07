/**
 * Unit pins for the 洞察 dashboard's pure shaping (ADR-0050): which events
 * earn a trend step, which surface in the feed, how tool calls land in the
 * file-activity buckets, and where the line deltas come from.
 * @module @deepseek-ai/dsh-client-ui-yantao/insights.spec
 */
import { describe, expect, it } from 'vitest'
import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import { feedFromEvents, fileActivityFromEvents, stepsFromEvents } from '../src/client/insights.ts'

/** One wire event with the fields the shapers read; the rest is scaffolding. */
function event(type: string, seq: number, data: Record<string, unknown>): SessionWireEvent {
  return { type, seq, time: 0, data } as SessionWireEvent
}

describe('stepsFromEvents', () => {
  it('books one step per usage-reporting assistant message, with the enclosing turn', () => {
    const steps = stepsFromEvents([
      event('turn/start', 1, { turn: 0 }),
      event('assistant/message', 2, {
        message: { content: [{ type: 'text', text: 'a' }] },
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 60, cacheWriteTokens: 20 },
      }),
      event('turn/start', 3, { turn: 1 }),
      event('assistant/message', 4, { message: { content: [] }, usage: { inputTokens: 200, outputTokens: 30 } }),
      // No usage reported — not a billable step.
      event('assistant/message', 5, { message: { content: [{ type: 'text', text: 'c' }] } }),
      event('tool/call', 6, { callId: 'c1', name: 'read', arguments: '{}' }),
    ])
    expect(steps).toEqual([
      { seq: 2, turn: 0, inputTokens: 100, outputTokens: 10, cacheReadTokens: 60, cacheWriteTokens: 20 },
      { seq: 4, turn: 1, inputTokens: 200, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
  })

  it('ignores malformed usage envelopes', () => {
    const steps = stepsFromEvents([
      event('assistant/message', 1, { message: { content: [] }, usage: { inputTokens: 'x' } }),
      event('assistant/message', 2, { message: { content: [] } }),
      event('assistant/message', 3, { usage: null }),
    ])
    expect(steps).toEqual([])
  })
})

describe('feedFromEvents', () => {
  it('surfaces injections, compactions and model selections in order; skips the human\'s own prompts', () => {
    const feed = feedFromEvents([
      event('turn/start', 1, { turn: 1 }),
      event('user/message', 2, { content: [{ type: 'text', text: 'typed' }], source: { kind: 'user' } }),
      event('user/message', 3, { content: [{ type: 'text', text: '<skill>正文</skill>' }], source: { kind: 'skill' } }),
      event('assistant/message', 4, { message: { content: [] }, usage: { inputTokens: 1, outputTokens: 1 } }),
      event('compaction/summary', 5, { compactionId: 'k1', summary: 'so far…', shadowedTokenCount: 4_321 }),
      event('model/selection', 6, { provider: 'gateway', model: 'glm-5.1', reasoningEffort: 'high' }),
      event('tool/call', 7, { callId: 'c1', name: 'read', arguments: '{}' }),
    ])
    expect(feed).toEqual([
      { kind: 'injection', seq: 3, turn: 1, text: '<skill>正文</skill>' },
      { kind: 'compaction', seq: 5, turn: 1, shadowedTokenCount: 4_321, summary: 'so far…' },
      { kind: 'model', seq: 6, turn: 1, provider: 'gateway', model: 'glm-5.1' },
    ])
  })

  it('keeps a compaction without a shadowed figure and drops an anonymous model selection', () => {
    const feed = feedFromEvents([
      // The compaction types carry the summary as a content-block array…
      event('compaction/summary', 1, { summary: [{ type: 'text', text: '压缩了历史' }] }),
      event('model/selection', 2, {}),
    ])
    expect(feed).toEqual([
      { kind: 'compaction', seq: 1, turn: 0, shadowedTokenCount: null, summary: '压缩了历史' },
    ])
  })
})

describe('fileActivityFromEvents', () => {
  it('classifies the kb_* family into the four buckets and totals the line deltas', () => {
    const files = fileActivityFromEvents([
      event('tool/call', 1, { callId: 'a', name: 'kb_read_entity', arguments: '{"type":"项目"}' }),
      event('tool/call', 2, { callId: 'b', name: 'kb_list_entities', arguments: '{}' }),
      event('tool/call', 3, { callId: 'c', name: 'kb_write_resource', arguments: '{"path":"resources/x.md","content":"一\\n二\\n三"}' }),
      event('tool/call', 4, { callId: 'd', name: 'kb_edit_section', arguments: '{"entity":"p","section":"动态","text":"one\\ntwo"}' }),
      event('tool/call', 5, { callId: 'e', name: 'grep', arguments: '{"pattern":"x"}' }),
      event('tool/call', 6, { callId: 'f', name: 'str_replace_editor', arguments: '{"command":"str_replace","old_str":"a","new_str":"a\\nb"}' }),
      event('tool/call', 7, { callId: 'g', name: 'kb_propose_memory', arguments: '{}' }),
      // Results never contribute — only the call arguments do.
      event('tool/result', 8, { callId: 'a', message: { content: [{ type: 'text', text: 'huge result' }] } }),
    ])
    expect(files).toEqual({
      read: 1, write: 1, edit: 2, search: 2,
      linesAdded: 3 + 2 + 2, // write content + section text + editor new_str
      linesRemoved: 1, // editor old_str
    })
  })

  it('falls back to name substrings for unknown tools and ignores the rest', () => {
    const files = fileActivityFromEvents([
      event('tool/call', 1, { callId: 'a', name: 'web_find_page', arguments: '{}' }),
      event('tool/call', 2, { callId: 'b', name: 'ask_human', arguments: '{}' }),
    ])
    expect(files).toEqual({ read: 0, write: 0, edit: 0, search: 1, linesAdded: 0, linesRemoved: 0 })
  })

  it('tolerates unparseable arguments without losing the count', () => {
    const files = fileActivityFromEvents([
      event('tool/call', 1, { callId: 'a', name: 'kb_write_resource', arguments: '{broken json' }),
    ])
    expect(files).toEqual({ read: 0, write: 1, edit: 0, search: 0, linesAdded: 0, linesRemoved: 0 })
  })
})
