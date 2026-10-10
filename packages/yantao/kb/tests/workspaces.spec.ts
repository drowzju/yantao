import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  markInstruction, newInstructionId, newWorkspaceId, normalizeWorkspaces, readWorkspaces,
  WORKSPACES_DISPLAY_PATH, WORKSPACES_SOFT_CAP, writeWorkspaces,
  type WorkspaceDef,
} from '../src/workspaces.ts'
import { KbError } from '../src/types.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-workspaces-'))
  await mkdir(join(kbRoot, '.dsh', 'yantao'), { recursive: true })
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** One valid workspace; overrides land on top. */
function workspace(overrides: Partial<WorkspaceDef> = {}): WorkspaceDef {
  return {
    id: 'wsp_abc123def',
    name: '报告车间',
    directory: 'D:\\notes\\reports',
    agent: 'codebuddy',
    instructions: [{
      id: 'ins_abc123def',
      name: '日报',
      enabled: true,
      steps: ['汇总今天的改动'],
    }],
    ...overrides,
  }
}

describe('normalizeWorkspaces', () => {
  it('修剪空白并保留可选字段', () => {
    const [space] = normalizeWorkspaces([workspace({
      name: '  报告车间  ',
      directory: '  D:\\notes  ',
      model: '  glm-5  ',
      instructions: [{ id: 'ins_a1', name: ' 日报 ', enabled: true, steps: [' 汇总 '] , cron: ' 0 9 * * * ' } as never],
    })])
    expect(space?.name).toBe('报告车间')
    expect(space?.directory).toBe('D:\\notes')
    expect(space?.model).toBe('glm-5')
    expect(space?.instructions[0]?.name).toBe('日报')
    expect(space?.instructions[0]?.cron).toBe('0 9 * * *')
  })

  it('cron 缺席/空串 = 仅手动触发', () => {
    const [space] = normalizeWorkspaces([workspace()])
    expect(space?.instructions[0]?.cron).toBeUndefined()
    const [withEmpty] = normalizeWorkspaces([workspace({
      instructions: [{ id: 'ins_a1', name: '日报', enabled: true, steps: ['x'], cron: '' } as never],
    })])
    expect(withEmpty?.instructions[0]?.cron).toBeUndefined()
  })

  it('拒绝缺 id、空名称、空目录、坏 agent、坏 cron、空步骤、重复 id', () => {
    expect(() => normalizeWorkspaces([workspace({ id: '' })])).toThrow(KbError)
    expect(() => normalizeWorkspaces([workspace({ name: ' ' })])).toThrow(/名称/)
    expect(() => normalizeWorkspaces([workspace({ directory: '' })])).toThrow(/目录/)
    expect(() => normalizeWorkspaces([workspace({ agent: 'claude' as never })])).toThrow(/codebuddy/)
    expect(() => normalizeWorkspaces([workspace({
      instructions: [{ id: 'ins_a1', name: '日报', enabled: true, steps: ['x'], cron: '不是 cron' } as never],
    })])).toThrow(/触发规则/)
    expect(() => normalizeWorkspaces([workspace(), workspace()])).toThrow(/重复/)
    expect(() => normalizeWorkspaces([workspace({
      instructions: [
        { id: 'ins_a1', name: '甲', enabled: true, steps: ['x'] },
        { id: 'ins_a1', name: '乙', enabled: true, steps: ['y'] },
      ] as never,
    })])).toThrow(/重复/)
  })

  it('空指令列表合法（新建空间还没有指令）；空步骤、超长步骤拒绝', () => {
    expect(() => normalizeWorkspaces([workspace({ instructions: [] })])).not.toThrow()
    expect(() => normalizeWorkspaces([workspace({
      instructions: [{ id: 'ins_a1', name: '日报', enabled: true, steps: ['  '] } as never],
    })])).toThrow(/第 1 步/)
    expect(() => normalizeWorkspaces([workspace({
      instructions: [{ id: 'ins_a1', name: '日报', enabled: true, steps: Array.from({ length: 11 }, () => 'x') } as never],
    })])).toThrow(/步骤链过长/)
  })

  it('软帽之上拒绝', () => {
    const many = Array.from({ length: WORKSPACES_SOFT_CAP + 1 }, (_, at) =>
      workspace({ id: `wsp_${at}`, name: `空间 ${at}` }))
    expect(() => normalizeWorkspaces(many)).toThrow(/最多/)
  })
})

describe('readWorkspaces / writeWorkspaces', () => {
  it('缺文件读作空列表', async () => {
    await expect(readWorkspaces(kbRoot)).resolves.toEqual([])
  })

  it('写后读回同一列表', async () => {
    const rows = [workspace(), workspace({ id: 'wsp_b22222222', name: '素材间', directory: 'D:\\mat' })]
    await writeWorkspaces(kbRoot, rows)
    await expect(readWorkspaces(kbRoot)).resolves.toEqual(rows)
  })

  it('坏 JSON 是响亮的错误', async () => {
    await writeFile(join(kbRoot, WORKSPACES_DISPLAY_PATH), '{ 不是 json', 'utf8')
    await expect(readWorkspaces(kbRoot)).rejects.toThrow(KbError)
  })

  it('写前校验：坏列表不碰文件', async () => {
    await writeWorkspaces(kbRoot, [workspace()])
    await expect(writeWorkspaces(kbRoot, [workspace({ agent: 'claude' as never })])).rejects.toThrow(KbError)
    await expect(readWorkspaces(kbRoot)).resolves.toEqual([workspace()])
  })

  it('新 KB 没有 .dsh/yantao 目录时也能写（原子写自带建目录）', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'yantao-kb-workspaces-fresh-'))
    try {
      await writeWorkspaces(fresh, [workspace()])
      await expect(readWorkspaces(fresh)).resolves.toEqual([workspace()])
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})

describe('markInstruction', () => {
  it('只动目标指令的时间戳：设置、清除、留不动', async () => {
    await writeWorkspaces(kbRoot, [workspace()])
    const fired = await markInstruction(kbRoot, 'wsp_abc123def', 'ins_abc123def',
      { lastFiredAt: '2026-10-10T09:00:00.000Z' })
    expect(fired[0]?.instructions[0]).toMatchObject({
      lastFiredAt: '2026-10-10T09:00:00.000Z',
      name: '日报',
      steps: ['汇总今天的改动'],
    })
    const missed = await markInstruction(kbRoot, 'wsp_abc123def', 'ins_abc123def',
      { lastMissedAt: '2026-10-10T10:00:00.000Z' })
    expect(missed[0]?.instructions[0]).toMatchObject({
      lastFiredAt: '2026-10-10T09:00:00.000Z',
      lastMissedAt: '2026-10-10T10:00:00.000Z',
    })
    const cleared = await markInstruction(kbRoot, 'wsp_abc123def', 'ins_abc123def', { lastMissedAt: null })
    expect(cleared[0]?.instructions[0]?.lastFiredAt).toBe('2026-10-10T09:00:00.000Z')
    expect(cleared[0]?.instructions[0]?.lastMissedAt).toBeUndefined()
    await expect(readWorkspaces(kbRoot)).resolves.toEqual(cleared)
  })

  it('另一条指令与另一个空间不受影响', async () => {
    await writeWorkspaces(kbRoot, [workspace({
      instructions: [
        { id: 'ins_a1', name: '甲', enabled: true, steps: ['x'] },
        { id: 'ins_a2', name: '乙', enabled: true, steps: ['y'] },
      ] as never,
    }), workspace({ id: 'wsp_b22222222', name: '素材间', directory: 'D:\\mat' })])
    const next = await markInstruction(kbRoot, 'wsp_abc123def', 'ins_a1', { lastFiredAt: '2026-10-10T09:00:00.000Z' })
    expect(next[0]?.instructions[0]?.lastFiredAt).toBe('2026-10-10T09:00:00.000Z')
    expect(next[0]?.instructions[1]?.lastFiredAt).toBeUndefined()
    expect(next[1]?.instructions[0]?.lastFiredAt).toBeUndefined()
  })

  it('未知空间或指令拒绝', async () => {
    await writeWorkspaces(kbRoot, [workspace()])
    await expect(markInstruction(kbRoot, 'wsp_ghost', 'ins_abc123def', { lastFiredAt: 'x' })).rejects.toThrow(KbError)
    await expect(markInstruction(kbRoot, 'wsp_abc123def', 'ins_ghost', { lastFiredAt: 'x' })).rejects.toThrow(KbError)
  })
})

describe('newWorkspaceId / newInstructionId', () => {
  it('嵌入创建时间且互不重复', () => {
    const now = new Date('2026-10-10T08:00:00.000Z')
    const firstSpace = newWorkspaceId(now)
    const secondSpace = newWorkspaceId(now)
    expect(firstSpace.startsWith(`wsp_${now.getTime().toString(36)}`)).toBe(true)
    expect(firstSpace).not.toBe(secondSpace)
    const instruction = newInstructionId(now)
    expect(instruction.startsWith(`ins_${now.getTime().toString(36)}`)).toBe(true)
  })
})
