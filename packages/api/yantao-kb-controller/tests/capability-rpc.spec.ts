import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillDefinition, SkillRegistry } from '@deepseek-ai/dsh-skill'
import { type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'
import { readRoutes, updateRoute } from '../src/capability/routing.ts'

// All mocks are read by `vi.mock` factories, which run before any top-level
// `let` is initialized — hence the hoisted holder.
const { state } = vi.hoisted(() => ({
  state: {
    home: '', kbConfigured: true, skillGet: vi.fn(), skillList: vi.fn(),
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

let ctx: Context
let fiber: { dispose(): Promise<void> }
let skillDir: string

/** The central routing file's parsed content, as registration leaves it. */
async function central(): Promise<{ version: number; capabilities: Record<string, unknown> }> {
  return JSON.parse(await readFile(join(home, '.dsh', 'skills', 'yantao.json'), 'utf8')) as {
    version: number
    capabilities: Record<string, unknown>
  }
}

/** Write the central routing file by hand, as registration would leave it. */
async function writeCentral(capabilities: Record<string, unknown>): Promise<void> {
  await mkdir(join(home, '.dsh', 'skills'), { recursive: true })
  await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({ version: 1, capabilities }), 'utf8')
}

/** Write the capability account file (ADR-0053 决定 3) by hand. */
async function writeRecords(records: Record<string, unknown>): Promise<void> {
  await mkdir(join(home, '.dsh', 'yantao'), { recursive: true })
  await writeFile(join(home, '.dsh', 'yantao', 'state.json'), JSON.stringify({ capabilities: records }), 'utf8')
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-capability-'))
  state.home = home
  skillDir = join(home, '.dsh', 'skills', 'mail')
  await mkdir(skillDir, { recursive: true })
  // A version far above the shipped master's (declared in the frontmatter's
  // metadata.yantao.version — the only version basis, ADR-0052 决定 6) keeps
  // the builtin seeder from overwriting this fake with the real mail
  // capability mid-test.
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: mail\ndescription: 读 Outlook 邮件\nmetadata:\n  yantao:\n    version: 999\n---\n\n测试。\n',
    'utf8',
  )
  skillGet.mockReset()
  // `settleSkills` probes the registry until the names it is waiting for show
  // up; answering from the seeded directory makes that immediate.
  skillList.mockReset().mockImplementation(async () => {
    try {
      return (await readdir(join(home, '.dsh', 'skills'), { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        // capabilityList reads `invocation`/`description`/`source` off each
        // summary, so the stand-in carries what the real registry answers.
        .map(entry => ({
          name: entry.name,
          description: `${entry.name} 的技能`,
          source: 'custom',
          invocation: { modelInvocable: true, userInvocable: true },
        }))
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
  // The adoption/registration RPCs resolve through the skill registry; a
  // three-method stand-in is the whole surface this controller reads.
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

/** A skill definition for the `mail` capability, as skill-filesystem would load it. */
function definition(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: 'mail',
    description: '读 Outlook 邮件',
    invocation: { modelInvocable: false, userInvocable: true },
    source: 'custom',
    provider: 'skill-filesystem',
    content: '',
    resourceBase: { kind: 'directory', path: skillDir },
    metadata: {},
    ...overrides,
  }
}

/** The registered `kb_run_capability` tool definition, or undefined. */
function registeredTool(): { name: string; execute: (args: unknown) => Promise<unknown> } | undefined {
  return state.registerTool.mock.calls
    .map(call => call[0] as { name: string; execute: (args: unknown) => Promise<unknown> })
    .find(tool => tool.name === 'kb_run_capability')
}

describe('yantaoKb.capabilityRouteUpdate (ADR-0053 决定 2)', () => {
  it('refuses to run before a KB root has been chosen', async () => {
    state.kbConfigured = false
    const failure = await ctx.yantaoKbController.capabilityRouteUpdate({ name: 'mail', invocation: ['human'] }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })

  it('refuses a name the central routing file does not claim', async () => {
    await writeCentral({})
    const failure = await ctx.yantaoKbController.capabilityRouteUpdate({ name: 'nope', invocation: ['agent'] }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/没有能力「nope」的条目/)
  })

  it('updates the invocation and leaves the entry’s appliesTo untouched', async () => {
    await writeCentral({ mail: { path: 'mail', invocation: ['human'], appliesTo: { external: ['mailbox'] } } })
    await ctx.yantaoKbController.capabilityRouteUpdate({ name: 'mail', invocation: ['human', 'agent'] })
    expect((await central()).capabilities.mail).toEqual({
      path: 'mail', invocation: ['human', 'agent'], appliesTo: { external: ['mailbox'] },
    })
  })

  it('updates the appliesTo and leaves the invocation untouched', async () => {
    await writeCentral({ mail: { path: 'mail', invocation: ['human', 'agent'] } })
    await ctx.yantaoKbController.capabilityRouteUpdate({ name: 'mail', appliesTo: { selection: true } })
    expect((await central()).capabilities.mail).toEqual({
      path: 'mail', invocation: ['human', 'agent'], appliesTo: { selection: true },
    })
  })

  it('surfaces a broken central routing file as bad-manifest', async () => {
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), '{ not json', 'utf8')
    const failure = await ctx.yantaoKbController.capabilityRouteUpdate({ name: 'mail', invocation: ['agent'] }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'bad-manifest' },
    })
  })
})

describe('yantaoKb.capabilityUnregister (ADR-0053 决定 2)', () => {
  it('refuses to run before a KB root has been chosen', async () => {
    state.kbConfigured = false
    const failure = await ctx.yantaoKbController.capabilityUnregister({ name: 'mail' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })

  it('deletes only the named entry; the skill directory is untouched', async () => {
    await writeCentral({
      mail: { path: 'mail', invocation: ['human', 'agent'] },
      other: { path: 'other', invocation: ['human'] },
    })
    const result = await ctx.yantaoKbController.capabilityUnregister({ name: 'mail' })
    expect(result.path).toBe('.dsh/skills/yantao.json')
    expect((await central()).capabilities).toEqual({ other: { path: 'other', invocation: ['human'] } })
    // The human's files are never destroyed by an ops gesture.
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toContain('测试')
  })

  it('answers success for a name that was never registered', async () => {
    await writeCentral({})
    const result = await ctx.yantaoKbController.capabilityUnregister({ name: 'nope' })
    expect(result.path).toBe('.dsh/skills/yantao.json')
  })
})

describe('yantaoKb.capabilityList (ADR-0052 决定 1)', () => {
  it('merges the persisted record: when it last ran, how often, when it last failed, and the state it left', async () => {
    await writeCentral({ mail: { path: 'mail', invocation: ['human', 'agent'] } })
    await writeRecords({
      mail: {
        lastRunAt: '2026-09-12T00:00:00.000Z',
        runCount: 7,
        lastFailAt: '2026-09-11T00:00:00.000Z',
        state: { lastReadAt: '2026-09-12T00:00:00.000Z' },
      },
    })
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]).toMatchObject({
      name: 'mail',
      description: '读 Outlook 邮件',
      source: 'kb',
      directory: skillDir,
      invocation: ['human', 'agent'],
      lastRunAt: '2026-09-12T00:00:00.000Z',
      runCount: 7,
      lastFailAt: '2026-09-11T00:00:00.000Z',
      state: { lastReadAt: '2026-09-12T00:00:00.000Z' },
    })
  })

  it('seeds the shipped capabilities into the KB before listing', async () => {
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    // The seeding itself is covered by capability-builtin.spec; here it is
    // enough that a fresh KB answers with the shipped capability.
    expect(capabilities.map(capability => capability.name)).toEqual(expect.arrayContaining(['mail']))
  })

  it('lists a routed capability with its description from the routed SKILL.md', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n正文\n', 'utf8')
    await writeCentral({
      mail: { path: 'mail', invocation: ['human'] },
      'routed-skill': { path: 'routed-skill', invocation: ['human', 'agent'] },
    })
    const { capabilities, unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered).toEqual([])
    expect(capabilities.map(capability => capability.name)).toEqual(['mail', 'routed-skill'])
    expect(capabilities[1]).toMatchObject({
      name: 'routed-skill',
      description: '路由技能',
      source: 'kb',
      directory,
      invocation: ['human', 'agent'],
    })
  })

  it('skips a stale route whose target lost its SKILL.md', async () => {
    await writeCentral({
      mail: { path: 'mail', invocation: ['human'] },
      ghost: { path: 'ghost', invocation: ['human'] },
    })
    const { capabilities } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities.map(capability => capability.name)).toEqual(['mail'])
  })

  it('answers the listing without routes when the central routing file is broken', async () => {
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), '{ not json', 'utf8')
    // The in-KB fake must be discoverable for the 未注册 row to surface.
    skillGet.mockResolvedValue(definition())
    const { capabilities, unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(capabilities).toEqual([])
    // The in-KB skill is still surfaced — as an unregistered row now.
    expect(unregistered.map(skill => skill.name)).toContain('mail')
  })

  it('does not offer a name for registration or adoption when a route already claims it', async () => {
    // In KB, no declaration: normally a greyed 未注册 row — but the route wins.
    const directory = join(home, '.dsh', 'skills', 'notes-helper')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: notes-helper\ndescription: KB 内技能\n---\n\n照做。\n', 'utf8')
    await writeCentral({
      'notes-helper': { path: 'notes-helper', invocation: ['human'] },
      outside: { path: 'outside', invocation: ['human'] },
      mail: { path: 'mail', invocation: ['human'] },
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
    expect(capabilities.map(capability => capability.name)).toEqual(['notes-helper', 'mail'])
  })
})

describe('yantaoKb.capabilityCreate (ADR-0052 决定 1)', () => {
  it('scaffolds a clean SKILL.md and one human route entry, nothing else', async () => {
    const result = await ctx.yantaoKbController.capabilityCreate({ name: 'daily-note' })
    expect(result.path).toBe('.dsh/skills/daily-note')
    const directory = join(home, '.dsh', 'skills', 'daily-note')
    const skillMd = await readFile(join(directory, 'SKILL.md'), 'utf8')
    expect(skillMd).toContain('name: daily-note')
    expect(skillMd).not.toMatch(/yantao:/)
    expect(skillMd).toContain('kb_exec_capability_script')
    // The declaration is the central route; no sidecar, no scripts.
    expect((await central()).capabilities['daily-note']).toEqual({
      path: 'daily-note', invocation: ['human'],
    })
    expect((await readdir(directory)).sort()).toEqual(['SKILL.md'])
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

describe('central routing file validation (ADR-0052 决定 1)', () => {
  it('accepts a valid entry and lowercases declared resource suffixes', async () => {
    await writeCentral({
      reader: { path: 'reader', invocation: ['human', 'agent'], appliesTo: { resource: ['.EPUB'], selection: true } },
    })
    const routes = await readRoutes(join(home, '.dsh', 'skills'))
    expect(routes.reader).toEqual({
      path: 'reader', invocation: ['human', 'agent'], appliesTo: { resource: ['.epub'], selection: true },
    })
  })

  it('refuses an unknown entry key', async () => {
    await writeCentral({ odd: { path: 'odd', entry: 'scripts/entry.py' } })
    await expect(readRoutes(join(home, '.dsh', 'skills'))).rejects.toMatchObject({
      kind: 'bad-manifest',
      message: expect.stringMatching(/只支持 path\/invocation\/appliesTo/),
    })
  })

  it('refuses a malformed invocation', async () => {
    for (const invocation of [['model'], 'agent', []]) {
      await writeCentral({ odd: { path: 'odd', invocation } })
      await expect(readRoutes(join(home, '.dsh', 'skills'))).rejects.toMatchObject({
        kind: 'bad-manifest',
        message: expect.stringMatching(/invocation/),
      })
    }
  })

  it('refuses a bare suffix and a non-boolean selection', async () => {
    await writeCentral({ odd: { path: 'odd', appliesTo: { resource: ['epub'] } } })
    await expect(readRoutes(join(home, '.dsh', 'skills'))).rejects.toMatchObject({
      kind: 'bad-manifest',
      message: expect.stringMatching(/带点的扩展名/),
    })
    await writeCentral({ odd: { path: 'odd', appliesTo: { selection: 'yes' } } })
    await expect(readRoutes(join(home, '.dsh', 'skills'))).rejects.toMatchObject({
      kind: 'bad-manifest',
      message: expect.stringMatching(/appliesTo\.selection 必须是布尔值/),
    })
  })

  it('accepts resource: true as every-resource and refuses a non-boolean non-list', async () => {
    await writeCentral({ odd: { path: 'odd', appliesTo: { resource: true } } })
    const routes = await readRoutes(join(home, '.dsh', 'skills'))
    expect(routes.odd?.appliesTo).toEqual({ resource: true })
    await writeCentral({ odd: { path: 'odd', appliesTo: { resource: 'all' } } })
    await expect(readRoutes(join(home, '.dsh', 'skills'))).rejects.toMatchObject({
      kind: 'bad-manifest',
      message: expect.stringMatching(/appliesTo\.resource/),
    })
  })

  it('updateRoute re-validates the entry it rewrites', async () => {
    await writeCentral({ odd: { path: 'odd', entry: 42 } })
    await expect(updateRoute(join(home, '.dsh', 'skills'), 'odd', { invocation: ['agent'] }))
      .rejects.toMatchObject({ kind: 'bad-manifest' })
  })
})

describe('capabilityList 未注册 group (ADR-0025, ADR-0052 决定 1)', () => {
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

  it('lists out-of-KB directory bundles name-sorted', async () => {
    const z = outside({ name: 'zeta-tool' })
    const a = outside({ name: 'alpha-tool' })
    const zDir = join(home, 'user-skills', 'zeta-tool')
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

  it('skips skills under the owner home skill roots — deliberate installs, not adoption finds', async () => {
    // The suite mocks homedir() to read `state.home` at call time; pointing it
    // somewhere other than the KB root lets fixtures sit under a fake
    // `~/.dsh/skills` / `~/.agents/skills` without touching the real home.
    const ownerHome = join(home, 'owner-home')
    state.home = ownerHome
    const dshRoot = join(ownerHome, '.dsh', 'skills')
    const agentsRoot = join(ownerHome, '.agents', 'skills')
    const impeccable = outside({
      name: 'impeccable',
      resourceBase: { kind: 'directory', path: join(dshRoot, 'impeccable') },
      path: join(dshRoot, 'impeccable', 'SKILL.md'),
    })
    const agentsFixture = outside({
      name: 'agents-fixture',
      resourceBase: { kind: 'directory', path: join(agentsRoot, 'agents-fixture') },
      path: join(agentsRoot, 'agents-fixture', 'SKILL.md'),
    })
    // A flat single-file skill's resourceBase is the shared root itself —
    // the equality branch of the filter is what catches it.
    const flat = outside({
      name: 'flat-home',
      resourceBase: { kind: 'directory', path: dshRoot },
      path: join(dshRoot, 'flat-home.md'),
    })
    const control = outside({ name: 'adopt-me' })
    skillList.mockResolvedValue([
      // The list summary carries resourceBase — the path filter reads it off
      // the summary, not the definition.
      { name: 'impeccable', description: 'i', source: 'user-dsh', resourceBase: { kind: 'directory', path: join(dshRoot, 'impeccable') }, invocation: { modelInvocable: true, userInvocable: true } },
      { name: 'agents-fixture', description: 'a', source: 'user-agents', resourceBase: { kind: 'directory', path: join(agentsRoot, 'agents-fixture') }, invocation: { modelInvocable: true, userInvocable: true } },
      { name: 'flat-home', description: 'f', source: 'user-dsh', resourceBase: { kind: 'directory', path: dshRoot }, invocation: { modelInvocable: true, userInvocable: true } },
      { name: 'adopt-me', description: 'c', source: 'user', resourceBase: { kind: 'directory', path: join(home, 'user-skills', 'adopt-me') }, invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockImplementation(async (name: string) =>
      name === 'impeccable' ? impeccable : name === 'agents-fixture' ? agentsFixture : name === 'flat-home' ? flat : control)
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered.map(skill => skill.name)).toEqual(['adopt-me'])
    state.home = home
  })

  it('surfaces an in-KB skill without a route as a greyed inKb row', async () => {
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
    // The seeder's mail route rides along; what matters is that the in-KB
    // skill stayed out of the capability roll and into the greyed group.
    expect(capabilities.map(capability => capability.name)).not.toContain('notes-helper')
    expect(unregistered).toHaveLength(1)
    expect(unregistered[0]).toMatchObject({ name: 'notes-helper', inKb: true, flat: false, directory })
    expect(unregistered[0]?.reason).toMatch(/尚未注册/)
  })

  it('treats a leftover sidecar as inert furniture — the row reason is still 尚未注册', async () => {
    const directory = join(home, '.dsh', 'skills', 'with-sidecar')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: with-sidecar\ndescription: 有遗留声明\n---\n\n照做。\n', 'utf8')
    await writeFile(join(directory, 'yantao.json'), '{ "entry": 42 }', 'utf8')
    skillList.mockResolvedValue([
      { name: 'with-sidecar', description: '有遗留声明', source: 'custom', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue({
      name: 'with-sidecar', description: '有遗留声明',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: directory },
      path: join(directory, 'SKILL.md'), metadata: {},
    } satisfies SkillDefinition)
    const { unregistered } = await ctx.yantaoKbController.capabilityList()
    expect(unregistered[0]).toMatchObject({ name: 'with-sidecar', inKb: true })
    expect(unregistered[0]?.reason).toMatch(/尚未注册/)
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

describe('yantaoKb.capabilityAdopt (ADR-0025, ADR-0052 决定 1)', () => {
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
    expect(await central()).toEqual({
      version: 1,
      capabilities: { 'notes-helper': { path: 'notes-helper', invocation: ['human'] } },
    })
    // Copy, never move: the source stays for the other dsh usages.
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toContain('照做')
  })

  it('lets a sidecar the source carried come along inert — nothing reads it any more', async () => {
    const source = await seedOutside('scripted')
    await writeFile(join(source, 'yantao.json'), JSON.stringify({ entry: 'scripts/run.py', invocation: ['human', 'agent'] }), 'utf8')
    await ctx.yantaoKbController.capabilityAdopt({ name: 'scripted' })
    const target = join(home, '.dsh', 'skills', 'scripted')
    // The copy keeps the file byte-identical (pure copy), but nothing reads
    // it: the route entry is the declaration.
    expect(await readFile(join(target, 'yantao.json'), 'utf8')).toContain('agent')
    expect((await central()).capabilities.scripted).toEqual({ path: 'scripted', invocation: ['human'] })
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
    skillGet.mockResolvedValue(definition())
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

describe('yantaoKb.capabilityRegister (ADR-0025, ADR-0052 决定 1)', () => {
  /** Seed one in-KB directory-bundle skill, on disk and in the registry stand-in. */
  async function seedInside(name: string): Promise<string> {
    const directory = join(home, '.dsh', 'skills', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: KB 内技能\n---\n\n照做。\n`, 'utf8')
    skillList.mockResolvedValue([
      { name, description: 'KB 内技能', source: 'custom', invocation: { modelInvocable: true, userInvocable: true } },
    ])
    skillGet.mockResolvedValue({
      name,
      description: 'KB 内技能',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom',
      provider: 'skill-filesystem',
      content: '照做。',
      resourceBase: { kind: 'directory', path: directory },
      path: join(directory, 'SKILL.md'),
      metadata: {},
    } satisfies SkillDefinition)
    return directory
  }

  it('writes a route entry and copies nothing — the skill directory stays byte-identical', async () => {
    const directory = await seedInside('notes-helper')
    const before = await readFile(join(directory, 'SKILL.md'), 'utf8')
    const result = await ctx.yantaoKbController.capabilityRegister({ name: 'notes-helper' })
    expect(result.path).toBe('.dsh/skills/yantao.json')
    expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toBe(before)
    expect((await central()).capabilities['notes-helper']).toEqual({
      path: 'notes-helper', invocation: ['human'],
    })
  })

  it('carries the reach the caller asked for', async () => {
    await seedInside('loud')
    await ctx.yantaoKbController.capabilityRegister({
      name: 'loud', agentInvoke: true, resourceMenu: true, selectionMenu: true,
    })
    expect((await central()).capabilities.loud).toEqual({
      path: 'loud',
      invocation: ['human', 'agent'],
      appliesTo: { resource: true, selection: true },
    })
  })

  it('refuses an already-registered name — the reach toggles are its update path', async () => {
    await seedInside('twice')
    await ctx.yantaoKbController.capabilityRegister({ name: 'twice' })
    const again = await ctx.yantaoKbController.capabilityRegister({ name: 'twice' }).catch((error: unknown) => error)
    expect(remoteErrorOf(again)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((again as Error).message).toMatch(/已是能力/)
  })

  it('refuses a skill outside the KB and a flat one', async () => {
    skillGet.mockResolvedValue({
      name: 'outside', description: '外面', invocation: { modelInvocable: true, userInvocable: true },
      source: 'user', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: join(home, 'user-skills', 'outside') },
      path: join(home, 'user-skills', 'outside', 'SKILL.md'), metadata: {},
    })
    const outsideFailure = await ctx.yantaoKbController.capabilityRegister({ name: 'outside' }).catch((error: unknown) => error)
    expect((outsideFailure as Error).message).toMatch(/找不到可注册的技能/)
    skillGet.mockResolvedValue({
      name: 'quick', description: '扁平', invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: join(home, '.dsh', 'skills') },
      path: join(home, '.dsh', 'skills', 'quick.md'), metadata: {},
    })
    const flatFailure = await ctx.yantaoKbController.capabilityRegister({ name: 'quick' }).catch((error: unknown) => error)
    expect((flatFailure as Error).message).toMatch(/找不到可注册的技能/)
  })

  it('refuses a skill its frontmatter marked user-invocable: false', async () => {
    await seedInside('quiet')
    skillGet.mockResolvedValue({
      name: 'quiet', description: '安静', invocation: { modelInvocable: true, userInvocable: false },
      source: 'custom', provider: 'skill-filesystem', content: '',
      resourceBase: { kind: 'directory', path: join(home, '.dsh', 'skills', 'quiet') },
      path: join(home, '.dsh', 'skills', 'quiet', 'SKILL.md'), metadata: {},
    })
    const failure = await ctx.yantaoKbController.capabilityRegister({ name: 'quiet' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/user-invocable/)
  })

  it('refuses to run before a KB root has been chosen', async () => {
    state.kbConfigured = false
    const failure = await ctx.yantaoKbController.capabilityRegister({ name: 'notes-helper' }).catch((error: unknown) => error)
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

  it('refuses a child name that cannot be a capability name', async () => {
    const repository = join(home, '.dsh', 'skills', 'pack')
    const directory = join(repository, 'skills', '坏 名字')
    await mkdir(directory, { recursive: true })
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
    // The seeder's mail route rides along after the repository's children.
    expect(capabilities.map(capability => capability.name)).toEqual(['diagram-design', 'mail'])
    expect(capabilities[0]).toMatchObject({
      name: 'diagram-design',
      description: '插件内技能',
      source: 'kb',
      directory: join(home, '.dsh', 'skills', 'diagram-design', 'skills', 'diagram-design'),
      invocation: ['human'],
    })
  })

  it('answers a routed nested child the registry never discovered, when the route opens it to the agent', async () => {
    await seedPlugin('diagram-design', ['diagram-design'])
    await ctx.yantaoKbController.capabilityRegister({ name: 'diagram-design', agentInvoke: true })
    const result = await registeredTool()?.execute({ name: 'diagram-design' }) as { name: string; content?: string }
    expect(result.name).toBe('diagram-design')
    expect(result.content).toContain('照做')
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

describe('the instruction run carries the scope memory (ADR-0032 批次②)', () => {
  /** Seed the mail scope's memory file as the human channel would have written it. */
  async function seedMemory(name: string, lines: string[]): Promise<void> {
    const dir = join(home, '.dsh', 'yantao', 'memory', 'capabilities')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${name}.md`), `# 记忆 · ${name}\n\n${lines.join('\n')}\n`, 'utf8')
  }

  it('attaches the remembered rules to an instruction run', async () => {
    await writeCentral({ mail: { path: 'mail', invocation: ['human', 'agent'] } })
    await seedMemory('mail', ['- 2026-09-23 同类邮件直接提示删除'])
    const result = await registeredTool()?.execute({ name: 'mail' }) as { content: string; memory?: string }
    expect(result.content).toContain('测试')
    expect(result.memory).toContain('同类邮件直接提示删除')
    expect(result.memory).toContain('mail')
  })

  it('answers a routed capability with its scope memory too', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-skill')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-skill\ndescription: 路由技能\n---\n\n# 路由正文\n', 'utf8')
    await writeCentral({ 'routed-skill': { path: 'routed-skill', invocation: ['human', 'agent'] } })
    await seedMemory('routed-skill', ['- 2026-09-23 路由技能也守规矩'])
    const result = await registeredTool()?.execute({ name: 'routed-skill' }) as { content: string; memory?: string }
    expect(result.content).toContain('路由正文')
    expect(result.memory).toContain('路由技能也守规矩')
  })

  it('leaves memory absent when the scope has no remembered rules', async () => {
    await writeCentral({ mail: { path: 'mail', invocation: ['human', 'agent'] } })
    const result = await registeredTool()?.execute({ name: 'mail' }) as { content: string; memory?: string }
    expect(result.content).toContain('测试')
    expect(result.memory).toBeUndefined()
  })
})
