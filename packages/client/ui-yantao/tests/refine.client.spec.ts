import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { KbFileContent } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { SessionRemote } from '../src/client/remote.ts'
import {
  RESOURCE_DRAG_TYPE, answersPrompt, dropPayloadOf, isEmptyBody, parseRefineVerdict, refinePrompt, runRefine,
  templateBodyOf, verdictToProposal,
} from '../src/client/refine.ts'

const SESSION = 'session-1'
const ENTITY_PATH = 'entities/projects/飞书迁移.md'
const ENTITY = '# 飞书迁移\n\n## 目标\n\n年内跑通\n\n## 流水\n\n- 2026-01-01 创建\n'

/** The verdict the fake session answers with, as fenced JSON (protocol v2). */
function verdictJson(overrides: Record<string, unknown> = {}): string {
  return `\`\`\`json\n${JSON.stringify({
    relevant: true,
    reason: '资源与项目直接相关',
    targets: [{
      entity: '飞书迁移',
      edits: [{ section: '目标', after: '年内跑通，含邮箱', why: '资源补充了范围' }],
      links: [],
      log: '归入了资源 会议纪要',
    }],
    creates: [],
    questions: [],
    ...overrides,
  })}\n\`\`\``
}

/** A session namespace that answers `answer` and records every prompt it was asked. */
function fakeSession(answers: readonly string[]): {
  session: SessionRemote
  asked: { titles: readonly string[]; prompts: readonly string[]; cancels: readonly string[] }
} {
  const titles: string[] = []
  const prompts: string[] = []
  const cancels: string[] = []
  let turn = 0
  const session = {
    create: async () => ({ ok: true, value: { sessionId: SESSION } }),
    rename: async (args: { title: string }) => {
      titles.push(args.title)
      return { ok: true, value: { title: args.title, seq: 1 } }
    },
    prompt: async (args: { content: readonly { text?: string }[] }) => {
      prompts.push(args.content.map(part => part.text ?? '').join(''))
      return { ok: true, value: { accepted: true } }
    },
    follow: () => (async function* () {
      const answer = answers[Math.min(turn, answers.length - 1)] ?? ''
      turn += 1
      yield {
        type: 'event',
        event: {
          type: 'assistant/message',
          seq: turn,
          time: 0,
          data: { message: { content: [{ type: 'text', text: answer }] } },
        },
      }
      yield {
        type: 'event',
        event: { type: 'turn/end', seq: turn + 100, time: 0, data: { turn, reason: { kind: 'completed' } } },
      }
    })(),
    cancel: async (args: { sessionId: string }) => {
      cancels.push(args.sessionId)
      return { ok: true as const, value: { accepted: true } }
    },
  }
  return { session: session as unknown as SessionRemote, asked: { titles, prompts, cancels } }
}

/** A context carrying the session namespace and a KB whose files answer from `files`. */
function ctxWith(session: SessionRemote, files: Record<string, string>, failing: string[] = []): Context {
  const read = async (path: string) => {
    if (failing.includes(path)) {
      throw Object.assign(new Error(`「${path}」是二进制文件`), { code: 'yantao-kb/binary' })
    }
    const content = files[path]
    if (content === undefined) throw new Error(`找不到知识库文件：${path}`)
    return { ok: true as const, value: { path, content } satisfies KbFileContent }
  }
  return { remote: { session, yantaoKb: { read } } } as unknown as Context
}

describe('templateBodyOf', () => {
  it('reads the user template and strips its own frontmatter', async () => {
    const body = await templateBodyOf(
      async () => '---\ntype: project\n---\n\n## 目标\n\n\n## 里程碑\n\n\n## 状态',
      'project',
    )
    expect(body).toContain('## 里程碑')
    expect(body).not.toContain('type: project')
  })

  it('falls back to the built-in skeleton when no user template exists', async () => {
    const body = await templateBodyOf(async () => { throw new Error('找不到') }, 'project')
    expect(body).toContain('## 目标')
    expect(body).toContain('## 下一步')
    expect(body).toContain('## 状态')
  })

  it('mirrors the meeting skeleton of the kb package, 决议 and 待办 included', async () => {
    const body = await templateBodyOf(async () => { throw new Error('找不到') }, 'meeting')
    expect(body).toContain('## 状态')
    expect(body).toContain('## 决议')
    expect(body).toContain('## 待办')
  })

  it('falls back when the user template carries 流水 twice — the anchor must be unique', async () => {
    const body = await templateBodyOf(async () => '## 状态\n\n## 流水\n\n## 流水', 'area')
    expect(body).toContain('## 标准')
    expect(body).not.toContain('## 流水')
  })
})

describe('refinePrompt', () => {
  const base = {
    mode: 'intake' as const,
    entityName: '飞书迁移',
    entityType: 'project',
    entityContent: ENTITY,
    template: '## 目标\n\n\n## 下一步\n\n\n## 状态',
  }

  it('shows the entity in full, the template, and the sibling names', () => {
    const text = refinePrompt({ ...base, resource: { name: '会议纪要', content: '纪要正文' }, siblings: ['科幻', '李四'] })
    expect(text).toContain('【实体：飞书迁移（project）】')
    expect(text).toContain('年内跑通')
    expect(text).toContain('【资源：会议纪要】')
    expect(text).toContain('纪要正文')
    expect(text).toContain('【project 类型的正文模板】')
    expect(text).toContain('科幻、李四')
  })

  it('asks the intake mode to judge relevance and to say no when unsure', () => {
    const text = refinePrompt({ ...base, resource: { name: '会议纪要', content: '纪要正文' } })
    expect(text).toContain('是否相关')
    expect(text).toContain('拿不准就判不相关')
  })

  it('asks the refine mode to check the template instead of judging relevance', () => {
    const text = refinePrompt({ ...base, mode: 'refine' })
    expect(text).toContain('对照模板检查区段结构')
    expect(text).toContain('relevant 恒为 true')
    expect(text).not.toContain('【资源：')
  })

  it('pins the intake and refine targets to the gesture\'s own entity', () => {
    const text = refinePrompt({ ...base, resource: { name: 'r', content: 'c' } })
    expect(text).toContain('targets 至多一条')
  })

  it('shows the whole distill roster and asks for a many-to-many mapping', () => {
    const text = refinePrompt({
      mode: 'distill',
      resource: { name: '会议纪要', content: '纪要正文' },
      roster: [
        { name: '飞书迁移', type: 'project', content: '年内跑通' },
        { name: '李四', type: 'person', content: '## 状态' },
      ],
    })
    expect(text).toContain('【资源：会议纪要】')
    expect(text).toContain('【实体：飞书迁移（project）】')
    expect(text).toContain('【实体：李四（person）】')
    expect(text).toContain('每个相关实体各给一个 targets 条目')
    expect(text).toContain('「近期工作动态」小节追加一行带日期的简述') // person progress lands in 近期工作动态
    expect(text).not.toContain('【资源：会议纪要】\n【实体：飞书迁移') // the roster never doubles as the resource
  })

  it('carries the insight-placement criteria, the 流水 ban, and the question rule', () => {
    const text = refinePrompt({ ...base, resource: { name: 'r', content: 'c' } })
    expect(text).toContain('目标')
    expect(text).toContain('下一步')
    expect(text).toContain('person 的近况用 `近期工作动态`')
    expect(text).not.toContain('进展涉及其中的「人」') // the person-progress rule is distill-only
    expect(text).toContain('只增不改')
    expect(text).toContain('frontmatter')
    expect(text).toContain('[[实体名]]')
    expect(text).toContain('questions')
    expect(text).toContain('creates')
  })
})

describe('parseRefineVerdict', () => {
  it('reads a fenced JSON block with targets', () => {
    const verdict = parseRefineVerdict('看完了。\n\n```json\n{"relevant": true, "reason": "r", "targets": [{"entity": "飞书迁移", "edits": [{"section": "目标", "after": "a", "why": "w"}], "links": [{"to": "李四", "why": "对接人"}], "log": "l"}], "creates": [], "questions": []}\n```\n')
    expect(verdict).toEqual({
      relevant: true,
      reason: 'r',
      targets: [{
        entity: '飞书迁移',
        edits: [{ section: '目标', after: 'a', why: 'w' }],
        links: [{ to: '李四', why: '对接人' }],
        log: 'l',
      }],
      creates: [],
      questions: [],
    })
  })

  it('binds the legacy single-entity shape (top-level edits/log) to the unnamed target', () => {
    const verdict = parseRefineVerdict('{"relevant": true, "reason": "r", "edits": [{"section": "目标", "after": "a", "why": "w"}], "log": "l"}')
    expect(verdict.targets).toEqual([{
      entity: '',
      edits: [{ section: '目标', after: 'a', why: 'w' }],
      links: [],
      log: 'l',
    }])
  })

  it('reads bare JSON when the model skips the fence', () => {
    const verdict = parseRefineVerdict('{"relevant": false, "reason": "无关", "targets": [], "creates": [], "questions": []}')
    expect(verdict.relevant).toBe(false)
    expect(verdict.reason).toBe('无关')
  })

  it('treats relevance as false unless the model said true', () => {
    expect(parseRefineVerdict('{"reason": "r", "targets": [], "creates": [], "questions": []}').relevant).toBe(false)
    expect(parseRefineVerdict('{"relevant": "yes", "targets": [], "creates": [], "questions": []}').relevant).toBe(false)
  })

  it('drops edits without a section or with an empty body rather than writing junk', () => {
    const verdict = parseRefineVerdict(JSON.stringify({
      relevant: true, reason: '', questions: [],
      targets: [{ entity: '甲', edits: [{ section: '', after: 'a' }, { section: '目标', after: '' }, { section: '目标', after: 'a', why: 'w' }], log: '' }],
    }))
    expect(verdict.targets[0]?.edits).toEqual([{ section: '目标', after: 'a', why: 'w' }])
  })

  it('drops a target with nothing to do, an unknown create type, and a link with no destination', () => {
    const verdict = parseRefineVerdict(JSON.stringify({
      relevant: true, reason: 'r',
      targets: [{ entity: '甲', edits: [], links: [], log: '' }],
      creates: [
        { entityType: 'widget', name: '坏' },
        { entityType: 'area', name: '' },
        { entityType: 'person', name: '李四', why: 'w' },
      ],
      questions: [{ question: '', why: 'w' }, { question: '时间?', why: 'w' }],
    }))
    expect(verdict.targets).toEqual([])
    expect(verdict.creates.map(create => create.name)).toEqual(['李四'])
    expect(verdict.questions.map(question => question.question)).toEqual(['时间?'])
  })

  it('says the model did not answer rather than returning an empty verdict', () => {
    expect(() => parseRefineVerdict('我觉得没必要改。')).toThrow(/JSON/)
  })
})

describe('answersPrompt', () => {
  it('pairs each question with the human\'s answer and forbids a second question round', () => {
    const text = answersPrompt(
      [{ question: '负责人是谁?', why: 'w' }, { question: '截止日期?', why: 'w' }],
      ['李四'],
    )
    expect(text).toContain('问题：负责人是谁?')
    expect(text).toContain('回答：李四')
    expect(text).toContain('回答：')
    expect(text).not.toContain('undefined')
    expect(text).toContain('不要再提问')
  })
})

describe('verdictToProposal', () => {
  const VIEWS = {
    primary: { name: '飞书迁移', path: ENTITY_PATH, content: ENTITY },
  }

  it('maps edits to edit-section actions carrying the current body as before', () => {
    const proposal = verdictToProposal(
      {
        relevant: true, reason: 'r',
        targets: [{ entity: '飞书迁移', edits: [{ section: '目标', after: '新目标', why: 'w' }], links: [], log: 'l' }],
        creates: [], questions: [],
      },
      VIEWS,
      '提炼 飞书迁移',
    )
    expect(proposal.title).toBe('提炼 飞书迁移')
    expect(proposal.actions[0]).toEqual({
      kind: 'edit-section', path: ENTITY_PATH, section: '目标', before: '年内跑通', after: '新目标', why: 'w',
    })
  })

  it('carries an empty before for a section the entity does not have yet', () => {
    const proposal = verdictToProposal(
      {
        relevant: true, reason: 'r',
        targets: [{ entity: '', edits: [{ section: '下一步', after: '迁移邮箱', why: 'w' }], links: [], log: 'l' }],
        creates: [], questions: [],
      },
      VIEWS,
      't',
    )
    expect(proposal.actions[0]).toMatchObject({ section: '下一步', before: '', after: '迁移邮箱' })
  })

  it('always appends the fixed log row, with a fallback text when the model left it empty', () => {
    const withLog = verdictToProposal(
      { relevant: true, reason: 'r', targets: [{ entity: '', edits: [], links: [], log: '归入了资源 纪要' }], creates: [], questions: [] },
      VIEWS, 't',
    )
    expect(withLog.actions).toEqual([{
      kind: 'append-log', entityPath: ENTITY_PATH, entityName: '飞书迁移', text: '归入了资源 纪要', reason: '提炼记录',
    }])
    const withoutLog = verdictToProposal(
      { relevant: true, reason: 'r', targets: [{ entity: '', edits: [], links: [], log: '' }], creates: [], questions: [] },
      VIEWS, 't',
    )
    const last = withoutLog.actions[0]
    if (last?.kind !== 'append-log') throw new Error('expected an append-log action')
    expect(last.text).toContain('提炼')
  })

  it('resolves distill targets from the roster and turns links into create-link rows', () => {
    const proposal = verdictToProposal(
      {
        relevant: true, reason: 'r',
        targets: [
          {
            entity: '飞书迁移',
            edits: [{ section: '下一步', after: '迁移邮箱', why: 'w' }],
            links: [{ to: '李四', why: '项目负责人' }],
            log: 'l1',
          },
          { entity: '李四', edits: [], links: [], log: 'l2' },
          { entity: '不在名单', edits: [{ section: '状态', after: 'x', why: 'w' }], links: [], log: 'l3' },
        ],
        creates: [], questions: [],
      },
      {
        roster: [
          { name: '飞书迁移', path: ENTITY_PATH, content: ENTITY },
          { name: '李四', path: 'entities/people/李四.md', content: '# 李四' },
        ],
      },
      '提炼 会议纪要',
    )
    expect(proposal.actions.map(action => action.kind)).toEqual(['edit-section', 'create-link', 'append-log', 'append-log'])
    expect(proposal.actions.some(action => action.kind === 'edit-section' && action.path === ENTITY_PATH)).toBe(true)
    expect(proposal.actions[1]).toEqual({
      kind: 'create-link', entityPath: ENTITY_PATH, entityName: '飞书迁移', link: '[[李四]]', reason: '项目负责人',
    })
    // The unresolvable third target is dropped, not guessed.
    expect(proposal.actions.filter(action => action.kind === 'append-log')).toHaveLength(2)
  })

  it('puts creates first and lets their edits, links, and log follow by name', () => {
    const proposal = verdictToProposal(
      {
        relevant: true, reason: 'r',
        targets: [],
        creates: [{
          entityType: 'project', name: '邮箱迁移', why: '没有承接的项目',
          edits: [{ section: '目标', after: '迁完', why: 'w' }],
          links: [{ to: '飞书迁移', why: '前身' }],
          log: '新建',
        }],
        questions: [],
      },
      VIEWS,
      '提炼 会议纪要',
    )
    expect(proposal.actions.map(action => action.kind)).toEqual(['create-entity', 'edit-section', 'create-link', 'append-log'])
    expect(proposal.actions[0]).toEqual({ kind: 'create-entity', entityType: 'project', name: '邮箱迁移', reason: '没有承接的项目' })
    expect(proposal.actions[1]).toMatchObject({ kind: 'edit-section', path: '', afterCreate: '邮箱迁移', section: '目标', after: '迁完' })
    expect(proposal.actions[2]).toMatchObject({ entityPath: '', entityName: '邮箱迁移', afterCreate: '邮箱迁移', link: '[[飞书迁移]]' })
    expect(proposal.actions[3]).toMatchObject({ entityPath: '', entityName: '邮箱迁移', afterCreate: '邮箱迁移', text: '新建' })
  })
})

describe('isEmptyBody', () => {
  it('calls a file empty when only its frontmatter and headings remain', () => {
    expect(isEmptyBody('---\ntype: resource\n---\n# 只有标题\n')).toBe(true)
    expect(isEmptyBody('# 标题\n\n## 小节\n')).toBe(true)
    expect(isEmptyBody('   \n\t\n')).toBe(true)
    expect(isEmptyBody('')).toBe(true)
  })

  it('keeps a file with any body text, a list line, or a link', () => {
    expect(isEmptyBody('# 标题\n\n正文一句话。\n')).toBe(false)
    expect(isEmptyBody('- 一条待办\n')).toBe(false)
    expect(isEmptyBody('[[某实体]]\n')).toBe(false)
  })
})

describe('runRefine', () => {
  const FILES: Record<string, string> = {
    [ENTITY_PATH]: ENTITY,
    'resources/会议纪要.md': '纪要正文',
  }

  it('names the session 「提炼 <实体名>」 and sends the entity and resource in the prompt', async () => {
    const { session, asked } = fakeSession([verdictJson()])
    const run = await runRefine({
      ctx: ctxWith(session, FILES),
      mode: 'intake',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
      resource: { path: 'resources/会议纪要.md', name: '会议纪要' },
    })
    expect(asked.titles).toEqual(['提炼 飞书迁移'])
    expect(run.title).toBe('提炼 飞书迁移')
    expect(run.sessionId).toBe(SESSION)
    expect(asked.prompts[0]).toContain('纪要正文')
    expect(run.proposal?.actions.map(action => action.kind)).toEqual(['edit-section', 'append-log'])
  })

  it('returns no proposal when the intake verdict judges the resource irrelevant', async () => {
    const { session } = fakeSession([verdictJson({ relevant: false, reason: '资源讲的是别的项目', targets: [] })])
    const run = await runRefine({
      ctx: ctxWith(session, FILES),
      mode: 'intake',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
      resource: { path: 'resources/会议纪要.md', name: '会议纪要' },
    })
    expect(run.relevant).toBe(false)
    expect(run.reason).toBe('资源讲的是别的项目')
    expect(run.proposal).toBeUndefined()
  })

  it('cancels the server turn when the signal aborts mid-run (ADR-0031)', async () => {
    const controller = new AbortController()
    const { session, asked } = fakeSession([verdictJson()])
    // The fake prompt hangs until the signal fires, so the abort lands while
    // the round is genuinely in flight — the listener path, not the
    // already-aborted one.
    const hanging = {
      ...session,
      prompt: (_args: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        }, { once: true })
      }),
    } as unknown as SessionRemote
    const pending = runRefine({
      ctx: ctxWith(hanging, FILES),
      mode: 'refine',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
      signal: controller.signal,
    })
    await vi.waitFor(() => { if (asked.titles.length === 0) throw new Error('尚未命名会话') })
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(asked.cancels).toEqual([SESSION])
  })

  it('cancels the server turn when the signal was already aborted (ADR-0031)', async () => {
    const controller = new AbortController()
    controller.abort()
    const { session, asked } = fakeSession([verdictJson()])
    // The fake session ignores the signal, so the run itself may still
    // complete — the contract under test is only that `session/cancel` fires
    // for the created session.
    await runRefine({
      ctx: ctxWith(session, FILES),
      mode: 'refine',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
      signal: controller.signal,
    })
    expect(asked.cancels).toEqual([SESSION])
  })

  it('pauses on questions and continues in the same session with the answers', async () => {
    const asked = fakeSession([
      verdictJson({
        reason: '需要先弄清楚归属',
        targets: [],
        questions: [{ question: '这是哪个项目的资源?', why: '影响归类' }],
      }),
      verdictJson({ reason: '清楚了', targets: [{ entity: '飞书迁移', edits: [], links: [], log: '第二轮' }] }),
    ])
    const run = await runRefine({
      ctx: ctxWith(asked.session, FILES),
      mode: 'intake',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
      resource: { path: 'resources/会议纪要.md', name: '会议纪要' },
    })
    expect(run.questions).toEqual([{ question: '这是哪个项目的资源?', why: '影响归类' }])
    expect(run.proposal).toBeUndefined()
    expect(asked.asked.prompts).toHaveLength(1)

    const final = await run.continueWithAnswers?.(['飞书迁移'])
    expect(final?.relevant).toBe(true)
    expect(final?.proposal?.actions.map(action => action.kind)).toEqual(['append-log'])
    expect(asked.asked.prompts).toHaveLength(2)
    expect(asked.asked.prompts[1]).toContain('问题：这是哪个项目的资源?')
    expect(asked.asked.prompts[1]).toContain('回答：飞书迁移')
  })

  it('runs the distill gesture against the whole roster, clipped per entity', async () => {
    const big = '长'.repeat(12 * 1024)
    const { session, asked } = fakeSession([verdictJson({
      reason: '两个实体相关',
      targets: [
        { entity: '飞书迁移', edits: [], links: [], log: '相关' },
        { entity: '小项目', edits: [], links: [], log: '也相关' },
      ],
    })])
    const run = await runRefine({
      ctx: ctxWith(session, {
        'resources/会议纪要.md': '纪要正文',
        [ENTITY_PATH]: ENTITY,
        'entities/projects/大项目.md': big,
      }),
      mode: 'distill',
      resource: { path: 'resources/会议纪要.md', name: '会议纪要' },
      roster: [
        { name: '飞书迁移', type: 'project', path: ENTITY_PATH },
        { name: '大项目', type: 'project', path: 'entities/projects/大项目.md' },
      ],
    })
    expect(asked.titles).toEqual(['提炼 会议纪要'])
    const prompt = asked.prompts[0] ?? ''
    expect(prompt).toContain('【实体：飞书迁移（project）】')
    expect(prompt).toContain('【实体：大项目（project）】')
    expect(prompt).toContain('（内容过长，已截断）')
    expect(prompt.length).toBeLessThan(big.length + 40 * 1024)
    expect(run.proposal?.actions.every(action => action.kind === 'append-log')).toBe(true)
  })

  it('skips a title-only distill resource without creating a session', async () => {
    const { session, asked } = fakeSession([verdictJson()])
    const run = await runRefine({
      ctx: ctxWith(session, {
        'resources/空笔记.md': '---\ntype: resource\n---\n# 空笔记\n',
        [ENTITY_PATH]: ENTITY,
      }),
      mode: 'distill',
      resource: { path: 'resources/空笔记.md', name: '空笔记' },
      roster: [{ name: '飞书迁移', type: 'project', path: ENTITY_PATH }],
    })
    expect(run.skippedEmpty).toBe(true)
    expect(run.sessionId).toBe('')
    expect(run.proposal).toBeUndefined()
    expect(asked.titles).toEqual([])
  })

  it('keeps a distill resource whose body has text beyond the headings', async () => {
    const { session, asked } = fakeSession([verdictJson()])
    const run = await runRefine({
      ctx: ctxWith(session, {
        'resources/有内容.md': '# 有内容\n\n正文在这里。\n',
        [ENTITY_PATH]: ENTITY,
      }),
      mode: 'distill',
      resource: { path: 'resources/有内容.md', name: '有内容' },
      roster: [{ name: '飞书迁移', type: 'project', path: ENTITY_PATH }],
    })
    expect(run.skippedEmpty).toBeUndefined()
    expect(asked.titles).toEqual(['提炼 有内容'])
  })

  it('injects a placeholder for a binary resource instead of failing the run', async () => {
    const { session, asked } = fakeSession([verdictJson()])
    await runRefine({
      ctx: ctxWith(session, FILES, ['resources/扫描件.pdf']),
      mode: 'intake',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
      resource: { path: 'resources/扫描件.pdf', name: '扫描件.pdf' },
    })
    expect(asked.prompts[0]).toContain('内容不可读')
    expect(asked.prompts[0]).toContain('扫描件.pdf')
  })

  it('clips an oversized resource at the 32k line', async () => {
    const { session, asked } = fakeSession([verdictJson()])
    const big = '长'.repeat(40 * 1024)
    await runRefine({
      ctx: ctxWith(session, { ...FILES, 'resources/长文.md': big }),
      mode: 'intake',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
      resource: { path: 'resources/长文.md', name: '长文.md' },
    })
    const prompt = asked.prompts[0] ?? ''
    expect(prompt).toContain('（内容过长，已截断）')
    expect(prompt.length).toBeLessThan(big.length)
  })

  it('reads the user template for the entity type into the prompt', async () => {
    const { session, asked } = fakeSession([verdictJson()])
    await runRefine({
      ctx: ctxWith(session, { ...FILES, '.dsh/yantao/templates/project.md': '## 目标\n\n\n## 里程碑' }),
      mode: 'refine',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
    })
    expect(asked.prompts[0]).toContain('## 里程碑')
  })

  it('reports a missing session namespace instead of throwing on undefined', async () => {
    await expect(runRefine({
      ctx: { remote: { yantaoKb: { read: async () => ({ ok: true, value: { path: '', content: '' } }) } } } as unknown as Context,
      mode: 'refine',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
    })).rejects.toThrow(/session Remote/)
  })

  it('reports a missing yantaoKb namespace instead of throwing on undefined', async () => {
    const { session } = fakeSession([verdictJson()])
    await expect(runRefine({
      ctx: { remote: { session } } as unknown as Context,
      mode: 'refine',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
    })).rejects.toThrow(/yantaoKb Remote/)
  })

  it('reports the host\'s refusal to create a session', async () => {
    const { session } = fakeSession([verdictJson()])
    const failing = {
      ...session,
      create: async () => ({ ok: false, error: new Error('没有可用的 agent') }),
    } as unknown as SessionRemote
    await expect(runRefine({
      ctx: ctxWith(failing, FILES),
      mode: 'refine',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
    })).rejects.toThrow('没有可用的 agent')
  })
})

describe('dropPayloadOf', () => {
  /** A dataTransfer answering `getData` from `types` and carrying `files`. */
  function transfer(types: Record<string, string>, files: readonly File[] = []): DataTransfer {
    return {
      getData: (type: string) => types[type] ?? '',
      files,
    } as unknown as DataTransfer
  }
  const file = (name: string): File => ({ name }) as File

  it('reads a library drag as the resource its row handed over', () => {
    expect(dropPayloadOf(transfer({ [RESOURCE_DRAG_TYPE]: 'resources/纪要.md' }))).toEqual({
      kind: 'resource',
      path: 'resources/纪要.md',
    })
  })

  it('reads an OS drag as its files', () => {
    const payload = dropPayloadOf(transfer({}, [file('说明.pdf')]))
    expect(payload).toEqual({ kind: 'files', files: [file('说明.pdf')] })
  })

  it('reads nothing for a drop the pipeline does not accept', () => {
    expect(dropPayloadOf(transfer({ 'text/plain': '随便什么' }))).toBeNull()
    expect(dropPayloadOf(transfer({}, []))).toBeNull()
  })
})
