import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillDefinition, SkillRegistry } from '@deepseek-ai/dsh-skill'
import {
  readCapabilityState, writeKbRootOverride, type YantaoKbService,
} from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

// All mocks are read by `vi.mock` factories, which run before any top-level
// `let` is initialized — hence the hoisted holder.
const { state } = vi.hoisted(() => ({
  state: { home: '', runCapability: vi.fn(), skillGet: vi.fn(), skillList: vi.fn(), registerProvider: vi.fn() },
}))
const runCapability = state.runCapability
const skillGet = state.skillGet
const skillList = state.skillList

// The capability state lives in dsh's home, which is the developer's real
// `~`; point `homedir()` at a throwaway directory so the suite never touches it.
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
  skillDir = join(home, 'skills', 'mail')
  await mkdir(join(skillDir, 'scripts'), { recursive: true })
  await writeFile(join(skillDir, 'scripts', 'entry.py'), 'print(1)', 'utf8')
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
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return home
    },
    get configured(): boolean {
      return false
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
  fiber = await ctx.plugin(YantaoKbController)
  // Capability state is persisted next to the KB root, so a run needs one to
  // have been chosen.
  await writeKbRootOverride(join(home, '知识库'))
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

describe('yantaoKb.capabilityRun', () => {
  it('refuses to run before a KB root has been chosen', async () => {
    await rm(join(home, '.dsh'), { recursive: true, force: true })
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
    expect(readCapabilityState('mail')).toEqual({ lastReadAt: '2026-09-12T00:00:00.000Z' })
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
})

describe('yantaoKb.capabilityList', () => {
  it('lists skills that declare a yantao manifest and skips plain skills', async () => {
    skillList.mockResolvedValue([
      { name: 'mail', description: '读 Outlook 邮件', source: 'project', resourceBase: { kind: 'directory', path: skillDir } },
      { name: 'plain', description: '普通技能', source: 'project' },
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
    // enough that a fresh KB answers with the shipped pair.
    expect(capabilities.map(capability => capability.name)).toEqual(expect.arrayContaining(['mail', 'ebook']))
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

  it('refuses a sidecar without an entry', async () => {
    const { manifestOf } = await import('../src/capability/run.ts')
    await writeFile(join(skillDir, 'yantao.json'), JSON.stringify({ runtime: 'python' }), 'utf8')
    expect(() => manifestOf(definition({ metadata: {} }))).toThrow(/缺少 entry/)
  })
})
