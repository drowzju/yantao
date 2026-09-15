import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillDefinition, SkillRegistry } from '@deepseek-ai/dsh-skill'
import {
  readCapabilityState, type YantaoKbService,
} from '@deepseek-ai/dsh-yantao-kb'
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

// The capability state lives inside the KB root, so the suite's tmpdir is the
// whole KB; nothing reaches the developer's real `~` any more (ADR-0024).
let home: string

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => state.home,
}))

// `runCapability` is the one part that would need Python; the rest — the
// manifest validation, the entry confinement, the artifact write-out, the
// state round trip — is ours, and `resolveEntry` stays real on purpose.
vi.mock('../src/capability/run.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/capability/run.ts')>(),
  runCapability: state.runCapability,
}))

let ctx: Context
let fiber: { dispose(): Promise<void> }
let skillDir: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-capability-'))
  state.home = home
  skillDir = join(home, '.dsh', 'skills', 'mail')
  await mkdir(join(skillDir, 'scripts'), { recursive: true })
  await writeFile(join(skillDir, 'scripts', 'entry.py'), 'print(1)', 'utf8')
  // A version far above the shipped master's keeps the builtin seeder from
  // overwriting this fake with the real mail capability mid-test.
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: mail\ndescription: 测试\nversion: 999\n---\n\n测试。\n', 'utf8')
  runCapability.mockReset()
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
  // The capability RPCs resolve through the skill registry; a three-method
  // stand-in is the whole surface this controller reads.
  ctx.provide('skills', {
    get: skillGet,
    list: skillList,
    registerProvider: state.registerProvider,
  } as unknown as SkillRegistry)
  // The controller registers kb_run_capability (ADR-0023); a one-method
  // stand-in captures the registration without the real tool registry.
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

describe('yantaoKb.capabilityRun', () => {
  it('refuses to run before a KB root has been chosen', async () => {
    state.kbConfigured = false
    const failure = await ctx.yantaoKbController.capabilityRun({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/capability', details: { kind: 'no-root' } })
    expect(skillGet).not.toHaveBeenCalled()
  })

  it('reports a capability the registry does not know', async () => {
    skillGet.mockResolvedValue(undefined)
    const failure = await ctx.yantaoKbController.capabilityRun({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/capability', details: { kind: 'not-found' } })
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('refuses a skill resolved from outside the KB (single source, ADR-0024)', async () => {
    skillGet.mockResolvedValue(definition({
      resourceBase: { kind: 'directory', path: join(home, 'elsewhere', 'mail') },
    }))
    const failure = await ctx.yantaoKbController.capabilityRun({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/capability', details: { kind: 'not-found' } })
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('refuses a skill directory without a yantao declaration', async () => {
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const failure = await ctx.yantaoKbController.capabilityRun({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/capability', details: { kind: 'bad-manifest' } })
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('refuses an entry that escapes the capability directory', async () => {
    skillGet.mockResolvedValue(definition({
      metadata: { yantao: { entry: '../outside.py', runtime: 'python' } },
    }))
    const failure = await ctx.yantaoKbController.capabilityRun({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/capability', details: { kind: 'bad-manifest' } })
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('runs the entry, writes its artifacts, and persists its state', async () => {
    skillGet.mockResolvedValue(definition())
    runCapability.mockResolvedValue({
      result: { messages: [] },
      state: { lastReadAt: '2026-09-12T00:00:00.000Z' },
      artifacts: [{ name: 'summary.json', contentBase64: Buffer.from('{"mails":0}').toString('base64') }],
    })
    const result = await ctx.yantaoKbController.capabilityRun({ name: 'mail', input: { limit: 50 } })
    expect(runCapability).toHaveBeenCalledWith(expect.objectContaining({
      name: 'mail',
      directory: skillDir,
      entryPath: join(skillDir, 'scripts', 'entry.py'),
      kbRoot: home,
      input: { limit: 50 },
      state: undefined,
    }))
    expect(result.name).toBe('mail')
    expect(result.result).toEqual({ messages: [] })
    expect(result.artifacts).toEqual(['.yantao/capabilities/mail/summary.json'])
    expect(await readFile(join(home, '.yantao', 'capabilities', 'mail', 'summary.json'), 'utf8')).toBe('{"mails":0}')
    expect(readCapabilityState(home, 'mail')).toEqual({ lastReadAt: '2026-09-12T00:00:00.000Z' })
  })

  it('hands the previous state to the next run', async () => {
    skillGet.mockResolvedValue(definition())
    runCapability.mockResolvedValue({ state: { lastReadAt: '2026-09-12T00:00:00.000Z' } })
    await ctx.yantaoKbController.capabilityRun({ name: 'mail' })
    runCapability.mockResolvedValue({ result: 'second' })
    await ctx.yantaoKbController.capabilityRun({ name: 'mail' })
    expect(runCapability).toHaveBeenLastCalledWith(expect.objectContaining({
      state: { lastReadAt: '2026-09-12T00:00:00.000Z' },
    }))
  })

  it('surfaces the script\'s own failure kind, message, and remedy', async () => {
    const { CapabilityError } = await import('../src/capability/run.ts')
    skillGet.mockResolvedValue(definition())
    runCapability.mockRejectedValue(new CapabilityError('capability-failed', 'Outlook 没有应答', '请确认 Outlook 已登录'))
    const failure = await ctx.yantaoKbController.capabilityRun({ name: 'mail' }).catch((error: unknown) => error)
    const error = remoteErrorOf(failure)
    expect(error).toMatchObject({
      code: 'yantao-kb/capability',
      message: 'Outlook 没有应答',
      details: { kind: 'capability-failed', hint: '请确认 Outlook 已登录' },
    })
  })
  it('answers an instruction capability with the SKILL.md body instead of a run', async () => {
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human', 'agent'] }), 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {}, content: '# 指令正文' }))
    const result = await ctx.yantaoKbController.capabilityRun({ name: 'mail' })
    expect(result).toMatchObject({ name: 'mail', content: '# 指令正文', artifacts: [] })
    expect(result.result).toBeUndefined()
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('answers an instruction capability with no sidecar entry as human-only when the frontmatter declares', async () => {
    skillGet.mockResolvedValue(definition({
      metadata: { yantao: { runtime: 'python' } },
      content: '# 指令正文',
    }))
    const result = await ctx.yantaoKbController.capabilityRun({ name: 'mail' })
    expect(result.content).toBe('# 指令正文')
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('answers a centrally routed skill the registry never discovered', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeCentral({ 'routed-skill': { path: 'routed-skill', invocation: ['human'] } })
    skillGet.mockResolvedValue(undefined)
    const result = await ctx.yantaoKbController.capabilityRun({ name: 'routed-skill' })
    expect(result.content).toContain('路由正文')
    expect(result.artifacts).toEqual([])
    expect(result.result).toBeUndefined()
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('lets a valid sidecar beat a same-named central route', async () => {
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human'] }), 'utf8')
    await writeCentral({ mail: { path: 'elsewhere/mail', invocation: ['human'] } })
    skillGet.mockResolvedValue(definition({ metadata: {}, content: '# sidecar 正文' }))
    const result = await ctx.yantaoKbController.capabilityRun({ name: 'mail' })
    expect(result.content).toBe('# sidecar 正文')
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('surfaces a broken central routing file as bad-manifest on the run path', async () => {
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), '{ not json', 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const failure = await ctx.yantaoKbController.capabilityRun({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'bad-manifest' },
    })
    expect(runCapability).not.toHaveBeenCalled()
  })
})

describe('yantaoKb.capabilityList', () => {
  it('lists skills that declare a yantao manifest and skips plain skills', async () => {
    skillList.mockResolvedValue([
      { name: 'mail', description: '读 Outlook 邮件', source: 'project', resourceBase: { kind: 'directory', path: skillDir }, invocation: { modelInvocable: false, userInvocable: true } },
      { name: 'plain', description: '普通技能', source: 'project', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockImplementation(async (name: string) =>
      name === 'mail' ? definition() : definition({ name, metadata: {} }))
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]).toMatchObject({
      name: 'mail',
      description: '读 Outlook 邮件',
      source: 'project',
      directory: skillDir,
      entry: 'scripts/entry.py',
      runtime: 'python',
    })
    expect(capabilities[0]?.lastRunAt).toBeUndefined()
    expect(capabilities[0]?.state).toBeUndefined()
  })

  it('offers a manifest-carrying skill that lives outside the KB for adoption, not registration (ADR-0024/0025)', async () => {
    skillList.mockResolvedValue([
      { name: 'mail', description: '读 Outlook 邮件', source: 'project', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue(definition({
      resourceBase: { kind: 'directory', path: join(home, 'elsewhere', 'mail') },
    }))
    const { capabilities, unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities).toEqual([])
    expect(unregistered.map(skill => skill.name)).toEqual(['mail'])
  })

  it('merges the persisted record: when it last ran and the state it left', async () => {
    skillGet.mockResolvedValue(definition())
    skillList.mockResolvedValue([{ name: 'mail', description: '读 Outlook 邮件', source: 'project' }])
    runCapability.mockResolvedValue({ result: { ok: 1 }, state: { lastReadAt: '2026-09-12T00:00:00.000Z' } })
    await ctx.yantaoKbController.capabilityRun({ name: 'mail' })
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities[0]?.lastRunAt).toEqual(expect.any(String))
    expect(capabilities[0]?.state).toEqual({ lastReadAt: '2026-09-12T00:00:00.000Z' })
  })

  it('seeds the shipped capabilities into the KB before listing', async () => {
    skillGet.mockResolvedValue(definition())
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    // The seeding itself is covered by capability-builtin.spec; here it is
    // enough that a fresh KB answers with the shipped capability.
    expect(capabilities.map(capability => capability.name)).toEqual(expect.arrayContaining(['mail']))
  })

  it('lists instruction capabilities with entry/runtime absent and invocation present', async () => {
    skillList.mockResolvedValue([{ name: 'mail', description: '读 Outlook 邮件', source: 'project' }])
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human', 'agent'] }), 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]).toMatchObject({ name: 'mail', invocation: ['human', 'agent'] })
    expect(capabilities[0]?.entry).toBeUndefined()
    expect(capabilities[0]?.runtime).toBeUndefined()
  })

  it('reports a sidecar-declared capability as open to both channels', async () => {
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
      entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'],
    }), 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities.find(capability => capability.name === 'mail')?.invocation).toEqual(['human', 'agent'])
  })

  it('lists a routed capability with its description from the routed SKILL.md', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n正文\n', 'utf8')
    await writeCentral({ 'routed-skill': { path: 'routed-skill', invocation: ['human', 'agent'] } })
    skillList.mockResolvedValue([])
    skillGet.mockResolvedValue(undefined)
    const { capabilities, unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toEqual([])
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]).toMatchObject({
      name: 'routed-skill',
      description: '路由技能',
      source: 'kb',
      directory,
      invocation: ['human', 'agent'],
    })
  })

  it('does not duplicate a capability a sidecar already declared when a route claims the name', async () => {
    skillList.mockResolvedValue([{ name: 'mail', description: '读 Outlook 邮件', source: 'project' }])
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human'] }), 'utf8')
    await writeCentral({ mail: { path: 'mail', invocation: ['agent'] } })
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]).toMatchObject({ name: 'mail', invocation: ['human'] })
  })

  it('skips a stale route whose target lost its SKILL.md', async () => {
    await writeCentral({ ghost: { path: 'ghost', invocation: ['human'] } })
    skillList.mockResolvedValue([])
    skillGet.mockResolvedValue(undefined)
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities).toEqual([])
  })

  it('answers the listing without routes when the central routing file is broken', async () => {
    skillList.mockResolvedValue([{ name: 'mail', description: '读 Outlook 邮件', source: 'project' }])
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ invocation: ['human'] }), 'utf8')
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), '{ not json', 'utf8')
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities.map(capability => capability.name)).toEqual(['mail'])
  })

  it('does not offer a name for registration or adoption when a route already claims it', async () => {
    // In KB, no declaration: normally a greyed 未注册 row — but the route wins.
    const directory = join(home, '.dsh', 'skills', 'notes-helper')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: notes-helper\ndescription: KB 内技能\n---\n\n照做。\n', 'utf8')
    await writeCentral({
      'notes-helper': { path: 'notes-helper', invocation: ['human'] },
      outside: { path: 'outside', invocation: ['human'] },
    })
    skillList.mockResolvedValue([
      { name: 'notes-helper', description: 'KB 内技能', source: 'custom', invocation: { modelInvocable: true, userInvocable: true } },
      // Out of KB: normally an adoption candidate — but the route wins.
      { name: 'outside', description: '外面', source: 'user', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockImplementation(async (name: string) => {
      if (name === 'notes-helper') {
        return {
          name, description: 'KB 内技能',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'custom', provider: 'skill-filesystem', content: '',
          resourceBase: { kind: 'directory', path: directory },
          path: join(directory, 'SKILL.md'), metadata: {},
        } satisfies SkillDefinition
      }
      return {
        name: 'outside', description: '外面',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'user', provider: 'skill-filesystem', content: '',
        resourceBase: { kind: 'directory', path: join(home, 'user-skills', 'outside') },
        path: join(home, 'user-skills', 'outside', 'SKILL.md'), metadata: {},
      } satisfies SkillDefinition
    })
    const { capabilities, unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toEqual([])
    expect(capabilities.map(capability => capability.name)).toEqual(['notes-helper'])
  })
})

describe('yantaoKb.capabilityCreate', () => {
  it('scaffolds a working capability directory and settles it into the registry', async () => {
    const result = await ctx.yantaoKbController.capabilityCreate({ name: 'daily-note' })
    expect(result.path).toBe('.dsh/skills/daily-note')
    const directory = join(home, '.dsh', 'skills', 'daily-note')
    // The SKILL.md stays clean; the declaration lives in the sidecar.
    const skillMd = await readFile(join(directory, 'SKILL.md'), 'utf8')
    expect(skillMd).toContain('name: daily-note')
    expect(skillMd).not.toMatch(/yantao:/)
    expect(JSON.parse(await readFile(join(directory, 'yantao.json'), 'utf8'))).toMatchObject({
      entry: 'scripts/entry.py',
      runtime: 'python',
      invocation: ['human'],
      version: 1,
    })
    expect(await readFile(join(directory, 'scripts', 'entry.py'), 'utf8'))
      .toMatch(/json\.load/)
    // The scaffold was probed into the registry, so the panel's next list sees it.
    expect(skillList).toHaveBeenCalledWith({ cwd: home })
  })

  it('refuses a bad name and an existing directory', async () => {
    const bad = await ctx.yantaoKbController.capabilityCreate({ name: '大写X' }).catch((error: unknown) => error)
    expect(remoteErrorOf(bad)).toMatchObject({ code: 'yantao-kb/rejected' })
    await ctx.yantaoKbController.capabilityCreate({ name: 'twice' })
    const again = await ctx.yantaoKbController.capabilityCreate({ name: 'twice' }).catch((error: unknown) => error)
    expect(remoteErrorOf(again)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((again as Error).message).toMatch(/已存在/)
  })
})

describe('capability manifests', () => {
  it('accepts an entry that stays inside the directory and exists', async () => {
    const { resolveEntry } = await import('../src/capability/run.ts')
    const resolved = resolveEntry(definition())
    expect(resolved.entryPath).toBe(join(skillDir, 'scripts', 'entry.py'))
  })

  it('refuses an entry file that does not exist', async () => {
    const { resolveEntry } = await import('../src/capability/run.ts')
    const failure = (() => {
      try {
        resolveEntry(definition({ metadata: { yantao: { entry: 'scripts/missing.py', runtime: 'python' } } }))
        return undefined
      } catch (error) {
        return error
      }
    })()
    expect(failure).toMatchObject({ kind: 'bad-manifest' })
  })

  it('lowercases declared resource suffixes and refuses bare ones', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    const manifest = manifestOf(definition({
      metadata: { yantao: { entry: 'scripts/entry.py', runtime: 'python', appliesTo: { resource: ['.EPUB'] } } },
    }))
    expect(manifest.appliesTo).toEqual({ resource: ['.epub'] })
    expect(() => manifestOf(definition({
      metadata: { yantao: { entry: 'scripts/entry.py', runtime: 'python', appliesTo: { resource: ['epub'] } } },
    }))).toThrow(/带点的扩展名/)
  })

  it('parses the selection opt-in and refuses a non-boolean one (ADR-0025 决定 5)', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    const manifest = manifestOf(definition({
      metadata: { yantao: { appliesTo: { selection: true } } },
    }))
    expect(manifest.appliesTo).toEqual({ selection: true })
    expect(() => manifestOf(definition({
      metadata: { yantao: { appliesTo: { selection: 'yes' } } },
    }))).toThrow(/appliesTo\.selection 必须是布尔值/)
  })

  it('accepts resource: true as every-resource and refuses a non-boolean non-list', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    const manifest = manifestOf(definition({
      metadata: { yantao: { appliesTo: { resource: true } } },
    }))
    expect(manifest.appliesTo).toEqual({ resource: true })
    expect(() => manifestOf(definition({
      metadata: { yantao: { appliesTo: { resource: 'all' } } },
    }))).toThrow(/appliesTo\.resource/)
  })

  it('reads the declaration from the yantao.json sidecar, frontmatter untouched', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
      entry: 'scripts/entry.py',
      runtime: 'python',
      appliesTo: { external: ['mailbox'] },
    }), 'utf8')
    // No `metadata.yantao` at all — the sidecar alone makes it a capability.
    const manifest = manifestOf(definition({ metadata: {} }))
    expect(manifest).toEqual({
      entry: 'scripts/entry.py',
      runtime: 'python',
      appliesTo: { external: ['mailbox'] },
      invocation: ['human'],
    })
  })

  it('prefers the sidecar over the frontmatter when both declare', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
      entry: 'scripts/other.py', runtime: 'python',
    }), 'utf8')
    await writeFile(join(skillDir, 'scripts', 'other.py'), 'print(2)', 'utf8')
    const manifest = manifestOf(definition())
    expect(manifest.entry).toBe('scripts/other.py')
  })

  it('refuses a sidecar that is not valid JSON instead of falling back', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    await writeFile(join(skillDir, 'yantao.json'), '{ not json', 'utf8')
    expect(() => manifestOf(definition())).toThrow(/不是合法 JSON/)
  })

  it('treats a sidecar without an entry as an instruction capability, human-only by default', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ runtime: 'python' }), 'utf8')
    const manifest = manifestOf(definition({ metadata: {} }))
    expect(manifest.entry).toBeUndefined()
    expect(manifest.invocation).toEqual(['human'])
  })

  it('reads invocation off the sidecar and refuses a malformed one', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
      entry: 'scripts/entry.py', runtime: 'python', invocation: ['human', 'agent'],
    }), 'utf8')
    expect(manifestOf(definition({ metadata: {} })).invocation).toEqual(['human', 'agent'])
    for (const invocation of [['model'], 'agent', []]) {
      await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({
        entry: 'scripts/entry.py', runtime: 'python', invocation,
      }), 'utf8')
      expect(() => manifestOf(definition({ metadata: {} }))).toThrow(/invocation/)
    }
  })

  it('refuses an empty string entry', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ entry: '', runtime: 'python' }), 'utf8')
    expect(() => manifestOf(definition({ metadata: {} }))).toThrow(/entry/)
  })
})

describe('capabilityList 未注册 group (ADR-0025)', () => {
  /** An out-of-KB directory-bundle skill, as `~/.dsh/skills` discovery would report it. */
  function outside(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
    const directory = join(home, 'user-skills', overrides.name ?? 'notes-helper')
    return {
      name: 'notes-helper',
      description: '整理笔记',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'user',
      provider: 'skill-filesystem',
      content: '',
      resourceBase: { kind: 'directory', path: directory },
      path: join(directory, 'SKILL.md'),
      metadata: {},
      ...overrides,
    }
  }

  it('lists out-of-KB directory bundles name-sorted, with a sidecar preview when one exists', async () => {
    const z = outside({ name: 'zeta-tool' })
    const a = outside({ name: 'alpha-tool' })
    const zDir = join(home, 'user-skills', 'zeta-tool')
    await mkdir(zDir, { recursive: true })
    await writeFile(join(zDir, 'yantao.json'), JSON.stringify({ appliesTo: { resource: ['.md'] } }), 'utf8')
    skillList.mockResolvedValue([
      { name: 'zeta-tool', description: 'z', source: 'user', invocation: { modelInvocable: true, userInvocable: true } },
      { name: 'alpha-tool', description: 'a', source: 'user', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockImplementation(async (name: string) => (name === 'zeta-tool' ? z : a))
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered.map(skill => skill.name)).toEqual(['alpha-tool', 'zeta-tool'])
    expect(unregistered[1]).toMatchObject({
      name: 'zeta-tool', source: 'user', directory: zDir,
      userInvocable: true, flat: false,
      sidecar: { appliesTo: { resource: ['.md'] } },
    })
  })

  it('greys a flat single-file skill out and never offers a directory', async () => {
    const flat = outside({ name: 'quick', path: join(home, 'user-skills', 'quick.md') })
    skillList.mockResolvedValue([
      { name: 'quick', description: '扁平技能', source: 'user', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue(flat)
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toHaveLength(1)
    expect(unregistered[0]).toMatchObject({ name: 'quick', flat: true, userInvocable: true })
    expect(unregistered[0]?.directory).toBeUndefined()
    expect(unregistered[0]?.sidecar).toBeUndefined()
  })

  it('carries user-invocable: false as the grey-out reason', async () => {
    skillList.mockResolvedValue([
      { name: 'notes-helper', description: '整理笔记', source: 'user', invocation: { modelInvocable: true, userInvocable: false } },
    ])
    skillGet.mockResolvedValue(outside({ invocation: { modelInvocable: true, userInvocable: false } }))
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered[0]).toMatchObject({ name: 'notes-helper', userInvocable: false })
  })

  it('never lists dsh-bundled skills as adoption candidates', async () => {
    skillList.mockResolvedValue([
      { name: 'dsh-badge', description: 'badge', source: 'bundled', resourceBase: { kind: 'directory', path: join(home, 'bundled', 'dsh-badge') } },
    ])
    skillGet.mockResolvedValue(outside({ name: 'dsh-badge', source: 'bundled' }))
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toEqual([])
  })

  it('surfaces an in-KB skill without a declaration as a greyed inKb row', async () => {
    const directory = join(home, '.dsh', 'skills', 'notes-helper')
    skillList.mockResolvedValue([
      { name: 'notes-helper', description: '整理笔记', source: 'custom', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue({
      name: 'notes-helper', description: '整理笔记',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: directory },
      path: join(directory, 'SKILL.md'), metadata: {},
    } satisfies SkillDefinition)
    const { capabilities, unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities).toEqual([])
    expect(unregistered).toHaveLength(1)
    expect(unregistered[0]).toMatchObject({ name: 'notes-helper', inKb: true, flat: false, directory })
    expect(unregistered[0]?.reason).toMatch(/没有能力声明/)
  })

  it('carries the sidecar validation failure as an in-KB row reason', async () => {
    const directory = join(home, '.dsh', 'skills', 'broken')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'yantao.json'), '{ "entry": 42 }', 'utf8')
    skillList.mockResolvedValue([
      { name: 'broken', description: '坏声明', source: 'custom', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue({
      name: 'broken', description: '坏声明',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: directory },
      path: join(directory, 'SKILL.md'), metadata: {},
    } satisfies SkillDefinition)
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered[0]).toMatchObject({ name: 'broken', inKb: true })
    expect(unregistered[0]?.reason).toMatch(/entry/)
  })

  it('greys a flat in-KB skill out with no directory to register into', async () => {
    skillList.mockResolvedValue([
      { name: 'quick', description: '扁平技能', source: 'custom', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue({
      name: 'quick', description: '扁平技能',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: join(home, '.dsh', 'skills') },
      path: join(home, '.dsh', 'skills', 'quick.md'), metadata: {},
    } satisfies SkillDefinition)
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toHaveLength(1)
    expect(unregistered[0]).toMatchObject({ name: 'quick', inKb: true, flat: true })
    expect(unregistered[0]?.directory).toBeUndefined()
  })
})

describe('yantaoKb.capabilityAdopt (ADR-0025)', () => {
  /** Seed one out-of-KB directory-bundle skill on disk and in the registry stand-in. */
  async function seedOutside(name: string): Promise<string> {
    const directory = join(home, 'user-skills', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: 三方技能\n---\n\n# ${name}\n\n照做。\n`, 'utf8')
    skillList.mockResolvedValue([
      { name, description: '三方技能', source: 'user', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue({
      name,
      description: '三方技能',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'user',
      provider: 'skill-filesystem',
      content: '照做。',
      resourceBase: { kind: 'directory', path: directory },
      path: join(directory, 'SKILL.md'),
      metadata: {},
    } satisfies SkillDefinition)
    return directory
  }

  it('copies the bundle into the KB and routes it in the central file', async () => {
    const source = await seedOutside('notes-helper')
    const result = await ctx.yantaoKbController.capabilityAdopt({ name: 'notes-helper' })
    expect(result.path).toBe('.dsh/skills/notes-helper')
    const target = join(home, '.dsh', 'skills', 'notes-helper')
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('照做')
    // No sidecar in the copy — the declaration is the central route.
    expect(await stat(join(target, 'yantao.json')).then(() => true, () => false)).toBe(false)
    expect(JSON.parse(await readFile(join(home, '.dsh', 'skills', 'yantao.json'), 'utf8'))).toEqual({
      version: 1,
      capabilities: { 'notes-helper': { path: 'notes-helper', invocation: ['human'] } },
    })
    // Copy, never move: the source stays for the other dsh usages.
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toContain('照做')
  })

  it('strips a sidecar the source carried — outside declarations never take effect', async () => {
    const source = await seedOutside('scripted')
    await writeFile(join(source, 'yantao.json'), JSON.stringify({ entry: 'scripts/run.py', invocation: ['human', 'agent'] }), 'utf8')
    await ctx.yantaoKbController.capabilityAdopt({ name: 'scripted' })
    const target = join(home, '.dsh', 'skills', 'scripted')
    expect(await stat(join(target, 'yantao.json')).then(() => true, () => false)).toBe(false)
    expect(JSON.parse(await readFile(join(home, '.dsh', 'skills', 'yantao.json'), 'utf8')).capabilities.scripted)
      .toEqual({ path: 'scripted', invocation: ['human'] })
    // The source keeps its own sidecar; only the copy is stripped.
    expect(await readFile(join(source, 'yantao.json'), 'utf8')).toContain('agent')
  })

  it('refuses a name collision instead of overwriting', async () => {
    await seedOutside('mail')
    await mkdir(join(home, '.dsh', 'skills', 'mail'), { recursive: true })
    const failure = await ctx.yantaoKbController.capabilityAdopt({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/已存在/)
  })

  it('refuses a skill its frontmatter marked user-invocable: false', async () => {
    await seedOutside('quiet')
    skillGet.mockResolvedValue({
      name: 'quiet', description: '安静', invocation: { modelInvocable: true, userInvocable: false },
      source: 'user', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: join(home, 'user-skills', 'quiet') },
      path: join(home, 'user-skills', 'quiet', 'SKILL.md'), metadata: {},
    })
    const failure = await ctx.yantaoKbController.capabilityAdopt({ name: 'quiet' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/user-invocable/)
  })

  it('refuses a skill that already lives inside the KB and a flat one', async () => {
    // Inside the KB: the single-source filter's own side of the line.
    skillGet.mockResolvedValue(definition({ metadata: {} }))
    const inside = await ctx.yantaoKbController.capabilityAdopt({ name: 'mail' }).catch((error: unknown) => error)
    expect((inside as Error).message).toMatch(/找不到可采纳的技能/)
    // A flat skill's resourceBase is the shared root — nothing to copy.
    skillGet.mockResolvedValue({
      name: 'quick', description: '扁平', invocation: { modelInvocable: true, userInvocable: true },
      source: 'user', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: join(home, 'user-skills') },
      path: join(home, 'user-skills', 'quick.md'), metadata: {},
    })
    const flat = await ctx.yantaoKbController.capabilityAdopt({ name: 'quick' }).catch((error: unknown) => error)
    expect((flat as Error).message).toMatch(/找不到可采纳的技能/)
  })

  it('refuses to run before a KB root has been chosen', async () => {
    state.kbConfigured = false
    const failure = await ctx.yantaoKbController.capabilityAdopt({ name: 'notes-helper' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })
})

describe('yantaoKb.capabilityRegister (ADR-0025)', () => {
  /** Seed one in-KB directory-bundle skill without a declaration, on disk and in the registry stand-in. */
  async function seedInside(name: string): Promise<string> {
    const directory = join(home, '.dsh', 'skills', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: KB 内技能\n---\n\n照做。\n`, 'utf8')
    skillList.mockResolvedValue([
      { name, description: 'KB 内技能', source: 'custom', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue({
      name, description: 'KB 内技能',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: directory },
      path: join(directory, 'SKILL.md'), metadata: {},
    } satisfies SkillDefinition)
    return directory
  }

  /** The central routing file's parsed content, as registration leaves it. */
  async function central(): Promise<{ version: number; capabilities: Record<string, unknown> }> {
    return JSON.parse(await readFile(join(home, '.dsh', 'skills', 'yantao.json'), 'utf8'))
  }

  it('writes a route entry into the central routing file, no copy', async () => {
    const directory = await seedInside('notes-helper')
    const result = await ctx.yantaoKbController.capabilityRegister({ name: 'notes-helper' })
    expect(result.path).toBe('.dsh/skills/yantao.json')
    expect(await central()).toEqual({
      version: 1,
      capabilities: { 'notes-helper': { path: 'notes-helper', invocation: ['human'] } },
    })
    // Pure configuration: the skill directory keeps exactly the files it had.
    expect((await readdir(directory)).sort()).toEqual(['SKILL.md'])
  })

  it('carries the chosen reach into the route entry', async () => {
    await seedInside('wide')
    await ctx.yantaoKbController.capabilityRegister({
      name: 'wide', agentInvoke: true, resourceMenu: true, selectionMenu: true,
    })
    expect((await central()).capabilities.wide).toEqual({
      path: 'wide', invocation: ['human', 'agent'], appliesTo: { resource: true, selection: true },
    })
  })

  it('overwrites the route entry on re-register', async () => {
    await seedInside('notes-helper')
    await ctx.yantaoKbController.capabilityRegister({ name: 'notes-helper' })
    await ctx.yantaoKbController.capabilityRegister({ name: 'notes-helper', agentInvoke: true })
    expect((await central()).capabilities['notes-helper'])
      .toEqual({ path: 'notes-helper', invocation: ['human', 'agent'] })
  })

  it('refuses a directory that carries an invalid yantao.json', async () => {
    const directory = await seedInside('broken')
    await writeFile(join(directory, 'yantao.json'), '{ "entry": 42 }', 'utf8')
    const failure = await ctx.yantaoKbController.capabilityRegister({ name: 'broken' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/先删除或修复/)
    // The broken sidecar is left for the human to deal with.
    expect(await readFile(join(directory, 'yantao.json'), 'utf8')).toBe('{ "entry": 42 }')
    expect(await stat(join(home, '.dsh', 'skills', 'yantao.json')).then(() => true, () => false)).toBe(false)
  })

  it('refuses a skill that is already a capability', async () => {
    skillGet.mockResolvedValue(definition({ path: join(skillDir, 'SKILL.md') }))
    const failure = await ctx.yantaoKbController.capabilityRegister({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/已经是能力/)
  })

  it('refuses an out-of-KB skill, a flat one, and a user-invocable: false one', async () => {
    skillGet.mockResolvedValue({
      ...definition(), resourceBase: { kind: 'directory', path: join(home, 'user-skills', 'mail') },
    })
    const outside = await ctx.yantaoKbController.capabilityRegister({ name: 'mail' }).catch((error: unknown) => error)
    expect((outside as Error).message).toMatch(/找不到可注册的技能/)
    skillGet.mockResolvedValue({
      name: 'quick', description: '扁平', invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: join(home, '.dsh', 'skills') },
      path: join(home, '.dsh', 'skills', 'quick.md'), metadata: {},
    } satisfies SkillDefinition)
    const flat = await ctx.yantaoKbController.capabilityRegister({ name: 'quick' }).catch((error: unknown) => error)
    expect((flat as Error).message).toMatch(/找不到可注册的技能/)
    skillGet.mockResolvedValue(definition({
      invocation: { modelInvocable: true, userInvocable: false },
      path: join(skillDir, 'SKILL.md'),
    }))
    const quiet = await ctx.yantaoKbController.capabilityRegister({ name: 'mail' }).catch((error: unknown) => error)
    expect((quiet as Error).message).toMatch(/user-invocable/)
  })

  it('refuses to run before a KB root has been chosen', async () => {
    state.kbConfigured = false
    const failure = await ctx.yantaoKbController.capabilityRegister({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })
})

describe('plugin repository registration (ADR-0025 落地注记二)', () => {
  /** Seed a Claude-style plugin repository: no top-level SKILL.md, nested `skills/<name>/SKILL.md`. */
  async function seedPlugin(repo: string, nested: readonly string[]): Promise<string> {
    const repository = join(home, '.dsh', 'skills', repo)
    for (const name of nested) {
      const directory = join(repository, 'skills', name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: 插件内技能\n---\n\n照做。\n`, 'utf8')
    }
    await mkdir(join(repository, '.claude-plugin'), { recursive: true })
    await writeFile(join(repository, '.claude-plugin', 'plugin.json'), '{}', 'utf8')
    // The registry never sees the repository — its scan is one level deep.
    skillList.mockResolvedValue([])
    skillGet.mockResolvedValue(undefined)
    return repository
  }

  /** The central routing file's parsed content, as registration leaves it. */
  async function central(): Promise<{ version: number; capabilities: Record<string, unknown> }> {
    return JSON.parse(await readFile(join(home, '.dsh', 'skills', 'yantao.json'), 'utf8'))
  }

  it('lists a dropped plugin repository in the 未注册 group with its nested skills', async () => {
    await seedPlugin('diagram-design', ['diagram-design'])
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toHaveLength(1)
    expect(unregistered[0]).toMatchObject({
      name: 'diagram-design', inKb: true, plugin: true, pluginSkills: ['diagram-design'],
    })
    expect(unregistered[0]?.reason).toMatch(/中央路由/)
  })

  it('routes each nested skill in the central file, repository untouched', async () => {
    const repository = await seedPlugin('diagram-design', ['diagram-design'])
    const result = await ctx.yantaoKbController.capabilityRegister({ name: 'diagram-design' })
    expect(result.path).toBe('.dsh/skills/yantao.json')
    expect(await central()).toEqual({
      version: 1,
      capabilities: {
        'diagram-design': { path: 'diagram-design/skills/diagram-design', invocation: ['human'] },
      },
    })
    // The repository tree is byte-identical: the nested bundle stays put and
    // no top-level SKILL.md appeared.
    expect(await readFile(join(repository, 'skills', 'diagram-design', 'SKILL.md'), 'utf8')).toContain('照做')
    await expect(stat(join(repository, 'SKILL.md'))).rejects.toThrow()
  })

  it('writes the chosen reach into every child entry', async () => {
    await seedPlugin('pack', ['alpha', 'beta'])
    const result = await ctx.yantaoKbController.capabilityRegister({ name: 'pack', agentInvoke: true, selectionMenu: true })
    expect(result.path).toBe('.dsh/skills/yantao.json')
    const { capabilities } = await central()
    expect(capabilities.alpha).toEqual({
      path: 'pack/skills/alpha', invocation: ['human', 'agent'], appliesTo: { selection: true },
    })
    expect(capabilities.beta).toEqual({
      path: 'pack/skills/beta', invocation: ['human', 'agent'], appliesTo: { selection: true },
    })
  })

  it('refuses when a child name collides with an existing sidecar capability', async () => {
    await seedPlugin('pack', ['mail'])
    skillGet.mockImplementation(async (name: string) => name === 'mail' ? definition() : undefined)
    const failure = await ctx.yantaoKbController.capabilityRegister({ name: 'pack' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/同名/)
    // All-or-nothing: no route entry was written.
    expect(await stat(join(home, '.dsh', 'skills', 'yantao.json')).then(() => true, () => false)).toBe(false)
  })

  it('refuses a child name that cannot be a capability name', async () => {
    const repository = join(home, '.dsh', 'skills', 'pack')
    const directory = join(repository, 'skills', '坏 名字')
    await mkdir(join(directory, 'skills'), { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: x\ndescription: d\n---\n\n照做。\n', 'utf8')
    await mkdir(join(repository, '.claude-plugin'), { recursive: true })
    skillList.mockResolvedValue([])
    skillGet.mockResolvedValue(undefined)
    const failure = await ctx.yantaoKbController.capabilityRegister({ name: 'pack' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/不能用作能力名/)
  })

  it('lets a fully routed repository leave the 未注册 group and list its children as capabilities', async () => {
    await seedPlugin('diagram-design', ['diagram-design'])
    await ctx.yantaoKbController.capabilityRegister({ name: 'diagram-design' })
    const { capabilities, unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toHaveLength(0)
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]).toMatchObject({
      name: 'diagram-design',
      description: '插件内技能',
      source: 'kb',
      directory: join(home, '.dsh', 'skills', 'diagram-design', 'skills', 'diagram-design'),
      invocation: ['human'],
    })
  })

  it('runs a routed nested child the registry never discovered', async () => {
    await seedPlugin('diagram-design', ['diagram-design'])
    await ctx.yantaoKbController.capabilityRegister({ name: 'diagram-design' })
    const result = await ctx.yantaoKbController.capabilityRun({ name: 'diagram-design' })
    expect(result.name).toBe('diagram-design')
    expect(result.content).toContain('照做')
    expect(result.artifacts).toEqual([])
    expect(result.result).toBeUndefined()
    expect(runCapability).not.toHaveBeenCalled()
  })

  it('ignores a dropped directory without the plugin shape', async () => {
    const repository = join(home, '.dsh', 'skills', 'misc')
    await mkdir(join(repository, 'docs'), { recursive: true })
    await writeFile(join(repository, 'README.md'), '# 杂物\n', 'utf8')
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toHaveLength(0)
    const failure = await ctx.yantaoKbController.capabilityRegister({ name: 'misc' }).catch((error: unknown) => error)
    expect((failure as Error).message).toMatch(/找不到可注册的技能/)
  })
})
