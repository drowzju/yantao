import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { SessionRemote } from '../src/client/remote.ts'
import { mailPrompt, parseAnalysis, runMailAnalysis, type MailPerson } from '../src/client/mail-analysis.ts'

const SESSION = 'session-1'

function mail(overrides: Partial<KbMailMessage> = {}): KbMailMessage {
  return {
    id: 'sha1',
    entryId: 'entry',
    receivedAt: '2026-09-09T10:00:00+00:00',
    senderName: '张三',
    senderAddress: 'zhangsan@example.com',
    subject: '季度汇报',
    body: '这是正文',
    truncated: false,
    ...overrides,
  }
}

/** A session namespace that answers `answer` and records what it was asked. */
function fakeSession(answer: string): { session: SessionRemote; asked: { title?: string; text?: string } } {
  const asked: { title?: string; text?: string } = {}
  const session = {
    create: async () => ({ ok: true, value: { sessionId: SESSION } }),
    rename: async (args: { title: string }) => {
      asked.title = args.title
      return { ok: true, value: { title: args.title, seq: 1 } }
    },
    prompt: async (args: { content: readonly { text?: string }[] }) => {
      asked.text = args.content.map(part => part.text ?? '').join('')
      return { ok: true, value: { accepted: true } }
    },
    follow: () => (async function* () {
      yield {
        type: 'event',
        event: {
          type: 'assistant/message',
          seq: 1,
          time: 0,
          data: { message: { content: [{ type: 'text', text: answer }] } },
        },
      }
    })(),
  }
  return { session: session as unknown as SessionRemote, asked }
}

/** A context carrying just the session namespace. */
function ctxWith(session: SessionRemote): Context {
  return { remote: { session } } as unknown as Context
}

const KNOWN = { projects: ['飞书迁移'], people: ['李四'] }

describe('mailPrompt', () => {
  it('shows no CC and no recipient list — only what judges importance', () => {
    const text = mailPrompt([mail({ senderAddress: 'a@b.com' })], KNOWN)
    expect(text).toContain('a@b.com')
    expect(text).not.toContain('抄送')
  })

  it('offers the KB\'s own names so the model matches instead of inventing', () => {
    const text = mailPrompt([mail()], KNOWN)
    expect(text).toContain('飞书迁移')
    expect(text).toContain('李四')
  })
})

describe('parseAnalysis', () => {
  const verdict = JSON.stringify({
    people: [{ name: '张三', relation: '合作方', reason: '一起做汇报' }],
    todos: [{ title: '发汇报', due: '2026-09-12', body: '给张三' }, { title: '没期限的', due: null, body: '' }],
    projects: [{ name: '飞书迁移', note: '对方确认了时间' }],
    resources: [{ name: '汇报模板', summary: '两句话' }],
  })

  it('reads a fenced JSON block', () => {
    const analysis = parseAnalysis(`看完了。\n\n\`\`\`json\n${verdict}\n\`\`\`\n`)
    expect(analysis.people).toEqual([{ name: '张三', relation: '合作方', reason: '一起做汇报' }])
    expect(analysis.todos[0]?.due).toBe('2026-09-12')
    expect(analysis.todos[1]?.due).toBeUndefined()
    expect(analysis.projects[0]?.name).toBe('飞书迁移')
    expect(analysis.resources).toHaveLength(1)
  })

  it('reads bare JSON when the model skips the fence', () => {
    expect(parseAnalysis(verdict).todos).toHaveLength(2)
  })

  it('drops rows without a name or title rather than writing junk', () => {
    const analysis = parseAnalysis(JSON.stringify({
      people: [{ name: '' }, 'not an object', { name: '王五' }],
      todos: [{ body: '没有标题' }],
      projects: 'not an array',
      resources: [],
    }))
    expect(analysis.people.map((person: MailPerson) => person.name)).toEqual(['王五'])
    expect(analysis.todos).toEqual([])
    expect(analysis.projects).toEqual([])
  })

  it('refuses a date it cannot read instead of writing a corrupt one', () => {
    const analysis = parseAnalysis(JSON.stringify({ todos: [{ title: 'x', due: '下周三' }] }))
    expect(analysis.todos[0]?.due).toBeUndefined()
  })

  it('says the model did not answer rather than returning an empty verdict', () => {
    expect(() => parseAnalysis('我觉得这些邮件都不重要。')).toThrow(/JSON/)
  })
})

describe('runMailAnalysis', () => {
  const answer = JSON.stringify({ todos: [{ title: '发汇报', due: null, body: '' }], people: [], projects: [], resources: [] })

  it('names the session after the day, so it can be found again', async () => {
    const { session, asked } = fakeSession(answer)
    const run = await runMailAnalysis({ ctx: ctxWith(session), mails: [mail()], known: KNOWN })
    expect(asked.title).toBe(`邮件分析 ${new Date().toISOString().slice(0, 10)}`)
    expect(run.title).toBe(asked.title)
    expect(run.sessionId).toBe(SESSION)
  })

  it('sends the prompt it built and parses the answer it got', async () => {
    const { session, asked } = fakeSession(answer)
    const run = await runMailAnalysis({ ctx: ctxWith(session), mails: [mail()], known: KNOWN })
    expect(asked.text).toContain('季度汇报')
    expect(run.analysis.todos[0]?.title).toBe('发汇报')
  })

  it('reports the host\'s refusal to create a session', async () => {
    const { session } = fakeSession(answer)
    const failing = {
      ...session,
      create: async () => ({ ok: false, error: new Error('没有可用的 agent') }),
    } as unknown as SessionRemote
    await expect(runMailAnalysis({ ctx: ctxWith(failing), mails: [mail()], known: KNOWN }))
      .rejects.toThrow('没有可用的 agent')
  })

  it('reports a session that ends without answering', async () => {
    const { session } = fakeSession(answer)
    const silent = { ...session, follow: () => (async function* () { /* nothing */ })() } as unknown as SessionRemote
    await expect(runMailAnalysis({ ctx: ctxWith(silent), mails: [mail()], known: KNOWN }))
      .rejects.toThrow(/没有给出回答/)
  })

  it('reports a missing session namespace instead of throwing on undefined', async () => {
    await expect(runMailAnalysis({ ctx: {} as Context, mails: [mail()], known: KNOWN }))
      .rejects.toThrow(/session Remote/)
  })
})
