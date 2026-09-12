import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionRemote } from '../src/client/remote.ts'
import {
  domainConfirmPrompt, parseProposal, readingPrompt, readingSessionTitle, runDomainConfirm, runReadingFlow,
} from '../src/client/reading-flow.ts'

const SESSION = 'session-1'

/** One agent step's durable message: reasoning and tool calls, no text. */
const STEP_NOISE = {
  type: 'assistant/message',
  time: 0,
  data: { message: { content: [{ type: 'reasoning', text: '先读开头' }, { type: 'tool_call', name: 'kb_read_resource' }] } },
}

/** The turn-end event, completed. */
const TURN_END = (seq: number): { type: string; seq: number; time: number; data: unknown } => ({
  type: 'turn/end', seq, time: 0, data: { turn: 1, reason: { kind: 'completed' } },
})

/**
 * A session namespace whose follow stream plays one turn per call: a noisy
 * intermediate step, the final text, then turn/end — the shape a real
 * multi-step tool-using turn commits. Records what it was asked.
 */
function fakeSession(answers: readonly string[]): {
  session: SessionRemote
  asked: { titles: string[]; texts: string[]; createArgs: unknown[] }
} {
  const asked: { titles: string[]; texts: string[]; createArgs: unknown[] } = { titles: [], texts: [], createArgs: [] }
  let turn = 0
  const session = {
    create: async (args: unknown) => {
      asked.createArgs.push(args)
      return { ok: true, value: { sessionId: SESSION } }
    },
    rename: async (args: { title: string }) => {
      asked.titles.push(args.title)
      return { ok: true, value: { title: args.title, seq: 1 } }
    },
    prompt: async (args: { content: readonly { text?: string }[] }) => {
      asked.texts.push(args.content.map(part => part.text ?? '').join(''))
      return { ok: true, value: { accepted: true } }
    },
    follow: () => (async function* () {
      turn += 1
      const answer = answers[Math.min(turn - 1, answers.length - 1)]
      yield { ...STEP_NOISE, seq: turn * 10 }
      yield {
        type: 'event',
        event: {
          type: 'assistant/message',
          seq: turn * 10 + 1,
          time: 0,
          data: { message: { content: [{ type: 'text', text: answer }] } },
        },
      }
      yield { type: 'event', event: TURN_END(turn * 10 + 2) }
    })(),
  }
  return { session: session as unknown as SessionRemote, asked }
}

/** A context carrying just the session namespace. */
function ctxWith(session: SessionRemote): Context {
  return { remote: { session } } as unknown as Context
}

const PROPOSAL = JSON.stringify({ domains: ['认知科学'], newDomain: null })

describe('readingPrompt', () => {
  it('names the paged tool, the project and the resource', () => {
    const text = readingPrompt('三体', 'entities/projects/读书-《三体》.md', 'resources/三体.epub', ['科幻'])
    expect(text).toContain('kb_read_resource')
    expect(text).toContain('resources/三体.epub')
    expect(text).toContain('entities/projects/读书-《三体》.md')
    expect(text).toContain('kb_write_state')
    expect(text).toContain('kb_append_log')
    expect(text).toContain('科幻')
  })

  it('caps the sampling instead of demanding a full read of a 500k-char book', () => {
    const text = readingPrompt('三体', 'p', 'resources/三体.epub', [])
    expect(text).toMatch(/抽样/)
    expect(text).toMatch(/最多 6 段/)
    expect(text).not.toMatch(/直到读完/)
  })

  it('says when the KB holds no areas yet', () => {
    expect(readingPrompt('三体', 'p', 'r', [])).toContain('还没有领域')
  })
})

describe('domainConfirmPrompt', () => {
  it('links existing domains without creating anything', () => {
    const text = domainConfirmPrompt('p', ['科幻', '历史'])
    expect(text).toContain('[[领域:科幻]]')
    expect(text).toContain('[[领域:历史]]')
    expect(text).not.toContain('kb_create_entity')
  })

  it('creates the new domain first when one was confirmed', () => {
    const text = domainConfirmPrompt('p', [], '认知科学')
    expect(text).toContain('kb_create_entity')
    expect(text).toContain('[[领域:认知科学]]')
  })
})

describe('parseProposal', () => {
  it('reads a fenced JSON block', () => {
    const proposal = parseProposal(`读完了。\n\n\`\`\`json\n${PROPOSAL}\n\`\`\`\n`)
    expect(proposal.domains).toEqual(['认知科学'])
    expect(proposal.newDomain).toBeUndefined()
  })

  it('keeps a proposed new domain', () => {
    const proposal = parseProposal('{"domains":["历史"],"newDomain":"认知科学"}')
    expect(proposal.newDomain).toBe('认知科学')
  })

  it('drops blank and non-string rows rather than writing junk', () => {
    const proposal = parseProposal('{"domains":["", 3, "科幻"],"newDomain":"  "}')
    expect(proposal.domains).toEqual(['科幻'])
    expect(proposal.newDomain).toBeUndefined()
  })

  it('says the model did not answer rather than returning a silent empty verdict', () => {
    expect(() => parseProposal('这本书不好归类。')).toThrow(/JSON/)
  })
})

describe('readingSessionTitle', () => {
  it('names the session after the book, so it can be found again', () => {
    expect(readingSessionTitle('三体')).toBe(`读书-《三体》 ${new Date().toISOString().slice(0, 10)}`)
  })
})

describe('runReadingFlow', () => {
  it('names the session after the book and parses the proposal', async () => {
    const { session, asked } = fakeSession([PROPOSAL])
    const run = await runReadingFlow({
      ctx: ctxWith(session),
      bookTitle: '三体',
      projectPath: 'entities/projects/读书-《三体》.md',
      resourcePath: 'resources/三体.epub',
      knownAreas: ['科幻'],
    })
    expect(asked.titles).toEqual([`读书-《三体》 ${new Date().toISOString().slice(0, 10)}`])
    expect(asked.texts[0]).toContain('resources/三体.epub')
    expect(run.sessionId).toBe(SESSION)
    expect(run.proposal.domains).toEqual(['认知科学'])
  })

  it('creates the session in the KB root when one is given', async () => {
    const { session, asked } = fakeSession([PROPOSAL])
    await runReadingFlow({
      ctx: ctxWith(session), bookTitle: 'x', projectPath: 'p', resourcePath: 'r', knownAreas: [], cwd: 'D:/yantao-data',
    })
    expect(asked.createArgs[0]).toEqual({ cwd: 'D:/yantao-data' })
  })

  it('waits out the tool steps: the first text-less message is not the answer', async () => {
    // The fake's first assistant/message carries only reasoning and a tool
    // call — the regression that made every reading run fail with 「模型没有
    // 返回可解析的 JSON」. Only the turn's last message parses.
    const { session } = fakeSession([PROPOSAL])
    const run = await runReadingFlow({
      ctx: ctxWith(session), bookTitle: '三体', projectPath: 'p', resourcePath: 'r', knownAreas: [],
    })
    expect(run.proposal.domains).toEqual(['认知科学'])
  })

  it('re-asks once in the same session when the first answer is not JSON', async () => {
    const { session, asked } = fakeSession(['这本书讲的是历史，我觉得挺好的。', PROPOSAL])
    const run = await runReadingFlow({
      ctx: ctxWith(session), bookTitle: 'x', projectPath: 'p', resourcePath: 'r', knownAreas: [],
    })
    expect(asked.texts).toHaveLength(2)
    expect(asked.texts[1]).toContain('只输出一个 JSON')
    expect(run.proposal.domains).toEqual(['认知科学'])
  })

  it('attaches the model\'s own words when the re-ask also fails', async () => {
    const { session } = fakeSession(['我觉得不好归类。', '真的不好归类，抱歉。'])
    await expect(runReadingFlow({
      ctx: ctxWith(session), bookTitle: 'x', projectPath: 'p', resourcePath: 'r', knownAreas: [],
    })).rejects.toThrow(/模型没有返回可解析的 JSON[\s\S]*真的不好归类/)
  })

  it('reports an interrupted turn instead of parsing a half answer', async () => {
    const { session } = fakeSession([PROPOSAL])
    const interrupted = {
      ...session,
      follow: () => (async function* () {
        yield {
          type: 'event',
          event: { type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'aborted', reason: { cause: 'user' } } } },
        }
      })(),
    } as unknown as SessionRemote
    await expect(runReadingFlow({
      ctx: ctxWith(interrupted), bookTitle: 'x', projectPath: 'p', resourcePath: 'r', knownAreas: [],
    })).rejects.toThrow(/没有正常完成/)
  })

  it('reports the host\'s refusal to create a session', async () => {
    const { session } = fakeSession([PROPOSAL])
    const failing = {
      ...session,
      create: async () => ({ ok: false, error: new Error('没有可用的 agent') }),
    } as unknown as SessionRemote
    await expect(runReadingFlow({
      ctx: ctxWith(failing), bookTitle: 'x', projectPath: 'p', resourcePath: 'r', knownAreas: [],
    })).rejects.toThrow('没有可用的 agent')
  })

  it('reports a session that ends without answering', async () => {
    const { session } = fakeSession([PROPOSAL])
    const silent = { ...session, follow: () => (async function* () { /* nothing */ })() } as unknown as SessionRemote
    await expect(runReadingFlow({
      ctx: ctxWith(silent), bookTitle: 'x', projectPath: 'p', resourcePath: 'r', knownAreas: [],
    })).rejects.toThrow(/没有给出回答/)
  })

  it('reports a missing session namespace instead of throwing on undefined', async () => {
    await expect(runReadingFlow({
      ctx: {} as Context, bookTitle: 'x', projectPath: 'p', resourcePath: 'r', knownAreas: [],
    })).rejects.toThrow(/session Remote/)
  })
})

describe('runDomainConfirm', () => {
  it('sends the confirmation prompt in the same session and waits out the turn', async () => {
    const { session, asked } = fakeSession(['已写入 [[领域:科幻]]。'])
    await runDomainConfirm({
      ctx: ctxWith(session),
      sessionId: SESSION,
      projectPath: 'entities/projects/读书-《三体》.md',
      domains: ['科幻'],
    })
    expect(asked.texts[0]).toContain('[[领域:科幻]]')
  })

  it('reports a missing session namespace', async () => {
    await expect(runDomainConfirm({
      ctx: {} as Context, sessionId: SESSION, projectPath: 'p', domains: [],
    })).rejects.toThrow(/session Remote/)
  })
})
