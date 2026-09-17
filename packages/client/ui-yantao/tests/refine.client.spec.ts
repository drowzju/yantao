import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { KbFileContent } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { SessionRemote } from '../src/client/remote.ts'
import {
  RESOURCE_DRAG_TYPE, dropPayloadOf, parseRefineVerdict, refinePrompt, runRefine, templateBodyOf, verdictToProposal,
} from '../src/client/refine.ts'

const SESSION = 'session-1'
const ENTITY_PATH = 'entities/projects/飞书迁移.md'
const ENTITY = '# 飞书迁移\n\n## 目标\n\n年内跑通\n\n## 流水\n\n- 2026-01-01 创建\n'

/** The verdict the fake session answers with, as fenced JSON. */
function verdictJson(overrides: Record<string, unknown> = {}): string {
  return `\`\`\`json\n${JSON.stringify({
    relevant: true,
    reason: '资源与项目直接相关',
    edits: [{ section: '目标', after: '年内跑通，含邮箱', why: '资源补充了范围' }],
    log: '归入了资源 会议纪要',
    ...overrides,
  })}\n\`\`\``
}

/** A session namespace that answers `answer` and records every prompt it was asked. */
function fakeSession(answer: string): {
  session: SessionRemote
  asked: { titles: readonly string[]; prompts: readonly string[] }
} {
  const titles: string[] = []
  const prompts: string[] = []
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
      yield {
        type: 'event',
        event: {
          type: 'assistant/message',
          seq: 1,
          time: 0,
          data: { message: { content: [{ type: 'text', text: answer }] } },
        },
      }
      yield {
        type: 'event',
        event: { type: 'turn/end', seq: 2, time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
      }
    })(),
  }
  return { session: session as unknown as SessionRemote, asked: { titles, prompts } }
}

/** A context carrying the session namespace and a KB whose files answer from `files`. */
function ctxWith(session: SessionRemote, files: Record<string, string>, failing: string[] = []): Context {
  const read = async (path: string) => {
    if (failing.includes(path)) {
      throw Object.assign(new Error(`「${path}」是二进制文件`), { code: 'yantao-kb/binary' })
    }
    if (!(path in files)) throw new Error(`找不到知识库文件：${path}`)
    return { ok: true as const, value: { path, content: files[path] } satisfies KbFileContent }
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

  it('carries the insight-placement criteria and the 流水 ban', () => {
    const text = refinePrompt({ ...base, resource: { name: 'r', content: 'c' } })
    expect(text).toContain('目标')
    expect(text).toContain('下一步')
    expect(text).toContain('只增不改')
    expect(text).toContain('frontmatter')
    expect(text).toContain('[[实体名]]')
  })

  it('tells the model what a whole-body replacement means', () => {
    const text = refinePrompt({ ...base, resource: { name: 'r', content: 'c' } })
    expect(text).toContain('完整正文')
    expect(text).toContain('原样带上')
  })
})

describe('parseRefineVerdict', () => {
  it('reads a fenced JSON block', () => {
    const verdict = parseRefineVerdict('看完了。\n\n```json\n{"relevant": true, "reason": "r", "edits": [{"section": "目标", "after": "a", "why": "w"}], "log": "l"}\n```\n')
    expect(verdict).toEqual({
      relevant: true, reason: 'r', edits: [{ section: '目标', after: 'a', why: 'w' }], log: 'l',
    })
  })

  it('reads bare JSON when the model skips the fence', () => {
    const verdict = parseRefineVerdict('{"relevant": false, "reason": "无关", "edits": [], "log": ""}')
    expect(verdict.relevant).toBe(false)
    expect(verdict.reason).toBe('无关')
  })

  it('treats relevance as false unless the model said true', () => {
    expect(parseRefineVerdict('{"reason": "r", "edits": [], "log": ""}').relevant).toBe(false)
    expect(parseRefineVerdict('{"relevant": "yes", "edits": [], "log": ""}').relevant).toBe(false)
  })

  it('drops edits without a section or with an empty body rather than writing junk', () => {
    const verdict = parseRefineVerdict(JSON.stringify({
      relevant: true, reason: '', log: '',
      edits: [{ section: '', after: 'a' }, { section: '目标', after: '' }, { section: '目标', after: 'a', why: 'w' }],
    }))
    expect(verdict.edits).toEqual([{ section: '目标', after: 'a', why: 'w' }])
  })

  it('says the model did not answer rather than returning an empty verdict', () => {
    expect(() => parseRefineVerdict('我觉得没必要改。')).toThrow(/JSON/)
  })
})

describe('verdictToProposal', () => {
  it('maps edits to edit-section actions carrying the current body as before', () => {
    const proposal = verdictToProposal(
      { relevant: true, reason: 'r', edits: [{ section: '目标', after: '新目标', why: 'w' }], log: 'l' },
      { path: ENTITY_PATH, name: '飞书迁移' },
      ENTITY,
      '提炼 飞书迁移',
    )
    expect(proposal.title).toBe('提炼 飞书迁移')
    expect(proposal.actions[0]).toEqual({
      kind: 'edit-section', path: ENTITY_PATH, section: '目标', before: '年内跑通', after: '新目标', why: 'w',
    })
  })

  it('carries an empty before for a section the entity does not have yet', () => {
    const proposal = verdictToProposal(
      { relevant: true, reason: 'r', edits: [{ section: '下一步', after: '迁移邮箱', why: 'w' }], log: 'l' },
      { path: ENTITY_PATH, name: '飞书迁移' },
      ENTITY,
      't',
    )
    expect(proposal.actions[0]).toMatchObject({ section: '下一步', before: '', after: '迁移邮箱' })
  })

  it('always appends the fixed log row, with a fallback text when the model left it empty', () => {
    const withLog = verdictToProposal(
      { relevant: true, reason: 'r', edits: [], log: '归入了资源 纪要' },
      { path: ENTITY_PATH, name: '飞书迁移' }, ENTITY, 't',
    )
    expect(withLog.actions).toEqual([{
      kind: 'append-log', entityPath: ENTITY_PATH, entityName: '飞书迁移', text: '归入了资源 纪要', reason: '提炼记录',
    }])
    const withoutLog = verdictToProposal(
      { relevant: true, reason: 'r', edits: [], log: '' },
      { path: ENTITY_PATH, name: '飞书迁移' }, ENTITY, 't',
    )
    const last = withoutLog.actions[0]
    if (last?.kind !== 'append-log') throw new Error('expected an append-log action')
    expect(last.text).toContain('提炼')
  })
})

describe('runRefine', () => {
  const FILES: Record<string, string> = {
    [ENTITY_PATH]: ENTITY,
    'resources/会议纪要.md': '纪要正文',
  }

  it('names the session 「提炼 <实体名>」 and sends the entity and resource in the prompt', async () => {
    const { session, asked } = fakeSession(verdictJson())
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
    const { session } = fakeSession(verdictJson({ relevant: false, reason: '资源讲的是别的项目', edits: [], log: '' }))
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

  it('injects a placeholder for a binary resource instead of failing the run', async () => {
    const { session, asked } = fakeSession(verdictJson())
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
    const { session, asked } = fakeSession(verdictJson())
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
    const { session, asked } = fakeSession(verdictJson())
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
    const { session } = fakeSession(verdictJson())
    await expect(runRefine({
      ctx: { remote: { session } } as unknown as Context,
      mode: 'refine',
      entityPath: ENTITY_PATH,
      entityName: '飞书迁移',
      entityType: 'project',
    })).rejects.toThrow(/yantaoKb Remote/)
  })

  it('reports the host\'s refusal to create a session', async () => {
    const { session } = fakeSession(verdictJson())
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
