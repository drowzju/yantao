import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SkillDefinition, SkillRegistry } from '@deepseek-ai/dsh-skill'
import { type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { CapabilityError, resolveEntry } from '../src/capability/run.ts'
import { execCapabilityScript } from '../src/capability/exec.ts'
import YantaoKbController from '../src/index.ts'

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

let home: string

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => state.home,
}))

let ctx: Context
let fiber: { dispose(): Promise<void> }
let skillDir: string

/** A registered tool definition by name, or undefined. */
function registeredTool(name: string): {
  name: string
  description: string
  execute: (args: unknown) => Promise<unknown>
} | undefined {
  return state.registerTool.mock.calls
    .map(call => call[0] as { name: string; description: string; execute: (args: unknown) => Promise<unknown> })
    .find(tool => tool.name === name)
}

/** A winning skill definition for the `probe` capability, as skill-filesystem would load it. */
function definition(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: 'probe',
    description: '探针能力',
    invocation: { modelInvocable: false, userInvocable: true },
    source: 'custom',
    provider: 'skill-filesystem',
    content: '# 探针',
    resourceBase: { kind: 'directory', path: skillDir },
    metadata: {},
    ...overrides,
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-exec-'))
  state.home = home
  skillDir = join(home, '.dsh', 'skills', 'probe')
  await mkdir(skillDir, { recursive: true })
  // A version far above the shipped master's keeps the builtin seeder from
  // overwriting this fake with a real capability mid-test.
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: probe\ndescription: 探针\nversion: 999\n---\n\n探针。\n', 'utf8')
  skillGet.mockReset().mockResolvedValue(definition())
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
  // The timeout test's orphaned grandchild may still hold the temp directory
  // as its cwd for a moment (Windows locks it); retry past its lifetime.
  await rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 })
})

/** Declare the probe capability's sidecar. */
async function declareSidecar(sidecar: Record<string, unknown>): Promise<void> {
  await writeFile(join(skillDir, 'yantao.json'), JSON.stringify(sidecar), 'utf8')
}

/** A probe script that reports its cwd, envelope environment, and stdin. */
const PROBE_JS = `
let raw = ''
process.stdin.on('data', chunk => { raw += chunk })
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    cwd: process.cwd(),
    kbRoot: process.env.KB_ROOT,
    capabilityName: process.env.CAPABILITY_NAME,
    channel: process.env.CAPABILITY_CHANNEL,
    envelope: JSON.parse(raw),
  }))
})
`

interface ExecResult {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
}

describe('kb_exec_capability_script (ADR-0043 决定 2)', () => {
  it('is registered with a Chinese description citing ADR-0043 and the pinned cwd', () => {
    const tool = registeredTool('kb_exec_capability_script')
    expect(tool?.description).toContain('ADR-0043')
    expect(tool?.description).toContain('cwd 锁定')
    expect(tool?.description).toContain('KB_ROOT')
  })

  it('runs a command inside an agent-open capability, delivering the envelope by env and stdin', async () => {
    await declareSidecar({ invocation: ['human', 'agent'] })
    await writeFile(join(skillDir, 'probe.js'), PROBE_JS, 'utf8')
    const result = await registeredTool('kb_exec_capability_script')
      ?.execute({ name: 'probe', command: 'node probe.js', input: '你好' }) as ExecResult
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const probe = JSON.parse(result.stdout) as {
      cwd: string
      kbRoot: string
      capabilityName: string
      channel: string
      envelope: { name: string; kbRoot: string; input: string; channel: string }
    }
    // Windows drive-letter case may differ between tmpdir() and a child's
    // cwd report; the path itself is what matters.
    expect(probe.cwd.toLowerCase()).toBe(resolve(skillDir).toLowerCase())
    expect(probe.kbRoot.toLowerCase()).toBe(resolve(home).toLowerCase())
    expect(probe.capabilityName).toBe('probe')
    expect(probe.channel).toBe('agent')
    expect(probe.envelope.name).toBe('probe')
    expect(probe.envelope.kbRoot.toLowerCase()).toBe(resolve(home).toLowerCase())
    expect(probe.envelope.input).toBe('你好')
    expect(probe.envelope.channel).toBe('agent')
  })

  it('reports a non-zero exit as not-ok with the exit code', async () => {
    await declareSidecar({ invocation: ['human', 'agent'] })
    await writeFile(join(skillDir, 'fail.js'), 'process.stderr.write("差一点")\nprocess.exit(3)\n', 'utf8')
    const result = await registeredTool('kb_exec_capability_script')
      ?.execute({ name: 'probe', command: 'node fail.js' }) as ExecResult
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('差一点')
  })

  it('caps an outsized stream and marks the truncation', async () => {
    await declareSidecar({ invocation: ['human', 'agent'] })
    await writeFile(join(skillDir, 'big.js'), 'process.stdout.write("x".repeat(256 * 1024))\n', 'utf8')
    const result = await registeredTool('kb_exec_capability_script')
      ?.execute({ name: 'probe', command: 'node big.js' }) as ExecResult
    expect(result.ok).toBe(true)
    expect(result.stdout.length).toBeLessThan(70 * 1024)
    expect(result.stdout).toContain('已截断')
  })

  it('kills an over-long command and answers not-ok', async () => {
    await declareSidecar({ invocation: ['human', 'agent'] })
    await writeFile(join(skillDir, 'hang.js'), 'setTimeout(() => {}, 3_000)\n', 'utf8')
    const result = await registeredTool('kb_exec_capability_script')
      ?.execute({ name: 'probe', command: 'node hang.js', timeoutMs: 300 }) as ExecResult
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toContain('已终止')
  })

  it('refuses a capability the sidecar did not open to the agent', async () => {
    await declareSidecar({ invocation: ['human'] })
    const failure = await registeredTool('kb_exec_capability_script')
      ?.execute({ name: 'probe', command: 'node probe.js' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'not-invocable' },
    })
  })

  it('refuses an unknown capability name', async () => {
    skillGet.mockResolvedValue(undefined)
    const failure = await registeredTool('kb_exec_capability_script')
      ?.execute({ name: 'nope', command: 'node probe.js' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'not-found' },
    })
  })

  it('resolves a centrally routed capability open to the agent to its routed directory', async () => {
    const directory = join(home, '.dsh', 'skills', 'nested', 'routed-probe')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-probe\ndescription: 路由\n---\n\n路由。\n', 'utf8')
    await writeFile(join(directory, 'probe.js'), PROBE_JS, 'utf8')
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({
      version: 1,
      capabilities: { 'routed-probe': { path: 'nested/routed-probe', invocation: ['human', 'agent'] } },
    }), 'utf8')
    skillGet.mockResolvedValue(undefined)
    const result = await registeredTool('kb_exec_capability_script')
      ?.execute({ name: 'routed-probe', command: 'node probe.js' }) as ExecResult
    expect(result.ok).toBe(true)
    const probe = JSON.parse(result.stdout) as { cwd: string }
    expect(probe.cwd.toLowerCase()).toBe(resolve(directory).toLowerCase())
  })

  it('refuses a routed capability the route closed to the agent', async () => {
    const directory = join(home, '.dsh', 'skills', 'routed-probe')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: routed-probe\ndescription: 路由\n---\n\n路由。\n', 'utf8')
    await writeFile(join(home, '.dsh', 'skills', 'yantao.json'), JSON.stringify({
      version: 1,
      capabilities: { 'routed-probe': { path: 'routed-probe', invocation: ['human'] } },
    }), 'utf8')
    skillGet.mockResolvedValue(undefined)
    const failure = await registeredTool('kb_exec_capability_script')
      ?.execute({ name: 'routed-probe', command: 'node probe.js' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/capability',
      details: { kind: 'not-invocable' },
    })
  })
})

describe('the bridge’s directory confinement', () => {
  it('refuses a directory outside .dsh/skills before anything spawns', async () => {
    const outside = join(home, 'elsewhere')
    await mkdir(outside, { recursive: true })
    const failure = await execCapabilityScript({
      name: 'probe',
      skillsRoot: join(home, '.dsh', 'skills'),
      directory: outside,
      command: 'node probe.js',
      kbRoot: home,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CapabilityError)
    expect((failure as CapabilityError).kind).toBe('bad-manifest')
  })
})

describe('resolveEntry and the adapter plane (ADR-0043 决定 2)', () => {
  /** A definition whose sidecar declares `entry`. */
  async function entryDefinition(entry: string): Promise<SkillDefinition> {
    await declareSidecar({ entry, runtime: 'python', invocation: ['human', 'agent'] })
    return definition()
  }

  it('resolves an entry inside the skill directory, as before', async () => {
    await mkdir(join(skillDir, 'scripts'), { recursive: true })
    await writeFile(join(skillDir, 'scripts', 'entry.py'), 'print(1)', 'utf8')
    const resolved = resolveEntry(await entryDefinition('scripts/entry.py'), join(home, '.dsh'))
    expect(resolved.entryPath).toBe(join(skillDir, 'scripts', 'entry.py'))
    expect(resolved.directory).toBe(skillDir)
  })

  it('resolves an entry on the adapter plane, relative to the .dsh root', async () => {
    const adapter = join(home, '.dsh', 'yantao', 'capability-adapters', 'probe')
    await mkdir(adapter, { recursive: true })
    await writeFile(join(adapter, 'entry.py'), 'print(1)', 'utf8')
    const resolved = resolveEntry(
      await entryDefinition('yantao/capability-adapters/probe/entry.py'),
      join(home, '.dsh'),
    )
    expect(resolved.entryPath).toBe(join(adapter, 'entry.py'))
  })

  it('reports a missing adapter-plane entry as a missing entry script', () => {
    return entryDefinition('yantao/capability-adapters/nope/entry.py').then((def) => {
      expect(() => resolveEntry(def, join(home, '.dsh'))).toThrow(/入口脚本不存在/)
    })
  })

  it('refuses an entry escaping both the skill directory and .dsh/', async () => {
    const def = await entryDefinition('../../../outside.py')
    expect(() => resolveEntry(def, join(home, '.dsh'))).toThrow(/越出了能力目录与 \.dsh\/ 目录/)
  })

  it('refuses an out-of-directory entry when no .dsh root is given', async () => {
    const def = await entryDefinition('yantao/capability-adapters/probe/entry.py')
    expect(() => resolveEntry(def)).toThrow(/入口脚本不存在/)
  })
})
