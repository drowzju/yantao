import { describe, expect, it, vi } from 'vitest'
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
  asked: { titles: readonly string[]; prompts: readonly string[]; cancels: readonly string[] }
} {
  const prompts: string[] = []
  const cancels: string[] = []
  const titles: string[] = []
  let turn = 0
  const session = {
    create: async () => ({ ok: true, value: { sessionId: SESSION } }),
    rename: async (args: { title: string }) => {
      titles.push(args.title)
      return { ok: true, value: { title: args.title, seq: 1 } }
    },
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
    cancel: async (args: { sessionId: string }) => {
      cancels.push(args.sessionId)
      return { ok: true as const, value: { accepted: true } }
    },
  }
  return { session: session as unknown as SessionRemote, asked: { titles, prompts, cancels } }
}

/** A context carrying just the session namespace. */
function ctxWith(session: SessionRemote): Context {
  return { remote: { session } } as unknown as Context
}

const KNOWN = {
  projects: ['飞书迁移'],
  areas: ['协作平台'],
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

  it('lists projects and areas apart, so an area never reads as a project (ADR-0034)', () => {
    const text = mailPrompt([mail()], KNOWN)
    expect(text).toContain('知识库里已有的项目：飞书迁移')
    expect(text).toContain('知识库里已有的领域')
    expect(text).toContain('协作平台')
    expect(text).not.toContain('项目/领域')
  })

  it('marks people without an address, so a name-only match is an honest one (ADR-0034)', () => {
    const text = mailPrompt([mail()], KNOWN)
    expect(text).toContain('王五（无邮箱）')
  })

  it('wraps every mail body in the untrusted-data fence with a standing disclaimer (ADR-0034)', () => {
    const text = mailPrompt([mail()], KNOWN)
    expect(text).toContain('<<<邮件正文·开始>>>\n这是正文\n<<<邮件正文·结束>>>')
    expect(text).toContain('不可信数据')
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

  it('states focus as a conjunction and carves out security alerts (ADR-0034)', () => {
    const text = mailPrompt([mail()], KNOWN)
    expect(text).toContain('同时满足')
    expect(text).toContain('具体人员')
    expect(text).toContain('语义')
    expect(text).toContain('账号安全')
  })

  it('asks for memories as one-sentence corrections or preferences', () => {
    const text = mailPrompt([mail()], KNOWN)
    expect(text).toContain('memories')
    expect(text).toContain('纠正')
  })

  it('leads with the scope\'s behavior memory when one is given (ADR-0032 批次④)', () => {
    const withMemory = mailPrompt([mail()], KNOWN, 0, '【行为记忆】人在以往运行中为「mail」沉淀的规则（历次纠正的累积），本次运行遵守：\n- 汇报先发给直属上级')
    expect(withMemory).toContain('【行为记忆】')
    expect(withMemory).toContain('汇报先发给直属上级')
    expect(withMemory.indexOf('【行为记忆】')).toBeLessThan(withMemory.indexOf('知识库里已有的项目'))

    const without = mailPrompt([mail()], KNOWN)
    expect(without).not.toContain('【行为记忆】')
  })
})

describe('parseAnalysis', () => {
  const verdict = JSON.stringify({
    verdicts: [
      { mail: 1, importance: 'focus', why: '上级主送，要求周五前答复' },
      { mail: 2, importance: '催办提醒', why: '系统邮催' },
      { mail: 'x', importance: 'normal', why: '没有编号' },
    ],
    people: [
      { name: '张三', relation: 'peer', reason: '一起做汇报', email: 'zhangsan@example.com' },
      { name: '钱七', relation: '亲戚', reason: '不在四选一里' },
    ],
    todos: [{ title: '发汇报', due: '2026-09-12', body: '给张三' }, { title: '没期限的', due: null, body: '' }],
    projects: [{ name: '飞书迁移', note: '对方确认了时间' }],
    resources: [{ name: '汇报模板', summary: '两句话', mail: 1 }],
    memories: [{ text: '汇报先发给直属上级', why: '上级主送' }, { text: '', why: '空行丢弃' }, 'not an object'],
  })

  it('reads a fenced JSON block', () => {
    const analysis = parseAnalysis(`看完了。\n\n\`\`\`json\n${verdict}\n\`\`\`\n`)
    expect(analysis.verdicts).toEqual([
      { mail: 1, importance: 'focus', why: '上级主送，要求周五前答复' },
      { mail: 2, importance: 'normal', why: '系统邮催' },
    ])
    expect(analysis.people).toEqual([
      { name: '张三', reason: '一起做汇报', relation: 'peer', email: 'zhangsan@example.com' },
      { name: '钱七', reason: '不在四选一里' },
    ])
    expect(analysis.todos[0]?.due).toBe('2026-09-12')
    expect(analysis.todos[1]?.due).toBeUndefined()
    expect(analysis.projects[0]?.name).toBe('飞书迁移')
    expect(analysis.resources).toEqual([{ name: '汇报模板', summary: '两句话', mail: 1 }])
    expect(analysis.memories).toEqual([{ text: '汇报先发给直属上级', why: '上级主送' }])
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

  it('rides the scope\'s behavior memory into every chunk\'s prompt (ADR-0032 批次④)', async () => {
    const mails = Array.from({ length: 12 }, (_value, index) => mail({ id: `m${index}`, subject: `第 ${index + 1} 封` }))
    const { session, asked } = fakeSession((turn) => {
      const first = turn === 1 ? 1 : 11
      return JSON.stringify({
        verdicts: Array.from({ length: turn === 1 ? 10 : 2 }, (_v, i) => ({ mail: first + i, importance: 'normal', why: '' })),
        people: [], todos: [], projects: [], resources: [], memories: [],
      })
    })
    await runMailAnalysis({
      ctx: ctxWith(session), mails, known: KNOWN,
      memory: '【行为记忆】人在以往运行中为「mail」沉淀的规则（历次纠正的累积），本次运行遵守：\n- 汇报先发给直属上级',
    })
    expect(asked.prompts).toHaveLength(2)
    expect(asked.prompts[0]).toContain('汇报先发给直属上级')
    expect(asked.prompts[1]).toContain('汇报先发给直属上级')
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
    areas: [],
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
    people: [{ name: '张三', relation: 'peer', reason: '一起做汇报', email: 'zhangsan@example.com' }],
    todos: [{ title: '发汇报', due: '2026-09-12', body: '给张三' }],
    projects: [{ name: '飞书迁移', note: '对方确认了时间' }, { name: '不存在的项目', note: '没有这个项目' }],
    resources: [{ name: '汇报模板', summary: '两句话', mail: 1 }],
    memories: [],
  }

  it('maps the four blocks into one flat action list, in a fixed order', () => {
    const proposal = analysisToProposal(ANALYSIS, ENTITIES, '邮件分析 2026-09-10', MAILS)
    expect(proposal.title).toBe('邮件分析 2026-09-10')
    expect(proposal.actions.map(action => action.kind))
      .toEqual(['create-entity', 'add-todo', 'append-log', 'append-log', 'save-resource'])
  })

  it('pins the verdict\'s memories to the mail scope, so a slip cannot leak into every task (ADR-0032)', () => {
    const proposal = analysisToProposal(
      { ...ANALYSIS, memories: [{ text: '汇报先发给直属上级', why: '上级主送' }] },
      ENTITIES, 't', MAILS,
    )
    expect(proposal.actions.at(-1)).toMatchObject({ kind: 'add-memory', scope: 'mail', text: '汇报先发给直属上级', reason: '上级主送' })
  })

  it('carries the relation and the sender address into the person action', () => {
    const proposal = analysisToProposal(ANALYSIS, ENTITIES, 't', MAILS)
    expect(proposal.actions[0]).toMatchObject({
      kind: 'create-entity', entityType: 'person', name: '张三', relation: 'peer',
      reason: '一起做汇报', email: 'zhangsan@example.com',
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

  it('merges same-thread digest mails into one 主题 ×N row', () => {
    const proposal = analysisToProposal(
      {
        ...ANALYSIS,
        verdicts: [
          { mail: 1, importance: 'digest', why: '第一次邮催' },
          { mail: 2, importance: 'digest', why: '第二次邮催' },
        ],
      },
      ENTITIES,
      't',
      [
        mail({ id: 'm1', senderName: '系统', subject: '邮催：请处理工单', toMe: 'cc' as const, conversationId: 'C9', conversationTopic: '邮催：请处理工单' }),
        mail({ id: 'm2', senderName: '系统', subject: 'RE: 邮催：请处理工单', toMe: 'cc' as const, conversationId: 'C9', conversationTopic: '邮催：请处理工单' }),
      ],
    )
    expect(proposal.digest).toEqual([
      { sender: '系统', subject: '邮催：请处理工单 ×2', why: '第一次邮催；第二次邮催' },
    ])
  })

  it('keeps digest mails of different threads as separate rows', () => {
    const proposal = analysisToProposal(
      {
        ...ANALYSIS,
        verdicts: [
          { mail: 1, importance: 'digest', why: '邮催一' },
          { mail: 2, importance: 'digest', why: '邮催二' },
        ],
      },
      ENTITIES,
      't',
      [
        mail({ senderName: '系统', subject: '邮催：工单一', toMe: 'cc' as const }),
        mail({ id: 'm3', senderName: '系统', subject: '邮催：工单二', toMe: 'cc' as const }),
      ],
    )
    expect(proposal.digest?.map(row => row.subject)).toEqual(['邮催：工单一', '邮催：工单二'])
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

describe('runMailAnalysis cancellation', () => {
  it('cancels the server turn when the signal aborts mid-run (ADR-0031)', async () => {
    const controller = new AbortController()
    const { session, asked } = fakeSession(JSON.stringify({
      verdicts: [{ mail: 1, importance: 'normal', why: '' }],
      people: [], todos: [], projects: [], resources: [],
    }))
    // The fake prompt hangs until the signal fires, so the abort lands while
    // the first chunk's round is genuinely in flight.
    const hanging = {
      ...session,
      prompt: (_args: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        }, { once: true })
      }),
    } as unknown as SessionRemote
    const pending = runMailAnalysis({ ctx: ctxWith(hanging), mails: [mail()], known: KNOWN, signal: controller.signal })
    await vi.waitFor(() => { if (asked.titles.length === 0) throw new Error('尚未命名会话') })
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(asked.cancels).toEqual([SESSION])
  })
})
