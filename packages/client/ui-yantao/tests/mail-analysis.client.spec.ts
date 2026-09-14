import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { SessionRemote } from '../src/client/remote.ts'
import {
  mailPrompt, parseAnalysis, runMailAnalysis,
  type AnalysisProgress, type MailAnalysis, type MailPerson,
} from '../src/client/mail-analysis.ts'
import { analysisToProposal } from '../src/client/proposal.ts'

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
    toMe: 'to',
    ...overrides,
  }
}

/** A session namespace that answers `answer` and records every prompt it was asked. */
function fakeSession(answer: string | ((turn: number) => string)): {
  session: SessionRemote
  asked: { title?: string; prompts: readonly string[] }
} {
  const prompts: string[] = []
  let turn = 0
  const session = {
    create: async () => ({ ok: true, value: { sessionId: SESSION } }),
    rename: async (args: { title: string }) => ({ ok: true, value: { title: args.title, seq: 1 } }),
    prompt: async (args: { content: readonly { text?: string }[] }) => {
      prompts.push(args.content.map(part => part.text ?? '').join(''))
      turn += 1
      return { ok: true, value: { accepted: true } }
    },
    follow: () => (async function* () {
      yield {
        type: 'event',
        event: {
          type: 'assistant/message',
          seq: 1,
          time: 0,
          data: { message: { content: [{ type: 'text', text: typeof answer === 'function' ? answer(turn) : answer }] } },
        },
      }
      yield {
        type: 'event',
        event: { type: 'turn/end', seq: 2, time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
      }
    })(),
  }
  return { session: session as unknown as SessionRemote, asked: { prompts } }
}

/** A context carrying just the session namespace. */
function ctxWith(session: SessionRemote): Context {
  return { remote: { session } } as unknown as Context
}

const KNOWN = {
  projects: ['飞书迁移'],
  people: [{ name: '李四', relation: 'superior', email: 'lisi@example.com' }, { name: '王五' }],
}

describe('mailPrompt', () => {
  it('states the mail\'s relationship to me without listing other recipients', () => {
    const text = mailPrompt([mail({ senderAddress: 'a@b.com', toMe: 'to' }), mail({ toMe: 'cc' })], KNOWN)
    expect(text).toContain('a@b.com')
    expect(text).toContain('主送我')
    expect(text).toContain('抄送我')
  })

  it('offers the KB\'s own names with their relations, so 上级 is judgeable', () => {
    const text = mailPrompt([mail()], KNOWN)
    expect(text).toContain('飞书迁移')
    expect(text).toContain('李四（superior，<lisi@example.com>）')
    expect(text).toContain('王五')
  })

  it('numbers mails globally across chunks', () => {
    const text = mailPrompt([mail()], KNOWN, 10)
    expect(text).toContain('[11]')
  })

  it('states the three importance tiers and their rules', () => {
    const text = mailPrompt([mail()], KNOWN)
    expect(text).toContain('focus')
    expect(text).toContain('digest')
    expect(text).toContain('normal')
    expect(text).toContain('上级')
  })
})

describe('parseAnalysis', () => {
  const verdict = JSON.stringify({
    verdicts: [
      { mail: 1, importance: 'focus', why: '上级主送，要求周五前答复' },
      { mail: 2, importance: '催办提醒', why: '系统邮催' },
      { mail: 'x', importance: 'normal', why: '没有编号' },
    ],
    people: [{ name: '张三', relation: '合作方', reason: '一起做汇报', email: 'zhangsan@example.com' }],
    todos: [{ title: '发汇报', due: '2026-09-12', body: '给张三' }, { title: '没期限的', due: null, body: '' }],
    projects: [{ name: '飞书迁移', note: '对方确认了时间' }],
    resources: [{ name: '汇报模板', summary: '两句话', mail: 1 }],
  })

  it('reads a fenced JSON block', () => {
    const analysis = parseAnalysis(`看完了。\n\n\`\`\`json\n${verdict}\n\`\`\`\n`)
    expect(analysis.verdicts).toEqual([
      { mail: 1, importance: 'focus', why: '上级主送，要求周五前答复' },
      { mail: 2, importance: 'normal', why: '系统邮催' },
    ])
    expect(analysis.people).toEqual([{
      name: '张三', relation: '合作方', reason: '一起做汇报', email: 'zhangsan@example.com',
    }])
    expect(analysis.todos[0]?.due).toBe('2026-09-12')
    expect(analysis.todos[1]?.due).toBeUndefined()
    expect(analysis.projects[0]?.name).toBe('飞书迁移')
    expect(analysis.resources).toEqual([{ name: '汇报模板', summary: '两句话', mail: 1 }])
  })

  it('reads bare JSON when the model skips the fence', () => {
    expect(parseAnalysis(verdict).todos).toHaveLength(2)
  })

  it('drops rows without a name or title rather than writing junk', () => {
    const analysis = parseAnalysis(JSON.stringify({
      verdicts: [{ mail: 1, importance: 'focus', why: '' }, 'not an object'],
      people: [{ name: '' }, 'not an object', { name: '王五' }],
      todos: [{ body: '没有标题' }],
      projects: 'not an array',
      resources: [],
    }))
    expect(analysis.verdicts).toEqual([{ mail: 1, importance: 'focus', why: '' }])
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
  const verdict = (mail: number): string => JSON.stringify({
    verdicts: [{ mail, importance: 'normal', why: '' }],
    todos: [{ title: `待办 ${mail}`, due: null, body: '' }],
    people: [],
    projects: [],
    resources: [],
  })

  it('names the session after the day, so it can be found again', async () => {
    const { session } = fakeSession(verdict(1))
    const run = await runMailAnalysis({ ctx: ctxWith(session), mails: [mail()], known: KNOWN })
    expect(run.title).toBe(`邮件分析 ${new Date().toISOString().slice(0, 10)}`)
    expect(run.sessionId).toBe(SESSION)
    expect(run.analysis.verdicts[0]?.mail).toBe(1)
    expect(run.analysis.todos[0]?.title).toBe('待办 1')
  })

  it('sends the prompt it built and parses the answer it got', async () => {
    const { session, asked } = fakeSession(verdict(1))
    const run = await runMailAnalysis({ ctx: ctxWith(session), mails: [mail()], known: KNOWN })
    expect(asked.prompts[0]).toContain('季度汇报')
    expect(run.analysis.todos[0]?.title).toBe('待办 1')
  })

  it('walks the batch in chunks of ten, numbering mails globally', async () => {
    const mails = Array.from({ length: 12 }, (_value, index) => mail({ id: `m${index}`, subject: `第 ${index + 1} 封` }))
    const { session, asked } = fakeSession((turn) => {
      const first = turn === 1 ? 1 : 11
      return JSON.stringify({
        verdicts: Array.from({ length: turn === 1 ? 10 : 2 }, (_v, i) => ({ mail: first + i, importance: 'normal', why: '' })),
        people: [], todos: [], projects: [], resources: [],
      })
    })
    const progress: AnalysisProgress[] = []
    const run = await runMailAnalysis({ ctx: ctxWith(session), mails, known: KNOWN, onProgress: p => progress.push(p) })
    expect(asked.prompts).toHaveLength(2)
    expect(asked.prompts[0]).toContain('编号 1 到 10')
    expect(asked.prompts[1]).toContain('编号 11 到 12')
    expect(run.analysis.verdicts).toHaveLength(12)
    expect(run.analysis.verdicts[10]?.mail).toBe(11)
    const answer = progress.filter(entry => entry.stage === 'answer')
    expect(answer.map(entry => entry.done)).toEqual([10, 12])
    expect(answer[1]?.total).toBe(12)
    expect(answer[1]?.verdicts).toHaveLength(12)
  })

  it('reports the host\'s refusal to create a session', async () => {
    const { session } = fakeSession(verdict(1))
    const failing = {
      ...session,
      create: async () => ({ ok: false, error: new Error('没有可用的 agent') }),
    } as unknown as SessionRemote
    await expect(runMailAnalysis({ ctx: ctxWith(failing), mails: [mail()], known: KNOWN }))
      .rejects.toThrow('没有可用的 agent')
  })

  it('reports a session that ends without answering', async () => {
    const { session } = fakeSession(verdict(1))
    const silent = { ...session, follow: () => (async function* () { /* nothing */ })() } as unknown as SessionRemote
    await expect(runMailAnalysis({ ctx: ctxWith(silent), mails: [mail()], known: KNOWN }))
      .rejects.toThrow(/没有给出回答/)
  })

  it('reports a missing session namespace instead of throwing on undefined', async () => {
    await expect(runMailAnalysis({ ctx: {} as Context, mails: [mail()], known: KNOWN }))
      .rejects.toThrow(/session Remote/)
  })
})

describe('analysisToProposal', () => {
  const ENTITIES = {
    projects: ['飞书迁移'],
    people: [],
    files: [{ name: '飞书迁移', path: 'entities/projects/飞书迁移.md' }],
  }
  const MAILS = [
    mail({ senderName: '老板', subject: '周报截止' }),
    mail({ id: 'm2', senderName: '系统', subject: '邮催：请处理工单', toMe: 'cc' as const }),
  ]
  const ANALYSIS: MailAnalysis = {
    verdicts: [
      { mail: 1, importance: 'focus', why: '上级主送，有截止' },
      { mail: 2, importance: 'digest', why: '系统自动邮催' },
    ],
    people: [{ name: '张三', relation: '合作方', reason: '一起做汇报', email: 'zhangsan@example.com' }],
    todos: [{ title: '发汇报', due: '2026-09-12', body: '给张三' }],
    projects: [{ name: '飞书迁移', note: '对方确认了时间' }, { name: '不存在的项目', note: '没有这个项目' }],
    resources: [{ name: '汇报模板', summary: '两句话', mail: 1 }],
  }

  it('maps the four blocks into one flat action list, in a fixed order', () => {
    const proposal = analysisToProposal(ANALYSIS, ENTITIES, '邮件分析 2026-09-10', MAILS)
    expect(proposal.title).toBe('邮件分析 2026-09-10')
    expect(proposal.actions.map(action => action.kind))
      .toEqual(['create-entity', 'add-todo', 'append-log', 'append-log', 'save-resource'])
  })

  it('carries the relation and the sender address into the person action', () => {
    const proposal = analysisToProposal(ANALYSIS, ENTITIES, 't', MAILS)
    expect(proposal.actions[0]).toMatchObject({
      kind: 'create-entity', entityType: 'person', name: '张三', reason: '合作方：一起做汇报',
      email: 'zhangsan@example.com',
    })
  })

  it('resolves project names to paths, keeping the miss with an empty path', () => {
    const proposal = analysisToProposal(ANALYSIS, ENTITIES, 't', MAILS)
    expect(proposal.actions[2]).toMatchObject({
      kind: 'append-log', entityPath: 'entities/projects/飞书迁移.md', entityName: '飞书迁移', text: '对方确认了时间',
    })
    expect(proposal.actions[3]).toMatchObject({ kind: 'append-log', entityPath: '', entityName: '不存在的项目' })
  })

  it('keeps the mail\'s raw body below the distilled points in the resource note', () => {
    const proposal = analysisToProposal(ANALYSIS, ENTITIES, 't', MAILS)
    const action = proposal.actions[4]
    if (action?.kind !== 'save-resource') throw new Error('expected a save-resource action')
    const content = action.content
    expect(content.indexOf('## 要点')).toBeGreaterThan(-1)
    expect(content.indexOf('## 要点')).toBeLessThan(content.indexOf('## 原文'))
    expect(content).toContain('这是正文')
    expect(content).toContain('两句话')
  })

  it('keeps a truncated body with a truncation note', () => {
    const proposal = analysisToProposal(
      { ...ANALYSIS, resources: [{ name: '长文', summary: 's', mail: 1 }] },
      ENTITIES, 't',
      [mail({ body: '长', truncated: true })],
    )
    const action = proposal.actions.find(entry => entry.kind === 'save-resource')
    const content = action?.kind === 'save-resource' ? action.content : ''
    expect(content).toContain('（正文过长，此处截断）')
  })

  it('turns the verdicts into the 重点提醒 and 汇总类 blocks', () => {
    const proposal = analysisToProposal(ANALYSIS, ENTITIES, 't', MAILS)
    expect(proposal.highlights).toEqual([{ sender: '老板', subject: '周报截止', why: '上级主送，有截止' }])
    expect(proposal.digest).toEqual([{ sender: '系统', subject: '邮催：请处理工单', why: '系统自动邮催' }])
  })

  it('carries no highlight blocks when nothing was flagged', () => {
    const proposal = analysisToProposal(
      { ...ANALYSIS, verdicts: [{ mail: 1, importance: 'normal', why: '' }] },
      ENTITIES, 't', MAILS,
    )
    expect(proposal.highlights).toBeUndefined()
    expect(proposal.digest).toBeUndefined()
  })
})
