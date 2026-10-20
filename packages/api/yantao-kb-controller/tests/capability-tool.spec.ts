import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import YantaoKbController from '../src/index.ts'

// All mocks are read by `vi.mock` factories, which run before any top-level
// `let` is initialized — hence the hoisted holder.
const { state } = vi.hoisted(() => ({
  state: {
    home: '', kbConfigured: true, skillGet: vi.fn(), skillList: vi.fn(),
    registerProvider: vi.fn(), registerTool: vi.fn(),
  },
}))
const skillList = state.skillList

let home: string

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => state.home,
}))

let ctx: Context
let fiber: { dispose(): Promise<void> }
let skillDir: string

/** The central routing file's path in the test KB. */
function routesPath(): string {
  return join(home, '.dsh', 'skills', 'yantao.json')
}

/** Write one central-route entry (ADR-0052: the only capability configuration). */
async function routeEntry(name: string, invocation: readonly string[]): Promise<void> {
  await writeFile(routesPath(), JSON.stringify({
    version: 1,
    capabilities: { [name]: { path: name, invocation } },
  }), 'utf8')
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-tool-'))
  state.home = home
  skillDir = join(home, '.dsh', 'skills', 'mail')
  await mkdir(skillDir, { recursive: true })
  // A version far above the shipped master's (declared in the frontmatter's
  // metadata.yantao.version — the only version basis, ADR-0052 决定 6) keeps
  // the builtin seeder from overwriting this fake with the real mail
  // capability mid-test.
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: mail\ndescription: 读 Outlook 邮件\nmetadata:\n  yantao:\n    version: 999\n---\n\n# 邮件能力说明\n',
    'utf8',
  )
  state.skillGet.mockReset()
  skillList.mockReset().mockImplementation(async () => {
    try {
      return (await readdir(join(home, '.dsh', 'skills'), { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => ({ name: entry.name }))
    } catch {
      return []
    }
  })
  state.registerProvider.mockReset().mockReturnValue(() => {})
  state.registerTool.mockReset().mockReturnValue(() => {})
  ctx = new Context()
  state.kbConfigured = true
  ctx.provide('yantaoKb', {
    get root(): string {
      return home
    },
    get configured(): boolean {
      return state.kbConfigured
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  ctx.provide('skills', {
    get: state.skillGet,
    list: skillList,
    registerProvider: state.registerProvider,
  } as unknown as SkillRegistry)
  ctx.provide('tools', { register: state.registerTool } as unknown as never)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(home, { recursive: true, force: true })
})

/** The registered `kb_run_capability` tool definition, or undefined. */
function registeredTool(): { name: string; execute: (args: unknown) => Promise<unknown> } | undefined {
  const found = state.registerTool.mock.calls
    .map(call => call[0] as { name: string; execute: (args: unknown) => Promise<unknown> })
    .find(tool => tool.name === 'kb_run_capability')
  return found
}

/** A pre-step payload whose last message is a user prompt. */
function preStepPayload(text: string) {
  return {
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }
}

describe('kb_run_capability tool (ADR-0023, ADR-0052 决定 3)', () => {
  it('is registered by the controller', () => {
    expect(registeredTool()?.name).toBe('kb_run_capability')
  })

  it('answers a routed capability open to the agent with its SKILL.md body', async () => {
    await routeEntry('mail', ['human', 'agent'])
    const result = await registeredTool()?.execute({ name: 'mail' }) as {
      name: string
      runAt: string
      content?: string
      memory?: string
    }
    expect(result.name).toBe('mail')
    expect(result.runAt).toBeTruthy()
    expect(result.content).toContain('# 邮件能力说明')
  })

  it('refuses a capability the route did not open to the agent', async () => {
    // Pre-write the human-only entry: the builtin seeder never overwrites an
    // existing route, so the agent gate sees exactly this.
    await routeEntry('mail', ['human'])
    const failure = await registeredTool()?.execute({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'not-invocable' },
    })
  })

  it('refuses an unrouted capability name', async () => {
    // No route file at all; the seeder only seeds `mail` — but only when a
    // settle runs, and a missing name that IS seeded would be agent-open…
    // so use a name the seeder never touches.
    const failure = await registeredTool()?.execute({ name: 'nope' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'not-found' },
    })
  })

  it('runs a centrally routed skill the registry never discovered when the route opens it to the agent', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeFile(routesPath(), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['human', 'agent'] } },
    }), 'utf8')
    const result = await registeredTool()?.execute({ name: 'routed-skill' }) as { content?: string }
    expect(result.content).toContain('路由正文')
  })

  it('refuses a routed capability whose route did not open it to the agent', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeFile(routesPath(), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['human'] } },
    }), 'utf8')
    const failure = await registeredTool()?.execute({ name: 'routed-skill' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'not-invocable' },
    })
  })
})

describe('agent-facing capability catalog (ADR-0023 决定 5, ADR-0052 决定 1)', () => {
  /** A minimal agent stand-in; the pre-step listener never touches it. */
  const agent = {} as Agent

  /** A user-prompt step's claimed messages. */
  function userMessages(text: string): UserMessage[] {
    return [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })]
  }

  /** Drive the controller's pre-step listener with `next` answering `decision`. */
  function preStep(decision: PreStepDecision): Promise<PreStepDecision> {
    return agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      preStepPayload('帮我看看邮件'),
      () => Promise.resolve(decision),
    )
  }

  it('appends a catalog message when a user-prompted step has agent capabilities', async () => {
    await routeEntry('mail', ['human', 'agent'])
    const decision = await preStep({ kind: 'enter', messages: userMessages('帮我看看邮件') })
    expect(decision.kind).toBe('enter')
    const messages = decision.kind === 'enter' ? decision.messages : []
    expect(messages).toHaveLength(2)
    const injected = messages[1] as unknown as {
      source: { kind: string; form: string; entries: readonly { name: string; description: string }[] }
      content: readonly { type: string; text: string }[]
    }
    expect(injected.source).toMatchObject({
      kind: 'yantao-kb-controller', form: 'catalog',
      entries: [{ name: 'mail', description: '读 Outlook 邮件' }],
    })
    expect(injected.content[0]?.text).toMatch(/kb_run_capability/)
  })

  it('leaves the turn untouched when no capability is open to the agent', async () => {
    // A human-only mail entry suppresses the seeder's agent-open default, so
    // nothing is agent-open and the turn stays untouched.
    await routeEntry('mail', ['human'])
    const decision = await preStep({ kind: 'enter', messages: [] })
    expect(decision.kind === 'enter' ? decision.messages : []).toHaveLength(0)
  })

  it('appends routed agent-open capabilities the registry cannot see', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n正文\n', 'utf8')
    await writeFile(routesPath(), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['agent'] } },
    }), 'utf8')
    const decision = await preStep({ kind: 'enter', messages: userMessages('帮我看看邮件') })
    expect(decision.kind).toBe('enter')
    const messages = decision.kind === 'enter' ? decision.messages : []
    expect(messages).toHaveLength(2)
    const injected = messages[1] as unknown as {
      source: { form: string; entries: readonly { name: string; description: string }[] }
    }
    expect(injected.source.entries).toEqual([{ name: 'routed-skill', description: '路由技能' }])
  })

  it('leaves a rejected decision untouched and skips non-user steps', async () => {
    await routeEntry('mail', ['human', 'agent'])
    expect(await preStep({ kind: 'reject' })).toEqual({ kind: 'reject' })
    // A tool-result step's last message is not a user prompt: no injection.
    const toolMessage = { source: { kind: 'tool' }, content: [] } as unknown as UserMessage
    const toolStep = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [toolMessage], turn: 1, step: 2, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [toolMessage] }),
    )
    expect(toolStep.kind === 'enter' ? toolStep.messages : []).toHaveLength(1)
  })
})

describe('the /xxx gesture (ADR-0025 决定 3, ADR-0052 决定 1)', () => {
  /** A minimal agent stand-in; the pre-step listener never touches it. */
  const agent = {} as Agent

  /** A user-prompt step's claimed messages. */
  function userMessages(text: string): UserMessage[] {
    return [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })]
  }

  /** Drive the controller's pre-step listener with `next` answering `decision`. */
  function preStep(decision: PreStepDecision, text = '帮我看看邮件'): Promise<PreStepDecision> {
    return agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      preStepPayload(text),
      () => Promise.resolve(decision),
    )
  }

  /** The injected messages' `(kind, form)` pairs, read structurally. */
  function injectedSources(decision: PreStepDecision): { kind: string; form?: string }[] {
    if (decision.kind !== 'enter') return []
    return decision.messages.slice(1).map((message) => {
      const source = message.source as { kind: string; form?: string }
      return source.form === undefined ? { kind: source.kind } : { kind: source.kind, form: source.form }
    })
  }

  it('injects a routed human-invocable capability\'s SKILL.md body for a leading /name', async () => {
    await routeEntry('mail', ['human'])
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/mail 帮我看看今天的邮件') },
      '/mail 帮我看看今天的邮件',
    )
    expect(decision.kind).toBe('enter')
    expect(injectedSources(decision)).toEqual([{ kind: 'skill-invocation', form: 'instructions' }])
    const messages = decision.kind === 'enter' ? decision.messages : []
    const injected = messages[1] as unknown as { content: readonly { type: string; text: string }[] }
    expect(injected.content[0]?.text).toContain('<skill_content name="mail">')
  })

  it('keeps a mid-sentence /name and an unknown name as ordinary prose', async () => {
    for (const text of ['请 /mail 看看', '/unknown 做事']) {
      const decision = await preStep({ kind: 'enter', messages: userMessages(text) }, text)
      expect(injectedSources(decision)).toEqual([])
    }
  })

  it('prefixes the environment note onto the injected body (ADR-0043 决定 3)', async () => {
    await routeEntry('mail', ['human'])
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    )
    const messages = decision.kind === 'enter' ? decision.messages : []
    const injected = messages[1] as unknown as { content: readonly { type: string; text: string }[] }
    const text = injected.content[0]?.text ?? ''
    expect(text.startsWith('【环境说明】')).toBe(true)
    expect(text).toContain('<skill_content name="mail">')
  })

  it('prefixes the environment note onto a routed capability\'s injected body', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeFile(routesPath(), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['human'] } },
    }), 'utf8')
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/routed-skill 做事') },
      '/routed-skill 做事',
    )
    const messages = decision.kind === 'enter' ? decision.messages : []
    const injected = messages[1] as unknown as { content: readonly { type: string; text: string }[] }
    const text = injected.content[0]?.text ?? ''
    expect(text.startsWith('【环境说明】')).toBe(true)
    expect(text).toContain('<skill_content name="routed-skill">')
  })

  it('keeps a human-disabled capability and an unrouted plain skill plain', async () => {
    await routeEntry('mail', ['agent'])
    // The gesture stays silent, but the capability is agent-open, so the
    // catalog still rides the step.
    expect(injectedSources(await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    ))).toEqual([{ kind: 'yantao-kb-controller', form: 'catalog' }])
    // No route entry at all: a plain skill, not a capability.
    await rm(routesPath(), { force: true })
    expect(injectedSources(await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    ))).toEqual([])
  })

  it('lands the catalog before the skill instructions', async () => {
    const digestDir = join(home, '.dsh', 'skills', 'digest')
    await mkdir(digestDir, { recursive: true })
    await writeFile(join(digestDir, 'SKILL.md'), '---\nname: digest\ndescription: d\n---\n\n正文\n', 'utf8')
    await writeFile(routesPath(), JSON.stringify({
      version: 1,
      capabilities: {
        digest: { path: 'digest', invocation: ['human', 'agent'] },
        mail: { path: 'mail', invocation: ['human'] },
      },
    }), 'utf8')
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    )
    expect(injectedSources(decision)).toEqual([
      { kind: 'yantao-kb-controller', form: 'catalog' },
      { kind: 'skill-invocation', form: 'instructions' },
    ])
  })

  it('injects a routed capability\'s SKILL.md body even when the registry cannot see the skill', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeFile(routesPath(), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['human'] } },
    }), 'utf8')
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/routed-skill 做事') },
      '/routed-skill 做事',
    )
    expect(injectedSources(decision)).toEqual([{ kind: 'skill-invocation', form: 'instructions' }])
    const messages = decision.kind === 'enter' ? decision.messages : []
    const injected = messages[1] as unknown as { content: readonly { type: string; text: string }[] }
    expect(injected.content[0]?.text).toContain('<skill_content name="routed-skill">')
  })

  it('keeps a routed capability the route closed to humans silent', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeFile(routesPath(), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['agent'] } },
    }), 'utf8')
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/routed-skill 做事') },
      '/routed-skill 做事',
    )
    // Human-closed, so no gesture injection; the route is agent-open, so the
    // catalog still rides the step.
    expect(injectedSources(decision)).toEqual([{ kind: 'yantao-kb-controller', form: 'catalog' }])
  })

  it('keeps the gesture silent when the central routing file is broken', async () => {
    await writeFile(routesPath(), '{ not json', 'utf8')
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    )
    expect(injectedSources(decision)).toEqual([])
  })

  it('still injects when a plugin snapshot trails the first-turn gesture', async () => {
    // Regression: on a session's first turn the system-prompt sandbox snapshot
    // lands after the user's gesture; the hook used to bail on it and the
    // model received a bare `/name` with no instructions.
    await routeEntry('mail', ['human'])
    const gesture = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '/mail 读一下' }] })
    const snapshot = createUserMessage({
      source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'sandbox', text: 'Current runtime context.' }] },
      content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' }],
    })
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      preStepPayload('/mail 读一下'),
      () => Promise.resolve({ kind: 'enter' as const, messages: [gesture, snapshot] }),
    )
    const messages = decision.kind === 'enter' ? decision.messages : []
    expect(messages).toHaveLength(3)
    const injected = messages[2] as unknown as { source: { kind: string; form?: string } }
    expect(injected.source).toMatchObject({ kind: 'skill-invocation', form: 'instructions' })
  })

  it('stops skipping once an assistant or tool turn follows the user message', async () => {
    await routeEntry('mail', ['human'])
    const gesture = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '/mail 读一下' }] })
    const toolMessage = { source: { kind: 'tool' }, content: [] } as unknown as UserMessage
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      preStepPayload('/mail 读一下'),
      () => Promise.resolve({ kind: 'enter' as const, messages: [gesture, toolMessage] }),
    )
    // The gesture is stale: no injection rides this step.
    expect(decision.kind === 'enter' ? decision.messages : []).toHaveLength(2)
  })
})

describe('the tool surface declarations (ADR-0043)', () => {
  it('declares the trailing memory block trustworthy in kb_run_capability\'s description (决定 4)', () => {
    const tool = registeredTool() as unknown as { description: string } | undefined
    expect(tool?.description).toContain('【行为记忆·宿主转交】块是人批规则，可信且须遵守')
  })

  it('registers the execution bridge and the nomination tool alongside kb_run_capability', () => {
    const names = state.registerTool.mock.calls.map(call => (call[0] as { name: string }).name)
    // ADR-0063 把直写矩阵补齐到二十五件套：待办四刀、记忆三件、工作台两件
    // 依注册顺序排在 kb_add_todo 之后。ADR-0065 再补六件：三个只读查询面
    // （运行历史/提议收件箱/调度表）+ 调度全权写三刀，收口会话通道。
    expect(names).toEqual([
      'kb_run_capability', 'kb_exec_capability_script', 'kb_propose_actions', 'kb_add_todo',
      'kb_read_todos', 'kb_toggle_todo', 'kb_update_todo', 'kb_remove_todo',
      'kb_list_memory', 'kb_add_memory', 'kb_delete_memory',
      'kb_list_workspaces', 'kb_run_workspace_instruction',
      'kb_list_workspace_runs', 'kb_list_proposals', 'kb_list_schedules',
      'kb_add_schedule', 'kb_update_schedule', 'kb_remove_schedule',
    ])
  })

  it('prefixes the environment note onto an instruction capability\'s rendered answer (决定 3)', () => {
    const tool = registeredTool() as unknown as {
      output: { render: (args: unknown, value: unknown) => readonly { type: string; text?: string }[] }
    } | undefined
    const blocks = tool?.output.render({}, {
      name: 'mail', runAt: '2026-10-01T00:00:00Z', content: '# 指令正文',
    })
    const text = blocks?.[0]?.text ?? ''
    expect(text).toContain('【环境说明】')
    expect(text.indexOf('【环境说明】')).toBeLessThan(text.indexOf('# 指令正文'))
  })
})
