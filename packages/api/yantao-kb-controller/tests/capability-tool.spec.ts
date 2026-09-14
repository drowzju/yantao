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
  skillDir = join(home, 'skills', 'mail')
  await mkdir(join(skillDir, 'scripts'), { recursive: true })
  await writeFile(join(skillDir, 'scripts', 'entry.py'), 'print(1)', 'utf8')
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
