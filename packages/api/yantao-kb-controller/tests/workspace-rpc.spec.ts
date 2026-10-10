import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { markInstruction, readWorkspaceRuns, type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let kbConfigured: boolean
let ctx: Context
let fiber: { dispose(): Promise<void> }

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-workspace-rpc-'))
  kbConfigured = true
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return kbRoot
    },
    get configured(): boolean {
      return kbConfigured
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  ctx.provide('skills', { get: async () => undefined } as never)
  ctx.provide('tools', { register: () => {} } as never)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

/** One valid instruction; overrides land on top. */
function instruction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'ins_a', name: '打招呼', enabled: true, steps: ['向目录里的代码打个招呼'], ...overrides }
}

/** One valid workspace bound to the temp KB root; overrides land on top. */
function workspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wsp_a',
    name: '试验场',
    directory: kbRoot,
    agent: 'codebuddy',
    instructions: [instruction()],
    ...overrides,
  }
}

/** A minimal ChildProcess stand-in: scriptable stdout/close, observable kill. */
class FakeChild extends EventEmitter implements Partial<ChildProcess> {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = {
    on: (): void => undefined,
    end: (chunk?: string): void => { this.promptReceived = chunk ?? null },
    write: (): boolean => true,
  }
  pid = 4242
  killed = false
  promptReceived: string | null = null

  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('close', null))
    return true
  }
}

interface RecordedSpawn {
  readonly command: string
  readonly args: readonly string[]
  readonly options: SpawnOptions | undefined
  readonly child: FakeChild
}

/**
 * A spawn fake that dispatches on the command: `codebuddy` children are
 * scripted per call (the callback), `taskkill` killers error immediately
 * so the kill path falls back to `child.kill()` — no real process is ever
 * touched, on any platform.
 */
function fakeSpawn(script: (call: RecordedSpawn) => void): {
  readonly calls: RecordedSpawn[]
  readonly impl: unknown
} {
  const calls: RecordedSpawn[] = []
  const impl = (command: string, args: readonly string[], options: SpawnOptions | undefined): FakeChild => {
    const child = new FakeChild()
    const call: RecordedSpawn = { command, args, options, child }
    calls.push(call)
    if (command === 'taskkill') {
      queueMicrotask(() => child.emit('error', new Error('fake taskkill')))
      return child
    }
    script(call)
    return child
  }
  return { calls, impl }
}

/** Emit one single-result JSON answer, then close cleanly. */
function succeedWith(child: FakeChild, result: string, sessionId?: string): void {
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', result, ...(sessionId !== undefined ? { session_id: sessionId } : {}) })))
    child.emit('close', 0)
  })
}

/** Emit an arbitrary stdout payload, then close cleanly. */
function answerWith(child: FakeChild, payload: string, exitCode = 0): void {
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(payload))
    child.emit('close', exitCode)
  })
}

/** Restore one env var to its prior value (undefined deletes it). */
function restore(previous: string | undefined, key: string): void {
  if (previous === undefined) Reflect.deleteProperty(process.env, key)
  else process.env[key] = previous
}

/** Poll until the predicate holds, failing with the label on timeout. */
async function until(description: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`等待超时：${description}`)
}

describe('yantaoKb.workspaceList / workspaceSave', () => {
  it('answers an empty list before anything is saved', async () => {
    const result = await ctx.yantaoKbController.workspaceList()
    expect(result.workspaces).toEqual([])
    expect(result.path).toBe('.dsh/yantao/workspaces.json')
  })

  it('refuses before a KB root is chosen', async () => {
    kbConfigured = false
    const failure = await ctx.yantaoKbController.workspaceList().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })

  it('validates the cron shape, quoting the instruction name', async () => {
    const failure = await ctx.yantaoKbController
      .workspaceSave({ workspaces: [workspace({ instructions: [instruction({ cron: '61 * * * *' })] })] })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toContain('打招呼')
  })

  it('preserves the tick stamps across an editor save (ADR-0045 的配方)', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    await markInstruction(kbRoot, 'wsp_a', 'ins_a', {
      lastFiredAt: '2026-10-03T09:00:00.000Z',
      lastMissedAt: '2026-10-02T09:00:00.000Z',
    })
    // An editor saves from a stale snapshot that carries no stamps.
    const result = await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace({ name: '试验场 v2' })] as never })
    expect(result.workspaces[0]).toMatchObject({
      name: '试验场 v2',
      instructions: [{ lastFiredAt: '2026-10-03T09:00:00.000Z', lastMissedAt: '2026-10-02T09:00:00.000Z' }],
    })
  })
})

describe('yantaoKb.workspaceRun', () => {
  it('refuses an unknown workspace', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    const failure = await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_ghost', instructionId: 'ins_a' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toContain('不存在')
  })

  it('refuses an unknown instruction', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    const failure = await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_ghost' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })

  it('runs one step: prompt on stdin, cwd pinned, result and session recorded', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    const fake = fakeSpawn(({ child }) => { succeedWith(child, '打好了', 'sessAAA') })
    ctx.yantaoKbController.workspaceRuntime.spawnImpl = fake.impl as never

    const { runId } = await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_a' })
    expect(runId).toMatch(/^run_/)
    await until('run settles success', async () => (await readWorkspaceRuns(kbRoot))[0]?.status === 'success')
    const [run] = await readWorkspaceRuns(kbRoot)
    expect(run).toMatchObject({ id: runId, trigger: 'manual', status: 'success', finalResult: '打好了' })
    expect(run?.steps[0]).toMatchObject({ exitCode: 0, sessionId: 'sessAAA', resultExcerpt: '打好了' })

    const call = fake.calls[0]
    expect(call?.command).toBe('codebuddy')
    expect(call?.args).toEqual(['-p', '-y', '--output-format', 'json'])
    expect(call?.options?.cwd).toBe(kbRoot)
    expect(call?.child.promptReceived).toBe('向目录里的代码打个招呼')
  })

  it('parses the event-array output shape (real `--output-format json` contract, 2026-10-10)', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    const fake = fakeSpawn(({ child }) => {
      answerWith(child, JSON.stringify([
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: '…' }] },
        { type: 'file-history-snapshot' },
        { type: 'reasoning' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '数组答' }] },
        { type: 'result', subtype: 'success', is_error: false, result: '数组答', session_id: 'sessARR' },
      ]))
    })
    ctx.yantaoKbController.workspaceRuntime.spawnImpl = fake.impl as never

    await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_a' })
    await until('array run settles success', async () => (await readWorkspaceRuns(kbRoot))[0]?.status === 'success')
    const [run] = await readWorkspaceRuns(kbRoot)
    expect(run?.finalResult).toBe('数组答')
    expect(run?.steps[0]).toMatchObject({ exitCode: 0, sessionId: 'sessARR', resultExcerpt: '数组答' })
  })

  it('strips session-scoped env vars from the spawned environment (SERVER__PORT wedge, 2026-10-10)', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    const previous = {
      serverPort: process.env.SERVER__PORT,
      sessionId: process.env.CODEBUDDY_SESSION_ID,
      marker: process.env.WORKSPACE_ENV_MARKER,
    }
    process.env.SERVER__PORT = '53031'
    process.env.CODEBUDDY_SESSION_ID = 'sess_parent'
    process.env.WORKSPACE_ENV_MARKER = 'keep-me'
    try {
      const fake = fakeSpawn(({ child }) => { succeedWith(child, '好了') })
      ctx.yantaoKbController.workspaceRuntime.spawnImpl = fake.impl as never

      await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_a' })
      await until('sanitized run settles success', async () => (await readWorkspaceRuns(kbRoot))[0]?.status === 'success')

      const env = fake.calls[0]?.options?.env as Record<string, string | undefined>
      expect(env.SERVER__PORT).toBeUndefined()
      expect(env.CODEBUDDY_SESSION_ID).toBeUndefined()
      expect(env.WORKSPACE_ENV_MARKER).toBe('keep-me')
    } finally {
      restore(previous.serverPort, 'SERVER__PORT')
      restore(previous.sessionId, 'CODEBUDDY_SESSION_ID')
      restore(previous.marker, 'WORKSPACE_ENV_MARKER')
    }
  })

  it('passes --model through and --resume chains step 2 onto step 1', async () => {
    await ctx.yantaoKbController.workspaceSave({
      workspaces: [workspace({ model: 'glm-5.1', instructions: [instruction({ steps: ['第一问', '第二问'] })] })] as never,
    })
    const fake = fakeSpawn(({ args, child }) => {
      const resume = args.includes('--resume')
      queueMicrotask(() => {
        succeedWith(child, resume ? '第二答' : '第一答', resume ? 'sessBBB' : 'sessAAA')
      })
    })
    ctx.yantaoKbController.workspaceRuntime.spawnImpl = fake.impl as never

    await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_a' })
    await until('chain settles success', async () => (await readWorkspaceRuns(kbRoot))[0]?.status === 'success')

    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[0]?.args).toEqual(['-p', '-y', '--output-format', 'json', '--model', 'glm-5.1'])
    expect(fake.calls[1]?.args).toEqual(['-p', '-y', '--output-format', 'json', '--model', 'glm-5.1', '--resume', 'sessAAA'])
    const [run] = await readWorkspaceRuns(kbRoot)
    expect(run?.finalResult).toBe('第二答')
    expect(run?.steps[0]).toMatchObject({ sessionId: 'sessAAA', resultExcerpt: '第一答' })
    expect(run?.steps[1]).toMatchObject({ sessionId: 'sessBBB', resultExcerpt: '第二答' })
  })

  it('breaks the chain on a non-zero exit and records the failing step', async () => {
    await ctx.yantaoKbController.workspaceSave({
      workspaces: [workspace({ instructions: [instruction({ steps: ['第一步', '第二步'] })] })] as never,
    })
    const fake = fakeSpawn(({ child }) => {
      // 监听器在 spawn 返回后才挂上：事件必须异步发出，否则会被丢掉
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('boom'))
        child.emit('close', 1)
      })
    })
    ctx.yantaoKbController.workspaceRuntime.spawnImpl = fake.impl as never

    await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_a' })
    await until('run settles failed', async () => (await readWorkspaceRuns(kbRoot))[0]?.status === 'failed')

    const [run] = await readWorkspaceRuns(kbRoot)
    expect(run?.status).toBe('failed')
    expect(run?.failedStep).toBe(0)
    expect(run?.steps[0]?.error).toContain('1')
    expect(fake.calls).toHaveLength(1) // 第二步不动（断链）
  })

  it('fails a step whose stdout is not the single-result JSON', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    const fake = fakeSpawn(({ child }) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('这不是 json'))
        child.emit('close', 0)
      })
    })
    ctx.yantaoKbController.workspaceRuntime.spawnImpl = fake.impl as never

    await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_a' })
    await until('run settles failed', async () => (await readWorkspaceRuns(kbRoot))[0]?.status === 'failed')
    const [run] = await readWorkspaceRuns(kbRoot)
    expect(run?.steps[0]?.error).toContain('JSON')
  })

  it('stops a running chain: kill observed, row marked stopped', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    const fake = fakeSpawn(() => undefined) // 挂着不退出
    ctx.yantaoKbController.workspaceRuntime.spawnImpl = fake.impl as never

    const { runId } = await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_a' })
    await until('child spawned', async () => fake.calls.length > 0)
    expect(await ctx.yantaoKbController.workspaceRunStop({ runId })).toMatchObject({})
    expect(fake.calls[0]?.child.killed).toBe(true)
    await until('row marked stopped', async () => (await readWorkspaceRuns(kbRoot))[0]?.status === 'stopped')
    const [run] = await readWorkspaceRuns(kbRoot)
    expect(run?.finishedAt).toBeDefined()
  })

  it('refuses to stop a run that is not live', async () => {
    const failure = await ctx.yantaoKbController.workspaceRunStop({ runId: 'run_ghost' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })
})

describe('yantaoKb.workspaceRunsList', () => {
  it('answers newest first', async () => {
    await ctx.yantaoKbController.workspaceSave({ workspaces: [workspace()] as never })
    const fake = fakeSpawn(({ child }) => { succeedWith(child, '好') })
    ctx.yantaoKbController.workspaceRuntime.spawnImpl = fake.impl as never
    await ctx.yantaoKbController.workspaceRun({ workspaceId: 'wsp_a', instructionId: 'ins_a' })
    await until('run settles', async () => (await readWorkspaceRuns(kbRoot))[0]?.status === 'success')

    const result = await ctx.yantaoKbController.workspaceRunsList()
    expect(result.path).toBe('.dsh/yantao/workspace-runs.json')
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).toMatchObject({ status: 'success', trigger: 'manual' })
  })
})
