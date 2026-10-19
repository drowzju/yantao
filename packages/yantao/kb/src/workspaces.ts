/**
 * The workspace store (ADR-0056): the human's bindings of directory +
 * agent/model, each carrying instructions — an optional five-field cron plus
 * a prompt chain. The file lives at `<kbRoot>/.dsh/yantao/workspaces.json`;
 * the UI is the only writer (the human channel — a workspace instruction is
 * the human's own arrangement, so unlike the ADR-0047 inbox it needs no
 * approval queue; creating it IS the approval). The agent has no tool into
 * this surface.
 *
 * The store validates shape only (five-field cron tokens, bounded strings);
 * the matching/next-fire computation lives beside it in `cron.ts` (the
 * controller-side twin of the client matcher), consumed by the controller's
 * workspace tick. Execution itself is the controller's runtime (ADR-0056
 * 决定 4) — spawning the bound agent is never this store's business.
 * @module @deepseek-ai/dsh-yantao-kb/workspaces
 */

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { cronShapeError } from './schedules.ts'
import { KbError } from './types.ts'

/** One instruction inside a workspace: an optional schedule plus a prompt chain. */
export interface WorkspaceInstruction {
  /** Stable identity, assigned at creation; edits keep it. */
  readonly id: string
  /** Display name, shown on cards and run rows. */
  readonly name: string
  /** Five-field cron (分 时 日 月 周); absent = manual trigger only. */
  readonly cron?: string
  /** Disabled instructions stay in the list but never fire. */
  readonly enabled: boolean
  /** The prompt chain (ADR-0056 决定 3) — snapshots, not references; ≥1 step. */
  readonly steps: readonly string[]
  /** ISO timestamp of the last cron fire; absent when never fired. */
  readonly lastFiredAt?: string
  /** ISO timestamp of the most recent missed fire; a real fire clears it. */
  readonly lastMissedAt?: string
}

/** One workspace: a directory binding plus its instructions. */
export interface WorkspaceDef {
  /** Stable identity, assigned at creation; edits keep it. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** The bound directory (absolute); the agent's cwd, and the human's grant of territory. */
  readonly directory: string
  /** The executor family; today only `codebuddy` (ADR-0056 决定 2). */
  readonly agent: 'codebuddy'
  /** Optional model selector, passed through as `--model`; the key stays with the agent's own credentials. */
  readonly model?: string
  /** The instructions this workspace carries. */
  readonly instructions: readonly WorkspaceInstruction[]
}

/** The store's on-disk shape. */
export interface WorkspaceFile {
  readonly version: 1
  readonly workspaces: readonly WorkspaceDef[]
}

/** Where the store lives, relative to the KB root. */
export const WORKSPACES_DISPLAY_PATH = '.dsh/yantao/workspaces.json'

/** The human edits a handful of rows; past this the list is a smell. */
export const WORKSPACES_SOFT_CAP = 50

/** Hard length caps. */
const NAME_MAX = 64
const DIRECTORY_MAX = 1024
const MODEL_MAX = 64
const STEP_MAX = 10
const STEP_PROMPT_MAX = 4000

/** Where the store sits on disk. */
function workspacesTarget(kbRoot: string): string {
  return join(kbRoot, '.dsh', 'yantao', 'workspaces.json')
}

/** A fresh workspace id: `wsp_<base36 ms>_<random>` — same recipe as the schedule ids. */
export function newWorkspaceId(now: Date = new Date()): string {
  return `wsp_${now.getTime().toString(36)}_${randomBytes(4).toString('hex')}`
}

/** A fresh instruction id: `ins_<base36 ms>_<random>` — the embedded time is the tick's baseline fallback. */
export function newInstructionId(now: Date = new Date()): string {
  return `ins_${now.getTime().toString(36)}_${randomBytes(4).toString('hex')}`
}

/** Normalize one instruction, throwing a Chinese diagnostic on any shape violation. */
function normalizeInstruction(raw: {
  id?: unknown
  name?: unknown
  cron?: unknown
  enabled?: unknown
  steps?: unknown
  lastFiredAt?: unknown
  lastMissedAt?: unknown
}, label: string): WorkspaceInstruction {
  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    throw new KbError('bad-instruction-id', `指令「${label}」缺少 id`)
  }
  const id = raw.id.trim()
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new KbError('bad-instruction-name', `指令 ${id} 的名称不能为空`)
  }
  const name = raw.name.trim()
  if (name.length > NAME_MAX) {
    throw new KbError('bad-instruction-name', `指令「${name}」的名称过长（上限 ${NAME_MAX} 字）`)
  }
  let cron: string | undefined
  if (raw.cron !== undefined && raw.cron !== null && raw.cron !== '') {
    if (typeof raw.cron !== 'string') {
      throw new KbError('bad-instruction-cron', `指令「${name}」的触发规则不是字符串`)
    }
    cron = raw.cron.trim()
    const shapeError = cronShapeError(cron)
    if (shapeError !== null) {
      throw new KbError('bad-instruction-cron', `指令「${name}」：${shapeError}`)
    }
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new KbError('bad-instruction-steps', `指令「${name}」至少需要一个提示词步骤`)
  }
  if (raw.steps.length > STEP_MAX) {
    throw new KbError('bad-instruction-steps', `指令「${name}」的步骤链过长（上限 ${STEP_MAX} 步）`)
  }
  const steps = raw.steps.map((step, at) => {
    if (typeof step !== 'string' || step.trim() === '') {
      throw new KbError('bad-instruction-steps', `指令「${name}」的第 ${at + 1} 步提示词不能为空`)
    }
    const text = step.trim()
    if (text.length > STEP_PROMPT_MAX) {
      throw new KbError('bad-instruction-steps', `指令「${name}」的第 ${at + 1} 步提示词过长（上限 ${STEP_PROMPT_MAX} 字）`)
    }
    return text
  })
  for (const stamp of [raw.lastFiredAt, raw.lastMissedAt]) {
    if (stamp !== undefined && (typeof stamp !== 'string' || Number.isNaN(Date.parse(stamp as string)))) {
      throw new KbError('bad-instruction-stamp', `指令「${name}」的时间戳不是合法日期`)
    }
  }
  return {
    id,
    name,
    ...cron !== undefined ? { cron } : {},
    enabled: raw.enabled === true,
    steps,
    ...raw.lastFiredAt !== undefined ? { lastFiredAt: raw.lastFiredAt as string } : {},
    ...raw.lastMissedAt !== undefined ? { lastMissedAt: raw.lastMissedAt as string } : {},
  }
}

/**
 * Validate one workspace list in full: ids unique (workspaces and
 * instructions each), names/directories/models bounded, crons well-formed,
 * step chains non-empty. Shape errors carry Chinese messages the UI shows
 * verbatim.
 * @param workspaces - the list as the caller wants it stored, order included.
 * @returns the same list, normalized (trimmed).
 */
export function normalizeWorkspaces(workspaces: readonly unknown[]): WorkspaceDef[] {
  if (workspaces.length > WORKSPACES_SOFT_CAP) {
    throw new KbError('too-many-workspaces', `工作空间最多 ${WORKSPACES_SOFT_CAP} 个`)
  }
  const seenSpaces = new Set<string>()
  return workspaces.map((item, at) => {
    if (typeof item !== 'object' || item === null) {
      throw new KbError('bad-workspace', `第 ${at + 1} 个工作空间格式不对`)
    }
    const raw = item as {
      id?: unknown
      name?: unknown
      directory?: unknown
      agent?: unknown
      model?: unknown
      instructions?: unknown
    }
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      throw new KbError('bad-workspace-id', `第 ${at + 1} 个工作空间缺少 id`)
    }
    const id = raw.id.trim()
    if (seenSpaces.has(id)) {
      throw new KbError('duplicate-workspace', `工作空间 id「${id}」重复了`)
    }
    seenSpaces.add(id)
    if (typeof raw.name !== 'string' || raw.name.trim() === '') {
      throw new KbError('bad-workspace-name', `工作空间 ${id} 的名称不能为空`)
    }
    const name = raw.name.trim()
    if (name.length > NAME_MAX) {
      throw new KbError('bad-workspace-name', `工作空间「${name}」的名称过长（上限 ${NAME_MAX} 字）`)
    }
    if (typeof raw.directory !== 'string' || raw.directory.trim() === '') {
      throw new KbError('bad-workspace-directory', `工作空间「${name}」的目录不能为空`)
    }
    const directory = raw.directory.trim()
    if (directory.length > DIRECTORY_MAX) {
      throw new KbError('bad-workspace-directory', `工作空间「${name}」的目录路径过长`)
    }
    if (raw.agent !== 'codebuddy') {
      throw new KbError('bad-workspace-agent', `工作空间「${name}」的 agent 只支持 codebuddy`)
    }
    let model: string | undefined
    if (raw.model !== undefined && raw.model !== null && raw.model !== '') {
      if (typeof raw.model !== 'string') {
        throw new KbError('bad-workspace-model', `工作空间「${name}」的模型不是字符串`)
      }
      model = raw.model.trim()
      if (model.length > MODEL_MAX) {
        throw new KbError('bad-workspace-model', `工作空间「${name}」的模型名过长（上限 ${MODEL_MAX} 字）`)
      }
    }
    if (!Array.isArray(raw.instructions)) {
      throw new KbError('bad-workspace-instructions', `工作空间「${name}」缺少指令列表`)
    }
    const seenInstructions = new Set<string>()
    const instructions = raw.instructions.map((item) => {
      if (typeof item !== 'object' || item === null) {
        throw new KbError('bad-instruction', `工作空间「${name}」有一条指令格式不对`)
      }
      const rawInstruction = item as { name?: unknown }
      const label = typeof rawInstruction.name === 'string' && rawInstruction.name.trim() !== ''
        ? rawInstruction.name.trim()
        : id
      const instruction = normalizeInstruction(item as Record<string, unknown>, label)
      if (seenInstructions.has(instruction.id)) {
        throw new KbError('duplicate-instruction', `指令 id「${instruction.id}」重复了`)
      }
      seenInstructions.add(instruction.id)
      return instruction
    })
    return {
      id,
      name,
      directory,
      agent: 'codebuddy' as const,
      ...model !== undefined ? { model } : {},
      instructions,
    }
  })
}

/**
 * Read the whole store. An absent file is an empty list (nothing saved yet);
 * a corrupt file is a loud error — the human's saved data must not be
 * silently discarded.
 * @param kbRoot - the live KB root.
 * @returns the workspaces in stored order.
 */
export async function readWorkspaces(kbRoot: string): Promise<WorkspaceDef[]> {
  let raw: string
  try {
    raw = await readFile(workspacesTarget(kbRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new KbError('bad-workspaces-file', `${WORKSPACES_DISPLAY_PATH} 不是合法 JSON，请修复或删除后重试`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { workspaces?: unknown }).workspaces)) {
    throw new KbError('bad-workspaces-file', `${WORKSPACES_DISPLAY_PATH} 缺少 workspaces 数组`)
  }
  return normalizeWorkspaces((parsed as { workspaces: readonly unknown[] }).workspaces)
}

/**
 * Replace the whole store (the UI edits a small list, so full-list saves keep
 * reorder trivially correct — same recipe as the schedule store). Validation
 * runs before the write, so a rejected save never touches the file; the
 * atomic write brings the parent directory along.
 * @param kbRoot - the live KB root.
 * @param workspaces - the complete new list, in display order.
 */
export async function writeWorkspaces(kbRoot: string, workspaces: readonly WorkspaceDef[]): Promise<void> {
  const validated = normalizeWorkspaces(workspaces)
  const payload = JSON.stringify({ version: 1, workspaces: validated } satisfies WorkspaceFile, null, 2) + '\n'
  await writeFileAtomic(workspacesTarget(kbRoot), payload, { mode: 0o600 })
}

/**
 * The schedule-facing patch of one instruction (ADR-0064): the 调度 tab is
 * the cron's only editor once the workspace panel sheds its own — a
 * single-row patch instead of a full-list save, so the two panels' writes
 * can never clobber each other's fields. `cron: null` clears the rule
 * (the instruction returns to manual-only); a string sets it (validated by
 * the write's own shape check). `enabled` is always carried.
 * @param kbRoot - the live KB root.
 * @param workspaceId - the owning workspace.
 * @param instructionId - the instruction to patch.
 * @param patch - the new cron (null clears) and the enabled flag.
 * @returns the full list as stored after the patch.
 */
export interface InstructionSchedulePatch {
  /** The new five-field cron; `null` clears the rule (manual-only again). */
  readonly cron: string | null
  /** The enabled flag, carried as-is. */
  readonly enabled: boolean
}

export async function setInstructionSchedule(
  kbRoot: string,
  workspaceId: string,
  instructionId: string,
  patch: InstructionSchedulePatch,
): Promise<WorkspaceDef[]> {
  const spaces = await readWorkspaces(kbRoot)
  const space = spaces.find(candidate => candidate.id === workspaceId)
  if (space === undefined) {
    throw new KbError('unknown-workspace', `工作空间 ${workspaceId} 不存在`)
  }
  if (!space.instructions.some(instruction => instruction.id === instructionId)) {
    throw new KbError('unknown-instruction', `指令 ${instructionId} 不存在于工作空间「${space.name}」`)
  }
  const cron = patch.cron === null ? undefined : patch.cron.trim()
  const next = spaces.map(candidate => candidate.id !== workspaceId ? candidate : {
    ...candidate,
    instructions: candidate.instructions.map((instruction) => {
      if (instruction.id !== instructionId) return instruction
      // 逐字段重建（markInstruction 的配方）：null 的语义是"清除"，spread 会留旧值
      return {
        id: instruction.id,
        name: instruction.name,
        ...cron !== undefined && cron !== '' ? { cron } : {},
        enabled: patch.enabled,
        steps: instruction.steps,
        ...instruction.lastFiredAt !== undefined ? { lastFiredAt: instruction.lastFiredAt } : {},
        ...instruction.lastMissedAt !== undefined ? { lastMissedAt: instruction.lastMissedAt } : {},
      }
    }),
  })
  await writeWorkspaces(kbRoot, next)
  return next
}

/**
 * The tick-owned stamps of one instruction (ADR-0056 决定 5): the two fields
 * the human editor never authors. A patch value of `undefined` leaves the
 * field alone; `null` clears it (a real fire clears the missed mark).
 */
export interface InstructionStampsPatch {
  readonly lastFiredAt?: string | null
  readonly lastMissedAt?: string | null
}

/**
 * Patch one instruction's tick-owned stamps. The controller's cron tick is
 * this function's only caller — single-row patches instead of full-list
 * saves, so the human's whole-list edits and the tick's bookkeeping can
 * never clobber each other's fields.
 * @param kbRoot - the live KB root.
 * @param workspaceId - the owning workspace.
 * @param instructionId - the instruction to patch.
 * @param patch - the stamp changes; `null` clears, `undefined` leaves alone.
 * @returns the full list as stored after the patch.
 */
export async function markInstruction(
  kbRoot: string,
  workspaceId: string,
  instructionId: string,
  patch: InstructionStampsPatch,
): Promise<WorkspaceDef[]> {
  const spaces = await readWorkspaces(kbRoot)
  const space = spaces.find(candidate => candidate.id === workspaceId)
  if (space === undefined) {
    throw new KbError('unknown-workspace', `工作空间 ${workspaceId} 不存在`)
  }
  if (!space.instructions.some(instruction => instruction.id === instructionId)) {
    throw new KbError('unknown-instruction', `指令 ${instructionId} 不存在于工作空间「${space.name}」`)
  }
  const next = spaces.map(candidate => candidate.id !== workspaceId ? candidate : {
    ...candidate,
    instructions: candidate.instructions.map((instruction) => {
      if (instruction.id !== instructionId) return instruction
      const fired = patch.lastFiredAt === undefined ? instruction.lastFiredAt : patch.lastFiredAt
      const missed = patch.lastMissedAt === undefined ? instruction.lastMissedAt : patch.lastMissedAt
      // 逐字段重建而不是 spread：`null` 的语义是"清除"，spread 会把旧值留在原地
      return {
        id: instruction.id,
        name: instruction.name,
        ...instruction.cron !== undefined ? { cron: instruction.cron } : {},
        enabled: instruction.enabled,
        steps: instruction.steps,
        ...fired !== null && fired !== undefined ? { lastFiredAt: fired } : {},
        ...missed !== null && missed !== undefined ? { lastMissedAt: missed } : {},
      }
    }),
  })
  await writeWorkspaces(kbRoot, next)
  return next
}
