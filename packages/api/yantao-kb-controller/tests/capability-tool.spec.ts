import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SkillDefinition, SkillRegistry } from '@deepseek-ai/dsh-skill'
import { type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import YantaoKbController from '../src/index.ts'

// All mocks are read by `vi.mock` factories, which run before any top-level
// `let` is initialized — hence the hoisted holder.
const { state } = vi.hoisted(() => ({
  state: {
    home: '', kbConfigured: true, runCapability: vi.fn(), skillGet: vi.fn(), skillList: vi.fn(),
    registerProvider: vi.fn(), registerTool: vi.fn(),
  },
}))
const runCapability = state.runCapability
const skillGet = state.skillGet
const skillList = state.skillList

let home: string

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => state.home,
}))

// The subprocess is the one part that would need Python; the gate, the
// instruction branch, and the catalog injection are the subject here.
vi.mock('../src/capability/run.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/capability/run.ts')>(),
  runCapability: state.runCapability,
}))

let ctx: Context
let fiber: { dispose(): Promise<void> }
let skillDir: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-tool-'))
  state.home = home
  skillDir = join(home, '.dsh', 'skills', 'mail')
  await mkdir(join(skillDir, 'scripts'), { recursive: true })
  await writeFile(join(skillDir, 'scripts', 'entry.py'), 'print(1)', 'utf8')
  // A version far above the shipped master's keeps the builtin seeder from
  // overwriting this fake with the real mail capability mid-test.
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: mail\ndescription: 测试\nversion: 999\n---\n\n测试。\n', 'utf8')
  runCapability.mockReset()
  skillGet.mockReset()
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
    get: skillGet,
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

/** A winning skill definition for the `mail` capability, as skill-filesystem would load it. */
function definition(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: 'mail',
    description: '读 Outlook 邮件',
    invocation: { modelInvocable: false, userInvocable: true },
    source: 'custom',
    provider: 'skill-filesystem',
    content: '# 邮件能力说明',
    resourceBase: { kind: 'directory', path: skillDir },
    metadata: { yantao: { entry: 'scripts/entry.py', runtime: 'python' } },
    ...overrides,
  }
}

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

describe('kb_run_capability tool (ADR-0023)', () => {
  it('is registered by the controller', () => {
    expect(registeredTool()?.name).toBe('kb_run_capability')
  })

  it('runs a capability the sidecar declared open to the agent', async () => {
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
      entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'],
    }), 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    runCapability.mockResolvedValue({ result: { mails: 3 } })
    const result = await registeredTool()?.execute({ name: 'mail', input: { limit: 10 } }) as {
      name: string
      result?: unknown
      artifacts: readonly string[]
    }
    expect(result).toMatchObject({ name: 'mail', result: { mails: 3 }, artifacts: [] })
    expect(runCapability).toHaveBeenCalledWith(expect.objectContaining({ name: 'mail', input: { limit: 10 } }))
  })

  it('refuses a capability the sidecar did not open to the agent', async () => {
    skillGet.mockResolvedValue(definition())
    const failure = await registeredTool()?.execute({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'not-invocable' },
    })
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('hands an instruction capability\'s SKILL.md body back as the answer', async () => {
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human', 'agent'] }), 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {}, content: '# 指令正文' }))
    const result = await registeredTool()?.execute({ name: 'mail' }) as { content?: string; artifacts: readonly string[] }
    expect(result).toMatchObject({ name: 'mail', content: '# 指令正文', artifacts: [] })
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('runs a centrally routed skill the registry never discovered when the route opens it to the agent', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['human', 'agent'] } },
    }), 'utf8')
    skillGet.mockResolvedValue(undefined)
    const result = await registeredTool()?.execute({ name: 'routed-skill' }) as { content?: string; artifacts: readonly string[] }
    expect(result.content).toContain('路由正文')
    expect(result.artifacts).toEqual([])
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('refuses a routed capability whose route did not open it to the agent', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['human'] } },
    }), 'utf8')
    skillGet.mockResolvedValue(undefined)
    const failure = await registeredTool()?.execute({ name: 'routed-skill' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'not-invocable' },
    })
    expect(runCapability).not.toHaveBeenCalled()
  })
})

describe('agent-facing capability catalog (ADR-0023 决定 5)', () => {
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
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
      entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'],
    }), 'utf8')
    skillList.mockResolvedValue([{ name: 'mail', description: '读 Outlook 邮件', source: 'project' }])
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const decision = await preStep({ kind: 'enter', messages: userMessages('帮我看看邮件') })
    expect(decision.kind).toBe('enter')
    const messages = decision.kind === 'enter' ? decision.messages : []
    expect(messages).toHaveLength(2)
    const injected = messages[1] as unknown as {
      source: { kind: string; plugin: string; form: string; entries: readonly { name: string; description: string }[] }
      content: readonly { type: string; text: string }[]
    }
    expect(injected.source).toMatchObject({
      kind: 'plugin', plugin: 'yantao-kb-controller', form: 'catalog',
      entries: [{ name: 'mail', description: '读 Outlook 邮件' }],
    })
    expect(injected.content[0]?.text).toMatch(/kb_run_capability/)
  })

  it('leaves the turn untouched when no capability is open to the agent', async () => {
    skillList.mockResolvedValue([{ name: 'mail', description: '读 Outlook 邮件', source: 'project' }])
    skillGet.mockResolvedValue(definition())
    const decision = await preStep({ kind: 'enter', messages: [] })
    expect(decision.kind === 'enter' ? decision.messages : []).toHaveLength(0)
  })

  it('appends routed agent-open capabilities the registry cannot see', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n正文\n', 'utf8')
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['agent'] } },
    }), 'utf8')
    skillList.mockResolvedValue([])
    skillGet.mockResolvedValue(undefined)
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
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
      entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'],
    }), 'utf8')
    skillList.mockResolvedValue([{ name: 'mail', description: '读 Outlook 邮件', source: 'project' }])
    skillGet.mockResolvedValue(definition({ metadata: {} }))
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

describe('the /xxx gesture (ADR-0025 决定 3)', () => {
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

  it('injects an instruction capability\'s SKILL.md body for a leading /name', async () => {
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human'] }), 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {}, content: '# 指令正文' }))
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
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human'] }), 'utf8')
    skillGet.mockImplementation(async (name: string) =>
      name === 'mail' ? definition({ metadata: {} }) : undefined)
    for (const text of ['请 /mail 看看', '/unknown 做事']) {
      const decision = await preStep({ kind: 'enter', messages: userMessages(text) }, text)
      expect(injectedSources(decision)).toEqual([])
    }
  })

  it('answers a script-type hit with an ordinary notice, not instructions', async () => {
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
      entry: 'scripts/entry.py', runtime: 'python', invocation: ['human'],
    }), 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    )
    expect(injectedSources(decision)).toEqual([{ kind: 'plugin', form: 'notice' }])
  })

  it('keeps a human-disabled capability and a sidecar-less plain skill plain', async () => {
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['agent'] }), 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    // The gesture stays silent, but the capability is agent-open, so the
    // catalog still rides the step.
    expect(injectedSources(await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    ))).toEqual([{ kind: 'plugin', form: 'catalog' }])
    // No yantao.json and no legacy metadata: a plain skill, not a capability.
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    await rm(join(skillDir, 'yantao.json'), { force: true })
    expect(injectedSources(await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    ))).toEqual([])
  })

  it('lands the catalog before the skill instructions', async () => {
    await mkdir(join(home, '.dsh', 'skills', 'digest'), { recursive: true })
    await writeFile(join(home, '.dsh', 'skills', 'digest', 'SKILL.md'), '---\nname: digest\ndescription: d\nversion: 999\n---\n\n正文\n', 'utf8')
    await writeFile(join(home, '.dsh', 'skills', 'digest', 'yantao.json'), JSON.stringify({ invocation: ['human', 'agent'] }), 'utf8')
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human'] }), 'utf8')
    skillGet.mockImplementation(async (name: string) => name === 'mail'
      ? definition({ metadata: {}, content: '# 指令正文' })
      : definition({
        name, metadata: {}, content: '# d',
        resourceBase: { kind: 'directory', path: join(home, '.dsh', 'skills', name) },
      }))
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    )
    expect(injectedSources(decision)).toEqual([
      { kind: 'plugin', form: 'catalog' },
      { kind: 'skill-invocation', form: 'instructions' },
    ])
  })

  it('injects a routed capability\'s SKILL.md body even when the registry cannot see the skill', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['human'] } },
    }), 'utf8')
    skillGet.mockResolvedValue(undefined)
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
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({
      version: 1,
      capabilities: { 'routed-skill': { path: 'routed-skill', invocation: ['agent'] } },
    }), 'utf8')
    skillGet.mockResolvedValue(undefined)
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/routed-skill 做事') },
      '/routed-skill 做事',
    )
    // Human-closed, so no gesture injection; the route is agent-open, so the
    // catalog still rides the step.
    expect(injectedSources(decision)).toEqual([{ kind: 'plugin', form: 'catalog' }])
  })

  it('keeps the gesture silent when the central routing file is broken', async () => {
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), '{ not json', 'utf8')
    skillGet.mockResolvedValue(undefined)
    const decision = await preStep(
      { kind: 'enter', messages: userMessages('/mail 读一下') },
      '/mail 读一下',
    )
    expect(injectedSources(decision)).toEqual([])
  })
})
