/**
 * The schedule store (ADR-0045): the human's timed tasks — each entry runs
 * its `prompt` as a background session when its `cron` fires. The file lives
 * at `<kbRoot>/.dsh/yantao/schedules.json`; the UI is the only writer (the
 * human channel, ADR-0045 决定 4) — the agent has no tool into this surface,
 * not even a read: a schedule spends model tokens on its own, so the trust
 * anchor stays on the human's one-time create/enable action.
 *
 * The store validates shape only (five-field cron tokens, bounded strings);
 * the actual matching/next-fire computation lives in the frontend scheduler
 * (ADR-0045 决定 2/6), which is the store's sole runtime consumer.
 * @module @deepseek-ai/dsh-yantao-kb/schedules
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { KbError } from './types.ts'

/**
 * One timed task definition. Instances (each actual fire) never persist —
 * they live in the frontend task view's memory (ADR-0031/0045 决定 1).
 */
export interface Schedule {
  /** Stable identity, assigned at creation; edits and reorders keep it. */
  readonly id: string
  /** Display name; the fired session is titled 「调度 · <name>」. */
  readonly name: string
  /** The prompt fired as a background session — a snapshot, not a reference (ADR-0045 决定 5). */
  readonly prompt: string
  /** Five-field cron (分 时 日 月 周); the UI's simple options are mere generators of this string. */
  readonly cron: string
  /** Disabled entries stay in the list but never fire. */
  readonly enabled: boolean
  /** ISO timestamp of the last fire the scheduler reported; absent when never fired. */
  readonly lastFiredAt?: string
  /** ISO timestamp of the most recent missed fire detected at startup; cleared on the next real fire. */
  readonly lastMissedAt?: string
}

/** The store's on-disk shape. */
export interface ScheduleFile {
  readonly version: 1
  readonly schedules: readonly Schedule[]
}

/** Where the store lives, relative to the KB root. */
export const SCHEDULES_DISPLAY_PATH = '.dsh/yantao/schedules.json'

/** The human edits a handful of rows; past this the list is a smell. */
export const SCHEDULES_SOFT_CAP = 50

/** Hard length caps. */
const NAME_MAX = 64
const PROMPT_MAX = 4000
const CRON_MAX = 64

/** Field ranges for the five cron positions: 分 时 日 月 周（周日 0 或 7）. */
const CRON_FIELD_RANGES = [
  { name: '分', min: 0, max: 59 },
  { name: '时', min: 0, max: 23 },
  { name: '日', min: 1, max: 31 },
  { name: '月', min: 1, max: 12 },
  { name: '周', min: 0, max: 7 },
] as const

/** Where the store sits on disk. */
function schedulesTarget(kbRoot: string): string {
  return join(kbRoot, '.dsh', 'yantao', 'schedules.json')
}

/** A fresh schedule id: `sch_<base36 ms>_<random>` — the underscore parts the embedded creation time from the suffix. */
export function newScheduleId(now: Date = new Date()): string {
  return `sch_${now.getTime().toString(36)}_${randomBytes(4).toString('hex')}`
}

/**
 * Validate one cron expression's shape: exactly five whitespace-separated
 * fields, each a comma list of items where an item is `*`, a number, a range
 * `a-b`, optionally with a `/step` suffix, all numbers inside the field's
 * range. This is shape validation — it does not compute fire times.
 * @param cron - the expression as typed.
 * @returns `null` when valid, otherwise a Chinese message the UI shows verbatim.
 */
export function cronShapeError(cron: string): string | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) {
    return `触发规则需要 5 段（分 时 日 月 周），当前是 ${fields.length} 段`
  }
  for (let at = 0; at < 5; at += 1) {
    const field = fields[at]
    const range = CRON_FIELD_RANGES[at]
    if (field === undefined || range === undefined) {
      return `触发规则需要 5 段（分 时 日 月 周），当前是 ${fields.length} 段`
    }
    const { name, min, max } = range
    for (const item of field.split(',')) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item)
      const body = match?.[1]
      if (match === null || body === undefined) {
        return `触发规则第 ${at + 1} 段（${name}）的「${item}」不合法：支持 *、数字、范围（如 1-5）、步进（如 */10）`
      }
      const step = match[2]
      if (step !== undefined && (Number(step) < 1 || Number(step) > max - min + 1)) {
        return `触发规则第 ${at + 1} 段（${name}）的步进 ${step} 超出范围`
      }
      if (body !== '*') {
        const [loText, hiText] = body.split('-')
        const lo = Number(loText)
        const hi = hiText === undefined ? undefined : Number(hiText)
        if (Number.isNaN(lo) || lo < min || lo > max
          || (hi !== undefined && (Number.isNaN(hi) || hi < lo || hi > max))) {
          return `触发规则第 ${at + 1} 段（${name}）的「${body}」超出 ${min}-${max} 范围`
        }
      }
    }
  }
  return null
}

/**
 * Validate one schedule list in full: ids unique, names/prompts/crons
 * bounded and well-formed. Shape errors carry Chinese messages the UI shows
 * verbatim.
 * @param schedules - the list as the caller wants it stored, order included.
 * @returns the same list, normalized (trimmed).
 */
export function normalizeSchedules(schedules: readonly unknown[]): Schedule[] {
  if (schedules.length > SCHEDULES_SOFT_CAP) {
    throw new KbError('too-many-schedules', `调度最多 ${SCHEDULES_SOFT_CAP} 条`)
  }
  const seen = new Set<string>()
  return schedules.map((item, at) => {
    if (typeof item !== 'object' || item === null) {
      throw new KbError('bad-schedule', `第 ${at + 1} 条调度格式不对`)
    }
    const raw = item as {
      id?: unknown
      name?: unknown
      prompt?: unknown
      cron?: unknown
      enabled?: unknown
      lastFiredAt?: unknown
      lastMissedAt?: unknown
    }
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      throw new KbError('bad-schedule-id', `第 ${at + 1} 条调度缺少 id`)
    }
    const id = raw.id.trim()
    if (seen.has(id)) {
      throw new KbError('duplicate-schedule', `调度 id「${id}」重复了`)
    }
    seen.add(id)
    if (typeof raw.name !== 'string' || raw.name.trim() === '') {
      throw new KbError('bad-schedule-name', `第 ${at + 1} 条调度的名称不能为空`)
    }
    const name = raw.name.trim()
    if (name.length > NAME_MAX) {
      throw new KbError('bad-schedule-name', `调度「${name}」的名称过长（上限 ${NAME_MAX} 字）`)
    }
    if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
      throw new KbError('bad-schedule-prompt', `调度「${name}」的提示词不能为空`)
    }
    const prompt = raw.prompt.trim()
    if (prompt.length > PROMPT_MAX) {
      throw new KbError('bad-schedule-prompt', `调度「${name}」的提示词过长（上限 ${PROMPT_MAX} 字）`)
    }
    if (typeof raw.cron !== 'string' || raw.cron.trim() === '') {
      throw new KbError('bad-schedule-cron', `调度「${name}」的触发规则不能为空`)
    }
    const cron = raw.cron.trim()
    if (cron.length > CRON_MAX) {
      throw new KbError('bad-schedule-cron', `调度「${name}」的触发规则过长`)
    }
    const shapeError = cronShapeError(cron)
    if (shapeError !== null) {
      throw new KbError('bad-schedule-cron', `调度「${name}」：${shapeError}`)
    }
    for (const stamp of [raw.lastFiredAt, raw.lastMissedAt]) {
      if (stamp !== undefined && (typeof stamp !== 'string' || Number.isNaN(Date.parse(stamp)))) {
        throw new KbError('bad-schedule-stamp', `调度「${name}」的时间戳不是合法日期`)
      }
    }
    return {
      id,
      name,
      prompt,
      cron,
      enabled: raw.enabled === true,
      ...raw.lastFiredAt !== undefined ? { lastFiredAt: raw.lastFiredAt as string } : {},
      ...raw.lastMissedAt !== undefined ? { lastMissedAt: raw.lastMissedAt as string } : {},
    }
  })
}

/**
 * Read the whole store. An absent file is an empty list (nothing saved yet);
 * a corrupt file is a loud error — the human's saved data must not be
 * silently discarded.
 * @param kbRoot - the live KB root.
 * @returns the schedules in stored order.
 */
export async function readSchedules(kbRoot: string): Promise<Schedule[]> {
  let raw: string
  try {
    raw = await readFile(schedulesTarget(kbRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new KbError('bad-schedules-file', `${SCHEDULES_DISPLAY_PATH} 不是合法 JSON，请修复或删除后重试`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { schedules?: unknown }).schedules)) {
    throw new KbError('bad-schedules-file', `${SCHEDULES_DISPLAY_PATH} 缺少 schedules 数组`)
  }
  return normalizeSchedules((parsed as { schedules: readonly unknown[] }).schedules)
}

/**
 * Replace the whole store (the UI edits a small list, so full-list saves keep
 * reorder trivially correct). Validation runs before the write, so a rejected
 * save never touches the file; the parent directory is created first — a
 * fresh KB has no `.dsh/yantao/` until something writes there.
 * @param kbRoot - the live KB root.
 * @param schedules - the complete new list, in display order.
 */
export async function writeSchedules(kbRoot: string, schedules: readonly Schedule[]): Promise<void> {
  const validated = normalizeSchedules(schedules)
  const target = schedulesTarget(kbRoot)
  await mkdir(dirname(target), { recursive: true })
  const payload = JSON.stringify({ version: 1, schedules: validated } satisfies ScheduleFile, null, 2) + '\n'
  await writeFile(target, payload, 'utf8')
}

/**
 * The scheduler-owned stamps of one row (ADR-0045): the two fields the human
 * editor never authors. A patch value of `undefined` leaves the field alone;
 * `null` clears it (a real fire clears the missed mark).
 */
export interface ScheduleStampsPatch {
  readonly lastFiredAt?: string | null
  readonly lastMissedAt?: string | null
}

/**
 * Patch one row's scheduler-owned stamps. This is the scheduler's write path
 * (ADR-0045 落地注记修订): single-row patches instead of full-list saves, so
 * the human's whole-list edits and the scheduler's bookkeeping can never
 * clobber each other's fields — `writeSchedules` preserves the stored stamps
 * for existing rows, and this function touches nothing but the stamps.
 * @param kbRoot - the live KB root.
 * @param id - the row to patch.
 * @param patch - the stamp changes; `null` clears, `undefined` leaves alone.
 * @returns the full list as stored after the patch.
 */
export async function markSchedule(kbRoot: string, id: string, patch: ScheduleStampsPatch): Promise<Schedule[]> {
  const rows = await readSchedules(kbRoot)
  if (!rows.some(row => row.id === id)) {
    throw new KbError('unknown-schedule', `调度 ${id} 不存在`)
  }
  const next = rows.map((row): Schedule => {
    if (row.id !== id) return row
    const fired = patch.lastFiredAt === undefined ? row.lastFiredAt : patch.lastFiredAt
    const missed = patch.lastMissedAt === undefined ? row.lastMissedAt : patch.lastMissedAt
    return {
      id: row.id,
      name: row.name,
      prompt: row.prompt,
      cron: row.cron,
      enabled: row.enabled,
      ...fired !== null && fired !== undefined ? { lastFiredAt: fired } : {},
      ...missed !== null && missed !== undefined ? { lastMissedAt: missed } : {},
    }
  })
  await writeSchedules(kbRoot, next)
  return next
}
