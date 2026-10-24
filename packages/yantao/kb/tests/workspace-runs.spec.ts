import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendWorkspaceRun, clearWorkspaceRuns, deleteWorkspaceRun, finalizeInterruptedRuns, newRunId, normalizeWorkspaceRuns,
  appendScheduleRun, patchWorkspaceRun, readWorkspaceRuns, RUN_HISTORY_CAP,
  type WorkspaceRun,
} from '../src/workspace-runs.ts'
import { KbError } from '../src/types.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-ws-runs-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** One valid finalized run; overrides land on top. */
function run(overrides: Partial<WorkspaceRun> = {}): WorkspaceRun {
  return {
    id: 'run_abc123def',
    workspaceId: 'wsp_abc123def',
    instructionId: 'ins_abc123def',
    instructionName: '日报',
    trigger: 'manual',
    status: 'success',
    startedAt: '2026-10-10T09:00:00.000Z',
    finishedAt: '2026-10-10T09:02:00.000Z',
    steps: [{
      index: 0,
      promptSnapshot: '汇总今天的改动',
      startedAt: '2026-10-10T09:00:00.000Z',
      finishedAt: '2026-10-10T09:02:00.000Z',
      exitCode: 0,
      sessionId: 'sess_1',
      resultExcerpt: '完成',
    }],
    ...overrides,
  }
}

describe('normalizeWorkspaceRuns', () => {
  it('接受合法记录', () => {
    expect(normalizeWorkspaceRuns([run()])).toHaveLength(1)
  })

  it('拒绝缺 id、重复 id、缺身份字段、坏触发、坏状态、坏时间', () => {
    expect(() => normalizeWorkspaceRuns([run({ id: '' })])).toThrow(KbError)
    expect(() => normalizeWorkspaceRuns([run(), run()])).toThrow(/重复/)
    expect(() => normalizeWorkspaceRuns([run({ workspaceId: '' })])).toThrow(KbError)
    expect(() => normalizeWorkspaceRuns([run({ trigger: 'ghost' as never })])).toThrow(/触发方式/)
    expect(() => normalizeWorkspaceRuns([run({ status: 'flying' as never })])).toThrow(/状态/)
    expect(() => normalizeWorkspaceRuns([run({ startedAt: '不是日期' })])).toThrow(/开始时间/)
  })

  it('running 不带结束时间、终态必须带', () => {
    expect(() => normalizeWorkspaceRuns([run({ status: 'running', finishedAt: undefined })])).not.toThrow()
    expect(() => normalizeWorkspaceRuns([run({ status: 'running' as never, finishedAt: '2026-10-10T09:02:00.000Z' })]))
      .toThrow(/还在运行/)
    expect(() => normalizeWorkspaceRuns([run({ finishedAt: undefined })])).toThrow(/结束时间/)
  })

  it('环形帽之上拒绝（防御：正常路径靠 trimToCap 自愈）', () => {
    const many = Array.from({ length: RUN_HISTORY_CAP + 1 }, (_, at) => run({ id: `run_${at}` }))
    expect(() => normalizeWorkspaceRuns(many)).toThrow(/最多/)
  })
})

describe('readWorkspaceRuns / appendWorkspaceRun', () => {
  it('缺文件读作空列表', async () => {
    await expect(readWorkspaceRuns(kbRoot)).resolves.toEqual([])
  })

  it('追加后读回，步骤骨架带索引与快照', async () => {
    const created = await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'cron',
      steps: ['第一步', '第二步'],
    })
    expect(created.status).toBe('running')
    expect(created.trigger).toBe('cron')
    expect(created.steps).toEqual([
      { index: 0, promptSnapshot: '第一步' },
      { index: 1, promptSnapshot: '第二步' },
    ])
    await expect(readWorkspaceRuns(kbRoot)).resolves.toEqual([created])
  })

  it('坏 JSON 是响亮的错误', async () => {
    await mkdir(join(kbRoot, '.dsh', 'yantao'), { recursive: true })
    await writeFile(join(kbRoot, '.dsh', 'yantao', 'workspace-runs.json'), '{ 不是 json', 'utf8')
    await expect(readWorkspaceRuns(kbRoot)).rejects.toThrow(KbError)
  })

  it('环形裁剪：超过帽子丢最老的已终态行，running 行不动', async () => {
    const old = Array.from({ length: RUN_HISTORY_CAP }, (_, at) =>
      run({ id: `run_old_${at}`, startedAt: '2026-10-01T00:00:00.000Z' }))
    // 直接铺满历史基线（append 逐条太慢）
    const { writeFileAtomic } = await import('@deepseek-ai/dsh-atomic-write')
    await writeFileAtomic(join(kbRoot, '.dsh', 'yantao', 'workspace-runs.json'),
      JSON.stringify({ version: 1, runs: old }), { mode: 0o600 })
    // 追加一条新 run：总数超帽 1，最老的已终态行该掉
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'manual',
      steps: ['x'],
    })
    const stored = await readWorkspaceRuns(kbRoot)
    expect(stored).toHaveLength(RUN_HISTORY_CAP)
    expect(stored.some(entry => entry.id === 'run_old_0')).toBe(false)
    expect(stored.at(-1)?.status).toBe('running')
  })
})

describe('patchWorkspaceRun', () => {
  it('补步骤与会话、落终态', async () => {
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'manual',
      steps: ['第一步', '第二步'],
    })
    const [record] = await readWorkspaceRuns(kbRoot)
    const runId = record?.id ?? ''
    const stepped = await patchWorkspaceRun(kbRoot, runId, {
      steps: [{
        index: 0,
        promptSnapshot: '第一步',
        startedAt: '2026-10-10T09:00:00.000Z',
        finishedAt: '2026-10-10T09:01:00.000Z',
        exitCode: 0,
        sessionId: 'sess_1',
        resultExcerpt: '第一步完成',
      }],
    })
    expect(stepped[0]?.steps[0]?.sessionId).toBe('sess_1')
    const done = await patchWorkspaceRun(kbRoot, runId, {
      status: 'success',
      finishedAt: '2026-10-10T09:02:00.000Z',
      finalResult: '全部完成',
    })
    expect(done[0]).toMatchObject({ status: 'success', finishedAt: '2026-10-10T09:02:00.000Z', finalResult: '全部完成' })
    await expect(readWorkspaceRuns(kbRoot)).resolves.toEqual(done)
  })

  it('断链记录 failedStep 与 error，摘录超长截断', async () => {
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'manual',
      steps: ['炸的一步'],
    })
    const [record] = await readWorkspaceRuns(kbRoot)
    const patched = await patchWorkspaceRun(kbRoot, record?.id ?? '', {
      status: 'failed',
      finishedAt: '2026-10-10T09:01:00.000Z',
      failedStep: 0,
      finalResult: 'x'.repeat(20 * 1024),
      steps: [{
        index: 0,
        promptSnapshot: '炸的一步',
        startedAt: '2026-10-10T09:00:00.000Z',
        finishedAt: '2026-10-10T09:01:00.000Z',
        exitCode: 1,
        error: 'e'.repeat(2000),
      }],
    })
    expect(patched[0]?.failedStep).toBe(0)
    expect(patched[0]?.finalResult).toHaveLength(16 * 1024 + 1) // 16 KiB + 省略号
    expect(patched[0]?.steps[0]?.error).toHaveLength(501)
  })

  it('终态缺结束时间拒绝；未知 run 拒绝', async () => {
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'manual',
      steps: ['x'],
    })
    const [record] = await readWorkspaceRuns(kbRoot)
    await expect(patchWorkspaceRun(kbRoot, record?.id ?? '', { status: 'success' })).rejects.toThrow(/结束时间/)
    await expect(patchWorkspaceRun(kbRoot, 'run_ghost', { status: 'success', finishedAt: '2026-10-10T09:00:00.000Z' }))
      .rejects.toThrow(KbError)
  })
})

describe('finalizeInterruptedRuns', () => {
  it('把盘上的 running 行改成 interrupted，其余不动', async () => {
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'cron',
      steps: ['x'],
    })
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'cron',
      steps: ['y'],
    })
    // 第一行人为终态
    const [, second] = await readWorkspaceRuns(kbRoot)
    await patchWorkspaceRun(kbRoot, second?.id ?? '', { status: 'success', finishedAt: '2026-10-10T09:05:00.000Z' })
    const healed = await finalizeInterruptedRuns(kbRoot, new Date('2026-10-10T12:00:00.000Z'))
    expect(healed).toHaveLength(1)
    const runs = await readWorkspaceRuns(kbRoot)
    expect(runs[0]).toMatchObject({ status: 'interrupted', finishedAt: '2026-10-10T12:00:00.000Z' })
    expect(runs[1]?.status).toBe('success')
    // 再跑一遍是空操作
    await expect(finalizeInterruptedRuns(kbRoot)).resolves.toEqual([])
  })

  it('调度行的崩溃补记落 failed 并带原因（看门狗要把它送进钉钉管道）', async () => {
    await appendScheduleRun(kbRoot, {
      scheduleId: 'sch_mv0iguvc_982f1d0f',
      scheduleName: '周五公共AI提效周进展',
      status: 'running',
      startedAt: '2026-10-23T08:49:05.000Z',
    })
    const healed = await finalizeInterruptedRuns(kbRoot, new Date('2026-10-23T09:01:00.000Z'))
    expect(healed).toHaveLength(1)
    const [row] = await readWorkspaceRuns(kbRoot)
    expect(row).toMatchObject({
      trigger: 'schedule',
      status: 'failed',
      finishedAt: '2026-10-23T09:01:00.000Z',
    })
    expect(row?.error).toContain('运行中断')
  })

  it('running 调度行可以两段式收尾：先 running 落行，再 patch 到终态', async () => {
    const run = await appendScheduleRun(kbRoot, {
      scheduleId: 'sch_x',
      scheduleName: '每日邮件解析',
      status: 'running',
      startedAt: '2026-10-24T01:00:00.000Z',
    })
    expect(run.status).toBe('running')
    expect(run.finishedAt).toBeUndefined()
    // 正确姿势：patch 带 finishedAt
    const runs = await patchWorkspaceRun(kbRoot, run.id, {
      status: 'success',
      finishedAt: '2026-10-24T01:04:00.000Z',
      finalResult: '已解析 12 封',
      steps: [{ index: 0, promptSnapshot: '', sessionId: 'session-x' }],
    })
    expect(runs[0]).toMatchObject({
      status: 'success',
      finishedAt: '2026-10-24T01:04:00.000Z',
      finalResult: '已解析 12 封',
    })
  })
})

describe('clearWorkspaceRuns', () => {
  it('清掉终态行，保留 running 行，并返回清掉的条数', async () => {
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'manual',
      steps: ['x'],
    })
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'cron',
      steps: ['y'],
    })
    const [, second] = await readWorkspaceRuns(kbRoot)
    await patchWorkspaceRun(kbRoot, second?.id ?? '', { status: 'success', finishedAt: '2026-10-10T09:05:00.000Z' })
    const dropped = await clearWorkspaceRuns(kbRoot)
    expect(dropped).toBe(1)
    const runs = await readWorkspaceRuns(kbRoot)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('running')
    // 再清是空操作
    await expect(clearWorkspaceRuns(kbRoot)).resolves.toBe(0)
  })

  it('空历史是空操作', async () => {
    await expect(clearWorkspaceRuns(kbRoot)).resolves.toBe(0)
    await expect(readWorkspaceRuns(kbRoot)).resolves.toEqual([])
  })
})

describe('deleteWorkspaceRun', () => {
  it('删掉指定的一条，其余不动', async () => {
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'manual',
      steps: ['x'],
    })
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'cron',
      steps: ['y'],
    })
    const [first] = await readWorkspaceRuns(kbRoot)
    // 先落终态：running 行拒绝删除（下一测覆盖）
    await patchWorkspaceRun(kbRoot, first?.id ?? '', { status: 'success', finishedAt: '2026-10-10T09:05:00.000Z' })
    const remaining = await deleteWorkspaceRun(kbRoot, first?.id ?? '')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).not.toBe(first?.id)
    await expect(readWorkspaceRuns(kbRoot)).resolves.toEqual(remaining)
  })

  it('running 行拒绝；未知 id 拒绝', async () => {
    await appendWorkspaceRun(kbRoot, {
      workspaceId: 'wsp_abc123def',
      instructionId: 'ins_abc123def',
      instructionName: '日报',
      trigger: 'manual',
      steps: ['x'],
    })
    const [record] = await readWorkspaceRuns(kbRoot)
    await expect(deleteWorkspaceRun(kbRoot, record?.id ?? '')).rejects.toThrow(/还在运行/)
    await expect(deleteWorkspaceRun(kbRoot, 'run_ghost')).rejects.toThrow(/不存在/)
  })
})

describe('newRunId', () => {
  it('嵌入创建时间且互不重复', () => {
    const now = new Date('2026-10-10T08:00:00.000Z')
    const first = newRunId(now)
    const second = newRunId(now)
    expect(first.startsWith(`run_${now.getTime().toString(36)}`)).toBe(true)
    expect(first).not.toBe(second)
  })
})
