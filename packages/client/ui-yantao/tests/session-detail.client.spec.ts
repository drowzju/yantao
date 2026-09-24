import { describe, expect, it } from 'vitest'
import type { SessionPage, SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionRemote } from '../src/client/remote.ts'
import { detailFromEvents, loadSessionDetail } from '../src/client/session-detail.ts'

/** One durable event, shaped like the wire journal's. */
function event(type: string, seq: number, data: Record<string, unknown>): SessionWireEvent {
  return { type, seq, time: 0, data } as SessionWireEvent
}

describe('detailFromEvents', () => {
  it('shapes user prompts, assistant replies, and pairs tool calls with their results', () => {
    const items = detailFromEvents([
      event('turn/start', 1, { turn: 0 }),
      event('user/message', 2, { content: [{ type: 'text', text: '帮我提炼这份纪要' }], source: { kind: 'user' } }),
      event('tool/call', 3, { callId: 'c1', name: 'kb_read', arguments: '{"path":"a.md"}' }),
      event('tool/result', 4, { callId: 'c1', message: { content: [{ type: 'text', text: '# 内容' }] } }),
      event('assistant/message', 5, { message: { content: [{ type: 'text', text: '提炼完成' }] } }),
    ])
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ kind: 'user', text: '帮我提炼这份纪要', injected: false, turn: 0 })
    expect(items[1]).toMatchObject({ kind: 'tool', name: 'kb_read', args: '{"path":"a.md"}', result: '# 内容', error: null })
    expect(items[2]).toMatchObject({ kind: 'assistant', text: '提炼完成', turn: 0 })
  })

  it('marks non-human user messages as injected', () => {
    const items = detailFromEvents([
      event('user/message', 1, { content: [{ type: 'text', text: '<skill>正文</skill>' }], source: { kind: 'skill' } }),
    ])
    expect(items[0]).toMatchObject({ kind: 'user', injected: true })
  })

  it('keeps a tool call without its result as pending, and carries the error identity', () => {
    const items = detailFromEvents([
      event('tool/call', 1, { callId: 'c1', name: 'kb_write', arguments: '{}' }),
      event('tool/result', 2, { callId: 'c1', message: { content: [] }, error: { name: '冲突', code: 'conflict' } }),
      event('tool/call', 3, { callId: 'c2', name: 'kb_tree', arguments: '{}' }),
    ])
    expect(items[0]).toMatchObject({ kind: 'tool', result: '', error: '冲突(conflict)' })
    expect(items[1]).toMatchObject({ kind: 'tool', result: null, error: null })
  })

  it('skips scaffolding: empty assistant steps, unknown events, turn brackets', () => {
    const items = detailFromEvents([
      event('turn/start', 1, { turn: 0 }),
      event('assistant/message', 2, { message: { content: [{ type: 'text', text: '' }] } }),
      event('step/start', 3, { step: 1 }),
      event('turn/end', 4, { turn: 0, reason: { kind: 'completed' } }),
      event('user/message', 5, { content: [{ type: 'text', text: '问' }], source: { kind: 'user' } }),
    ])
    expect(items.map(item => item.kind)).toEqual(['user'])
  })

  it('clips oversized texts with the truncation mark', () => {
    const long = 'x'.repeat(17_000)
    const items = detailFromEvents([
      event('user/message', 1, { content: [{ type: 'text', text: long }], source: { kind: 'user' } }),
      event('tool/call', 2, { callId: 'c', name: 'n', arguments: 'y'.repeat(5000) }),
    ])
    expect(items[0]).toMatchObject({ kind: 'user' })
    expect((items[0] as { text: string }).text.endsWith('（过长，已截断）')).toBe(true)
    expect((items[1] as { args: string }).args.endsWith('（过长，已截断）')).toBe(true)
  })
})

/** A follow that yields one snapshot then ends; records what the opener did. */
function fakeRemote(options: {
  snapshot: { cursor: number; events: SessionWireEvent[]; hasMore: boolean }
  pages?: readonly SessionPage[]
}): {
  remote: SessionRemote
  pageRequests: { throughSeq: number; beforeSeq?: number; maxMessages?: number }[]
  openerAborted: () => boolean
} {
  const pageRequests: { throughSeq: number; beforeSeq?: number; maxMessages?: number }[] = []
  let openerAbortedFlag = false
  const remote = {
    follow: (_args: unknown, signal?: AbortSignal) => (async function* () {
      signal?.addEventListener('abort', () => { openerAbortedFlag = true }, { once: true })
      yield {
        type: 'snapshot',
        header: { version: 2, id: 's', createdAt: 0, isSeeded: false },
        cursor: options.snapshot.cursor,
        records: options.snapshot.events.map(evt => ({ type: 'event' as const, event: evt })),
        hasMore: options.snapshot.hasMore,
        projections: {},
      }
    })(),
    page: async (request: { throughSeq: number; beforeSeq?: number; maxMessages?: number }) => {
      pageRequests.push(request)
      const page = options.pages?.[pageRequests.length - 1]
      if (page === undefined) return { ok: false as const, error: new Error('no page') }
      return { ok: true as const, value: page }
    },
  }
  return { remote: remote as unknown as SessionRemote, pageRequests, openerAborted: () => openerAbortedFlag }
}

describe('loadSessionDetail', () => {
  it('takes the follow snapshot, abandons the stream, and pages backwards while older history remains', async () => {
    const older = [
      event('user/message', 1, { content: [{ type: 'text', text: '最早的提问' }], source: { kind: 'user' } }),
    ]
    const newer = [
      event('user/message', 2, { content: [{ type: 'text', text: '后来的提问' }], source: { kind: 'user' } }),
      event('assistant/message', 3, { message: { content: [{ type: 'text', text: '答' }] } }),
    ]
    const { remote, pageRequests, openerAborted } = fakeRemote({
      snapshot: { cursor: 3, events: newer, hasMore: true },
      pages: [{ records: older.map(evt => ({ type: 'event' as const, event: evt })), hasMore: false }],
    })
    const items = await loadSessionDetail(remote, 's1')
    expect(openerAborted()).toBe(true)
    expect(pageRequests).toEqual([
      { address: { kind: 'session', sessionId: 's1' }, throughSeq: 3, beforeSeq: 2, maxMessages: 200 },
    ])
    expect(items.map(item => (item as { text?: string }).text)).toEqual(['最早的提问', '后来的提问', '答'])
  })

  it('stops paging when the snapshot says the window is the whole log', async () => {
    const { remote, pageRequests } = fakeRemote({
      snapshot: {
        cursor: 1,
        events: [event('user/message', 1, { content: [{ type: 'text', text: '唯一一条' }], source: { kind: 'user' } })],
        hasMore: false,
      },
    })
    const items = await loadSessionDetail(remote, 's1')
    expect(pageRequests).toEqual([])
    expect(items).toHaveLength(1)
  })

  it('renders nothing for a session whose log is empty', async () => {
    const { remote } = fakeRemote({ snapshot: { cursor: 0, events: [], hasMore: false } })
    const items = await loadSessionDetail(remote, 's1')
    expect(items).toEqual([])
  })
})
