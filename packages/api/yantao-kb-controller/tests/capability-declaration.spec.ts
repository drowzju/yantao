import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillDefinition, SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

// All mocks are read by `vi.mock` factories, which run before any top-level
// `let` is initialized — hence the hoisted holder.
const { state } = vi.hoisted(() => ({
  state: {
    home: '', kbConfigured: true, runCapability: vi.fn(), skillGet: vi.fn(), skillList: vi.fn(),
    registerProvider: vi.fn(), registerTool: vi.fn(),
  },
}))
const skillGet = state.skillGet
const skillList = state.skillList

// The capability state lives inside the KB root, so the suite's tmpdir is the
// whole KB; nothing reaches the developer's real `~` any more (ADR-0024).
let home: string

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => state.home,
}))

// `runCapability` is the one part that would need Python; the declaration
// introspection never reaches it, but the module mock keeps the suite free
// of any subprocess. Everything else — manifest parsing, entry candidates —
// stays real on purpose: that is exactly what the RPC must show.
vi.mock('../src/capability/run.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/capability/run.ts')>(),
  runCapability: state.runCapability,
}))

let ctx: Context
let fiber: { dispose(): Promise<void> }
let skillDir: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-declaration-'))
  state.home = home
  skillDir = join(home, '.dsh', 'skills', 'mail')
  await mkdir(join(skillDir, 'scripts'), { recursive: true })
  await writeFile(join(skillDir, 'scripts', 'entry.py'), 'print(1)', 'utf8')
  // A version far above the shipped master's keeps the builtin seeder from
  // overwriting this fake with the real mail capability mid-test.
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: mail\ndescription: 测试\nversion: 999\n---\n\n测试。\n', 'utf8')
  state.runCapability.mockReset()
  skillGet.mockReset()
  // `settleSkills` probes the registry until the names it is waiting for show
  // up; answering from the seeded directory makes that immediate.
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
    content: '',
    resourceBase: { kind: 'directory', path: skillDir },
    metadata: { yantao: { entry: 'scripts/entry.py', runtime: 'python' } },
    ...overrides,
  }
}

/** Write the central routing file by hand, as registration would leave it. */
async function writeCentral(capabilities: Record<string, unknown>): Promise<void> {
  await mkdir(join(home, '.dsh', 'skills'), { recursive: true })
  await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({ version: 1, capabilities }), 'utf8')
}

describe('yantaoKb.capabilityDeclaration', () => {
  it('refuses before a KB root has been chosen', async () => {
    state.kbConfigured = false
    const failure = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/capability', details: { kind: 'no-root' } })
    expect(skillGet).not.toHaveBeenCalled()
  })

  it('answers a script capability: raw sidecar, resolved fields, entry candidates and the winning path', async () => {
    await writeFile(
      join(skillDir, 'yantao.json'),
      JSON.stringify({ entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'] }),
      'utf8',
    )
    skillGet.mockResolvedValue(definition({ metadata: { version: 999 } }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.name).toBe('mail')
    expect(result.directory).toBe(skillDir)
    expect(result.sidecar.present).toBe(true)
    expect(result.sidecar.source).toBe('sidecar')
    expect(result.sidecar.raw).toContain('"entry"')
    expect(result.sidecar.problem).toBeUndefined()
    expect(result.sidecar.resolved).toMatchObject({
      kind: 'script',
      entry: 'scripts/entry.py',
      runtime: 'python',
      version: '999',
      invocation: ['human', 'agent'],
      entryPath: join(skillDir, 'scripts', 'entry.py'),
    })
    // The adapter-plane candidate rides along even when the local one wins.
    expect(result.sidecar.resolved?.entryCandidates).toEqual([
      join(skillDir, 'scripts', 'entry.py'),
      join(home, '.dsh', 'scripts', 'entry.py'),
    ])
    expect(result.route).toEqual({ registered: false })
    expect(result.agentInvocable).toBe(true)
  })

  it('answers an instruction capability declared by frontmatter alone', async () => {
    skillGet.mockResolvedValue(definition({
      metadata: { yantao: { invocation: ['human'] } },
      content: '# 指令正文',
    }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.sidecar.source).toBe('frontmatter')
    expect(result.sidecar.raw).toBeUndefined()
    expect(result.sidecar.resolved).toMatchObject({ kind: 'instruction', invocation: ['human'] })
    expect(result.sidecar.resolved?.entryCandidates).toBeUndefined()
    expect(result.agentInvocable).toBe(false)
  })

  it('spells out a missing sidecar and an unregistered route instead of throwing', async () => {
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.sidecar.present).toBe(false)
    expect(result.sidecar.problem).toContain('sidecar 不存在')
    expect(result.route.registered).toBe(false)
    expect(result.agentInvocable).toBe(false)
  })

  it('answers a centrally routed capability the registry never discovered', async () => {
    await writeCentral({ 'paper-digest': { path: 'repo/skills/paper-digest', invocation: ['human', 'agent'] } })
    skillGet.mockResolvedValue(undefined)
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'paper-digest' })
    expect(result.directory).toBeUndefined()
    expect(result.sidecar.present).toBe(false)
    expect(result.route).toMatchObject({
      registered: true,
      path: 'repo/skills/paper-digest',
      invocation: ['human', 'agent'],
    })
    expect(result.agentInvocable).toBe(true)
  })

  it('lets a broken sidecar fall back to the route for the agent gate, problem stated', async () => {
    await writeFile(join(skillDir, 'yantao.json'), '{ not json', 'utf8')
    await writeCentral({ mail: { path: 'mail', invocation: ['human', 'agent'] } })
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.sidecar.present).toBe(true)
    expect(result.sidecar.resolved).toBeUndefined()
    expect(result.sidecar.problem).toContain('不是合法 JSON')
    expect(result.route.registered).toBe(true)
    expect(result.agentInvocable).toBe(true)
  })

  it('shows a declared entry whose file is missing: candidates listed, no winning path', async () => {
    skillGet.mockResolvedValue(definition({
      metadata: { yantao: { entry: 'scripts/missing.py', runtime: 'python', invocation: ['human'] } },
    }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.sidecar.resolved?.kind).toBe('script')
    expect(result.sidecar.resolved?.entryPath).toBeUndefined()
    expect(result.sidecar.resolved?.entryCandidates).toEqual([
      join(skillDir, 'scripts', 'missing.py'),
      join(home, '.dsh', 'scripts', 'missing.py'),
    ])
  })

  it('shows an entry that escapes both roots as an empty candidate list', async () => {
    skillGet.mockResolvedValue(definition({
      metadata: { yantao: { entry: '../../outside.py', runtime: 'python' } },
    }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.sidecar.resolved?.entryCandidates).toEqual([])
    expect(result.sidecar.resolved?.entryPath).toBeUndefined()
  })

  it('resolves an adapter-plane entry outside the skill directory (ADR-0043 决定 2)', async () => {
    const adapter = join(home, '.dsh', 'yantao', 'capability-adapters', 'mail')
    await mkdir(adapter, { recursive: true })
    await writeFile(join(adapter, 'entry.py'), 'print(2)', 'utf8')
    skillGet.mockResolvedValue(definition({
      metadata: { yantao: { entry: 'yantao/capability-adapters/mail/entry.py', runtime: 'python' } },
    }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.sidecar.resolved?.entryPath).toBe(join(adapter, 'entry.py'))
    expect(result.sidecar.resolved?.entryCandidates).toHaveLength(2)
  })

  it('states a broken routing file in the route channel instead of throwing', async () => {
    await mkdir(join(home, '.dsh', 'skills'), { recursive: true })
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), '{ not json', 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: { yantao: { invocation: ['human', 'agent'] } } }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.route.registered).toBe(false)
    expect(result.route.problem).toContain('不是合法 JSON')
    // The sidecar channel still decides the gate on its own.
    expect(result.agentInvocable).toBe(true)
  })

  it('gates the agent by the sidecar even when the route would allow it (dual-gate precedence)', async () => {
    await writeCentral({ mail: { path: 'mail', invocation: ['human', 'agent'] } })
    skillGet.mockResolvedValue(definition({ metadata: { yantao: { invocation: ['human'] } } }))
    const result = await ctx.yantaoKbController.capabilityDeclaration({ name: 'mail' })
    expect(result.route.registered).toBe(true)
    expect(result.agentInvocable).toBe(false)
  })
})
