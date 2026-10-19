/**
 * The 调度 tab's pane (ADR-0045 决定 8): the definition list on the left, the
 * editor on the right. Definitions are the human's alone — this pane is the
 * store's only writer (决定 4); run instances never appear here, they live in
 * the 任务 tab (决定 1). The trigger rule edits through simple options
 * (每天 / 每周 / 每隔 N 分钟) that merely generate the stored cron string,
 * with an advanced mode that types the cron directly (决定 6); the prompt
 * field's 「从惯用提示词填入」 copies a snapshot, never a reference (决定 5).
 *
 * ADR-0064: the pane grows a second kind of schedulee — a workspace
 * instruction (ADR-0056). Its cron lives on the instruction itself and the
 * controller's tick fires it; this pane is merely the rule's editing view
 * (and, after the workspace panel shed its own cron editor, its only one).
 * Writes go through the narrow `workspaceInstructionScheduleSet` patch, never
 * a full-list save, so the two panels can't clobber each other's fields.
 *
 * Design discipline (apps/yantao/DESIGN.md): colors and metrics ride the
 * `--yt-*` tokens; the cron is a code fragment and wears the code font;
 * evidence (下次触发/上次触发/上次错过) owns its own muted line — never a
 * ` · ` tail; the destructive 删除 arms through a two-click tool button; the
 * dirty-editor guard is an in-pane confirm strip, never window.confirm.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { KbPromptShortcut, KbSchedule, KbWorkspace } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { cronNextFire } from './cron.ts'
import { ghostButtonStyle, primaryButtonStyle, raisedButtonStyle, toolButtonArmedStyle, toolButtonStyle } from './buttons.ts'
import { useArmedAction } from './use-armed-action.ts'
import { formatStamp } from './stamp.ts'
import type { PromptShortcutLister } from './remote.ts'

/** The instruction-schedule save seam's argument shape (ADR-0064). */
export interface InstructionScheduleSaveArgs {
  readonly workspaceId: string
  readonly instructionId: string
  readonly cron: string | null
  readonly enabled: boolean
}

/** The pane's props: the store's rows, the save seam, the shortcut source, and the capability roster. */
export interface SchedulePaneProps {
  /** The store's definitions in display order. */
  readonly schedules: readonly KbSchedule[]
  /** Replace the whole list; resolves true when the host accepted it. */
  readonly onSave: (next: readonly KbSchedule[]) => Promise<boolean>
  /** The 惯用提示词 loader — the editor's 填入 source (ADR-0040). */
  readonly promptShortcutList: PromptShortcutLister
  /** The registered capabilities' names — the editor's 绑定能力 menu. */
  readonly capabilityNames: readonly string[]
  /** The workspaces (ADR-0056) — the 工作空间指令 section's source. */
  readonly workspaces: readonly KbWorkspace[]
  /**
   * Set one instruction's trigger rule (ADR-0064); resolves null on
   * success, or the host's error prose for the editor's inline line.
   */
  readonly onInstructionScheduleSave: (args: InstructionScheduleSaveArgs) => Promise<string | null>
  /** Jump to the 工作空间 tab's run history (the instruction rows' affordance). */
  readonly onViewRunRecords: () => void
}

/** The editor's trigger-rule draft; the stored cron is always derived. */
type RuleDraft =
  | { readonly mode: 'daily'; readonly time: string }
  | { readonly mode: 'weekly'; readonly weekday: number; readonly time: string }
  | { readonly mode: 'interval'; readonly minutes: number }
  | { readonly mode: 'cron'; readonly cron: string }

/** Generate the stored cron string from one simple-option draft. */
function cronOfRule(rule: RuleDraft): string {
  if (rule.mode === 'cron') return rule.cron
  if (rule.mode === 'interval') return `*/${rule.minutes} * * * *`
  const [hour, minute] = rule.time.split(':').map(Number)
  return rule.mode === 'daily'
    ? `${minute} ${hour} * * *`
    : `${minute} ${hour} * * ${rule.weekday}`
}

/** `HH:MM` out of two capture groups, or null when either is missing. */
function timeOf(hour: string | undefined, minute: string | undefined): string | null {
  return hour === undefined || minute === undefined ? null : `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

/** Read one stored cron back into the editor's draft; unrecognized shapes open in advanced mode. */
function ruleOfCron(cron: string): RuleDraft {
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron)
  const dailyTime = daily === null ? null : timeOf(daily[2], daily[1])
  if (dailyTime !== null) return { mode: 'daily', time: dailyTime }
  const weekly = /^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/.exec(cron)
  const weeklyTime = weekly === null ? null : timeOf(weekly[2], weekly[1])
  if (weeklyTime !== null && weekly?.[3] !== undefined) {
    return { mode: 'weekly', weekday: Number(weekly[3]), time: weeklyTime }
  }
  const interval = /^\*\/(\d{1,3}) \* \* \* \*$/.exec(cron)
  if (interval?.[1] !== undefined) return { mode: 'interval', minutes: Number(interval[1]) }
  return { mode: 'cron', cron }
}

/** One schedule being edited; `id` null means a not-yet-saved new row (prompt kind) or a workspace-instruction row. */
interface EditorDraft {
  readonly id: string | null
  /** What this draft schedules: a prompt snapshot or a workspace instruction (ADR-0064). */
  kind: 'prompt' | 'instruction'
  /** Where the draft came from: only a brand-new draft may retype its 调度对象 —
      an opened row is what it is (a prompt schedule and an instruction rule
      live in different stores; retyping would be a lie, ADR-0064 决定 4). */
  origin: 'new' | 'prompt' | 'instruction'
  name: string
  prompt: string
  rule: RuleDraft
  enabled: boolean
  /** The optional capability binding (首跳直通)；'' = 不绑定. Prompt kind only. */
  capability: string
  /** Instruction kind only: the owning workspace (null until chosen). */
  workspaceId: string | null
  /** Instruction kind only: the scheduled instruction (null until chosen). */
  instructionId: string | null
}

/** A fresh schedule id — the browser twin of the kb store's `newScheduleId`. */
function newScheduleId(): string {
  const random = new Uint8Array(4)
  crypto.getRandomValues(random)
  return `sch_${Date.now().toString(36)}_${[...random].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

// formatStamp 已收编到 ./stamp.ts（P3-1 收敛，2026-10-12）——全工作台一个口径。

const FONT = 'var(--yt-font-ui)'

/** The code font (DESIGN.md §3): code fragments only — the cron string here. */
const CODE_FONT = 'var(--yt-font-code)'

const paneStyle = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
  background: 'var(--yt-surface-primary)',
} as const

const listColStyle = {
  width: 260,
  flexShrink: 0,
  borderRight: '1px solid var(--yt-border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
} as const

const listHeadStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--yt-space-2) var(--yt-space-3)',
  borderBottom: '1px solid var(--yt-border-subtle)',
} as const

const listBodyStyle = { flex: 1, overflowY: 'auto', padding: 'var(--yt-space-1)' } as const

const rowStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  padding: 'var(--yt-space-2)',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
  // 整行可点（2026-10-17 用户反馈）：10-14 的无障碍修复把选中入口收缩成
  // 名称文字一小块，行高的其余部分（cron/meta 行）点了没反应——鼠标用户
  // 几乎点不中。行恢复整行命中，键盘/读屏仍走名称钮。
  cursor: 'pointer',
} as const

const activeRowStyle = { ...rowStyle, background: 'var(--yt-accent-bg)', borderColor: 'var(--yt-accent-border)' } as const

/** 调度名称是打开编辑器的一等按钮（2026-10-14 impeccable P3 修复）：此前
    整行 role=button 里套着启用勾选框——按钮里嵌交互控件，读屏行为错乱。
    行降级为普通容器，名称独立成钮，勾选框并列。 */
const nameButtonStyle = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  fontWeight: 500,
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
} as const

const editColStyle = {
  flex: 1,
  minWidth: 0,
  overflowY: 'auto',
  padding: 'var(--yt-space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--yt-space-3)',
} as const

const fieldLabelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--yt-space-1)',
  fontSize: 'var(--yt-type-label)',
  color: 'var(--yt-text-muted)',
} as const

/** One muted evidence line (DESIGN.md §7: 从属证据独立成行). */
const metaLineStyle = {
  color: 'var(--yt-text-muted)',
  fontSize: 'var(--yt-type-label)',
  marginTop: 'var(--yt-space-1)',
} as const

const inputStyle = {
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-subtle)',
  borderRadius: 4,
  background: 'var(--yt-surface-raised)',
  color: 'inherit',
} as const

// 表单行的次级钮（新建 / 填入 / 取消）收敛到 ./buttons.ts 的 raised 面
// （P1-2 收敛，2026-10-12）——此前的私养版与 TodoBoard 的裸 UA 按钮一并退役。

/** 主行动钮（创建/保存）的实心 accent 面孔收敛到 ./buttons.ts —— 与裁决卡
    同一副面孔；accent-bg 淡底回归其文档角色：选中态。（2026-10-05） */


// 删除钮的幽灵装收敛到 ./buttons.ts 的 tool 面（P1-2 收敛，2026-10-12）——
// §7 的「无边框、透明底、muted 墨色」就是 tool 面的定义；武装态走共享
// toolButtonArmedStyle。

const missedBadgeStyle = {
  // 警告黄作文字在纸上只有 2.2:1；语义琥珀（--yt-warning-text）才过 AA。
  color: 'var(--yt-warning-text)',
  fontSize: 'var(--yt-type-label)',
} as const

/** A list section's muted heading (提示词调度 / 工作空间指令). */
const sectionHeadStyle = {
  padding: 'var(--yt-space-2) var(--yt-space-2) var(--yt-space-1)',
  color: 'var(--yt-text-muted)',
  fontSize: 'var(--yt-type-label)',
  fontWeight: 600,
} as const

/** The editor's inline error line (the narrow patch's refusal prose). */
const errorLineStyle = {
  color: 'var(--yt-error)',
  fontSize: 'var(--yt-type-label)',
} as const

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/**
 * Render the 调度 tab: definition list + editor.
 * @param props - see {@link SchedulePaneProps}.
 */
export function SchedulePane({
  schedules, onSave, promptShortcutList, capabilityNames, workspaces, onInstructionScheduleSave, onViewRunRecords,
}: SchedulePaneProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [busy, setBusy] = useState(false)
  // 删除的两击武装（2026-10-05 第三轮评审 P2#3；2026-10-12 起走共享
  // useArmedAction）：首击只进入确认态，再击才执行。换选中/关编辑器即解除。
  const { armedId: armedDeleteId, attempt: attemptDelete, disarm: disarmDelete } = useArmedAction()
  const [shortcuts, setShortcuts] = useState<readonly KbPromptShortcut[]>([])
  const [shortcutAlias, setShortcutAlias] = useState('')
  // 脏态基线（P2-2）：打开/保存时的草稿快照——此后每次换行、新建、取消
  // 先比对，有未保存修改就问一声，不再无声丢稿。
  const [snapshot, setSnapshot] = useState('')
  // 站内脏态确认（2026-10-12 评审 P2-2）：window.confirm 是系统级灰模态，
  // 撕裂暖纸语境——脏时先把续作存起来，人点「放弃修改」才放行。
  const [pendingAbandon, setPendingAbandon] = useState<(() => void) | null>(null)
  // 确认条出现即夺焦（复检 P1 补课）：alertdialog 不移焦点等于没宣告，
  // 默认落在「继续编辑」——Enter 的默认动作永远是非破坏的那一侧。
  const keepEditingRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (pendingAbandon !== null) keepEditingRef.current?.focus()
  }, [pendingAbandon])
  // 指令调度保存的内联报错（ADR-0064）：窄接口的拒绝理由（未知指令、坏
  // cron）就近贴在编辑器里，不静默。
  const [instructionError, setInstructionError] = useState<string | null>(null)

  // The 填入 source loads once with the pane; a missing store is an empty menu.
  useEffect(() => {
    let stale = false
    promptShortcutList().then(
      (result) => { if (!stale) setShortcuts(result.shortcuts) },
      () => { /* the menu stays empty — 填入 simply offers nothing */ },
    )
    return () => { stale = true }
  }, [promptShortcutList])

  /** 还有未保存修改吗？以打开/保存时刻的草稿快照为基线。 */
  const dirty = draft !== null && JSON.stringify(draft) !== snapshot

  // 确认条与脏态同步（2026-10-19 用户报告）：保存在途时点别的行，守卫按
  // 当时还脏的快照布下确认条；随后保存落定、快照刷新，草稿已干净——确认条
  // 却不会自己散去，像「点了没反应」。脏一旦解除（保存成功或手工改回），
  // 确认条随之蒸发，不再赖着等人裁决。
  useEffect(() => {
    if (pendingAbandon !== null && !dirty) setPendingAbandon(null)
  }, [pendingAbandon, dirty])

  /**
   * 脏态守卫（续作式）：干净就直接放行；脏则把续作暂存，渲染站内确认条，
   * 由人点「放弃修改」（放行）或「继续编辑」（撤销）裁决。
   */
  const abandonGuard = (proceed: () => void): void => {
    if (!dirty) { proceed(); return }
    setPendingAbandon(() => proceed)
  }

  /** 确认条的裁决动作：放行续作并收起确认条。 */
  const confirmAbandon = (): void => {
    const proceed = pendingAbandon
    setPendingAbandon(null)
    proceed?.()
  }

  const openEditor = (schedule: KbSchedule): void => {
    if (selectedId === schedule.id && draft !== null) return
    abandonGuard(() => {
      setSelectedId(schedule.id)
      disarmDelete()
      setInstructionError(null)
      const next: EditorDraft = {
        id: schedule.id,
        kind: 'prompt',
        origin: 'prompt',
        name: schedule.name,
        prompt: schedule.prompt,
        rule: ruleOfCron(schedule.cron),
        enabled: schedule.enabled,
        capability: schedule.capability ?? '',
        workspaceId: null,
        instructionId: null,
      }
      setDraft(next)
      setSnapshot(JSON.stringify(next))
    })
  }

  const openNew = (): void => {
    abandonGuard(() => {
      setSelectedId(null)
      disarmDelete()
      setInstructionError(null)
      const next: EditorDraft = { id: null, kind: 'prompt', origin: 'new', name: '', prompt: '', rule: { mode: 'daily', time: '09:00' }, enabled: true, capability: '', workspaceId: null, instructionId: null }
      setDraft(next)
      setSnapshot(JSON.stringify(next))
    })
  }

  /** ADR-0064: a brand-new draft picks its 调度对象 — switching resets the
      opposing fields but keeps the trigger rule and the enabled flag. Existing
      rows never switch: a prompt schedule and an instruction rule are
      different stores, and retyping one into the other would be a lie. */
  const switchDraftKind = (kind: 'prompt' | 'instruction'): void => {
    if (draft === null || draft.origin !== 'new' || draft.kind === kind) return
    setDraft({ ...draft, kind, name: '', prompt: '', capability: '', workspaceId: null, instructionId: null })
    setInstructionError(null)
  }

  /** The workspace instructions that carry a cron — the second list section. */
  const instructionRows = useMemo(() => workspaces.flatMap(space => space.instructions
    .filter(instruction => instruction.cron !== undefined)
    .map(instruction => ({ space, instruction }))), [workspaces])

  /** A list row's composite key for an instruction schedule. */
  const instructionRowId = (spaceId: string, instructionId: string): string => `ws:${spaceId}:${instructionId}`

  /** Open one workspace instruction's rule in the editor (ADR-0064). */
  const openInstructionEditor = (space: KbWorkspace, instruction: KbWorkspace['instructions'][number]): void => {
    const key = instructionRowId(space.id, instruction.id)
    if (selectedId === key && draft !== null) return
    abandonGuard(() => {
      setSelectedId(key)
      disarmDelete()
      setInstructionError(null)
      const next: EditorDraft = {
        id: null,
        kind: 'instruction',
        origin: 'instruction',
        name: instruction.name,
        prompt: '',
        rule: ruleOfCron(instruction.cron ?? ''),
        enabled: instruction.enabled,
        capability: '',
        workspaceId: space.id,
        instructionId: instruction.id,
      }
      setDraft(next)
      setSnapshot(JSON.stringify(next))
    })
  }

  const fillShortcut = (): void => {
    const shortcut = shortcuts.find(entry => entry.alias === shortcutAlias)
    // Snapshot semantics (ADR-0045 决定 5): the text is copied in; later
    // edits to the shortcut never reach this schedule.
    if (shortcut !== undefined && draft !== null) setDraft({ ...draft, prompt: shortcut.text })
  }

  const saveDraft = async (): Promise<void> => {
    if (draft === null || busy) return
    setBusy(true)
    try {
      const cron = cronOfRule(draft.rule)
      // ADR-0064: an instruction draft saves through the narrow patch, not
      // the prompt store — its cron lives on the instruction itself.
      if (draft.kind === 'instruction') {
        if (draft.workspaceId === null || draft.instructionId === null) return
        const failure = await onInstructionScheduleSave({
          workspaceId: draft.workspaceId,
          instructionId: draft.instructionId,
          cron,
          enabled: draft.enabled,
        })
        if (failure === null) {
          setInstructionError(null)
          // 新建成功后高亮列表里对应的指令行（组合键与列表一致）。
          setSelectedId(instructionRowId(draft.workspaceId, draft.instructionId))
          setSnapshot(JSON.stringify(draft))
        } else {
          setInstructionError(failure)
        }
        return
      }
      if (draft.id === null) {
        const created: KbSchedule = {
          id: newScheduleId(),
          name: draft.name,
          prompt: draft.prompt,
          cron,
          enabled: draft.enabled,
          ...(draft.capability !== '' ? { capability: draft.capability } : {}),
        }
        if (await onSave([...schedules, created])) {
          setSelectedId(created.id)
          const saved = { ...draft, id: created.id }
          setDraft(saved)
          setSnapshot(JSON.stringify(saved))
        }
      } else {
        // Rebuilt field-by-field rather than spread over the old row: an
        // editor cleared back to 不绑定 must actually drop the stored
        // binding, which a `{ ...row }` spread would silently keep.
        const next = schedules.map(row => row.id === draft.id
          ? {
            id: row.id,
            name: draft.name,
            prompt: draft.prompt,
            cron,
            enabled: draft.enabled,
            ...(row.lastFiredAt !== undefined ? { lastFiredAt: row.lastFiredAt } : {}),
            ...(row.lastMissedAt !== undefined ? { lastMissedAt: row.lastMissedAt } : {}),
            ...(draft.capability !== '' ? { capability: draft.capability } : {}),
          }
          : row)
        if (await onSave(next)) {
          setDraft({ ...draft })
          setSnapshot(JSON.stringify(draft))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const removeDraft = async (): Promise<void> => {
    if (draft?.id === null || draft === null || busy) return
    setBusy(true)
    try {
      if (await onSave(schedules.filter(row => row.id !== draft.id))) {
        setDraft(null)
        setSelectedId(null)
      }
    } finally {
      setBusy(false)
      disarmDelete()
    }
  }

  const toggleEnabled = async (schedule: KbSchedule): Promise<void> => {
    await onSave(schedules.map(row => row.id === schedule.id ? { ...row, enabled: !row.enabled } : row))
  }

  /** Toggle one instruction schedule's enabled flag through the narrow patch (ADR-0064). */
  const toggleInstructionEnabled = async (space: KbWorkspace, instruction: KbWorkspace['instructions'][number]): Promise<void> => {
    const failure = await onInstructionScheduleSave({
      workspaceId: space.id,
      instructionId: instruction.id,
      cron: instruction.cron ?? null,
      enabled: !instruction.enabled,
    })
    if (failure !== null) setInstructionError(failure)
  }

  /**
   * 「清除定时」(ADR-0064): an instruction schedule's destructive gesture
   * clears the rule — the instruction itself survives, manual-only again.
   * The instruction's life cycle stays the workspace panel's business.
   */
  const clearInstructionSchedule = async (): Promise<void> => {
    if (draft === null || draft.kind !== 'instruction' || busy) return
    if (draft.workspaceId === null || draft.instructionId === null) return
    setBusy(true)
    try {
      const failure = await onInstructionScheduleSave({
        workspaceId: draft.workspaceId,
        instructionId: draft.instructionId,
        cron: null,
        enabled: draft.enabled,
      })
      if (failure === null) {
        setDraft(null)
        setSelectedId(null)
        setInstructionError(null)
      } else {
        setInstructionError(failure)
      }
    } finally {
      setBusy(false)
      disarmDelete()
    }
  }

  const ruleDraft = draft?.rule ?? null
  const draftCron = useMemo(() => (ruleDraft === null ? '' : cronOfRule(ruleDraft)), [ruleDraft])
  const draftNext = draftCron === '' ? null : cronNextFire(draftCron, new Date())

  return (
    <div style={paneStyle} data-schedule-pane="true">
      <div style={listColStyle}>
        <div style={listHeadStyle}>
          <span>调度定义</span>
          <button data-hover="true" type="button" style={raisedButtonStyle} onClick={openNew}>+ 新建</button>
        </div>
        <div style={listBodyStyle}>
          {schedules.length === 0 && instructionRows.length === 0 && (
            <div style={{ padding: 'var(--yt-space-2)', color: 'var(--yt-text-muted)' }}>还没有调度。新建一条，到点自动在后台跑一段提示词；也可以把工作空间指令挂上定时。</div>
          )}
          {schedules.length > 0 && <div style={sectionHeadStyle}>提示词调度</div>}
          {schedules.map((schedule) => {
            const next = cronNextFire(schedule.cron, new Date())
            return (
              <div
                key={schedule.id}
                style={selectedId === schedule.id ? activeRowStyle : rowStyle}
                data-schedule-row={schedule.id}
                onClick={() => { openEditor(schedule) }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-space-2)' }}>
                  <input
                    type="checkbox"
                    checked={schedule.enabled}
                    title={schedule.enabled ? '停用' : '启用'}
                    aria-label={schedule.enabled ? `停用 ${schedule.name}` : `启用 ${schedule.name}`}
                    // 勾选框只管启停：点击不冒泡到行（否则切换启用会顺带打开编辑器）。
                    onClick={(event) => { event.stopPropagation() }}
                    onChange={() => { void toggleEnabled(schedule) }}
                  />
                  {/* 选中行里的名称钮带 data-selected：悬停豁免通用涂灰规则，
                      保持 accent 洗染（theme-presenter 的按钮豁免链）。 */}
                  <button
                    type="button"
                    data-hover="true"
                    data-selected={selectedId === schedule.id || undefined}
                    style={nameButtonStyle}
                    onClick={(event) => { event.stopPropagation(); openEditor(schedule) }}
                  >
                    {schedule.name}
                  </button>
                </div>
                <div style={{ ...metaLineStyle, fontFamily: CODE_FONT }}>{schedule.cron}</div>
                {schedule.capability !== undefined && schedule.capability !== '' && (
                  <div style={metaLineStyle}>绑定能力 {schedule.capability}</div>
                )}
                <div style={metaLineStyle}>{next !== null ? `下次触发 ${formatStamp(next.toISOString())}` : '永不触发'}</div>
                {schedule.lastFiredAt !== undefined && <div style={metaLineStyle}>上次触发 {formatStamp(schedule.lastFiredAt)}</div>}
                {schedule.lastMissedAt !== undefined && (
                  <div style={{ ...metaLineStyle, ...missedBadgeStyle }}>上次错过 {formatStamp(schedule.lastMissedAt)}（应用未在运行，不补跑）</div>
                )}
              </div>
            )
          })}
          {instructionRows.length > 0 && <div style={sectionHeadStyle}>工作空间指令</div>}
          {instructionRows.map(({ space, instruction }) => {
            const rowId = instructionRowId(space.id, instruction.id)
            const next = cronNextFire(instruction.cron ?? '', new Date())
            return (
              <div
                key={rowId}
                style={selectedId === rowId ? activeRowStyle : rowStyle}
                data-schedule-instruction-row={rowId}
                onClick={() => { openInstructionEditor(space, instruction) }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-space-2)' }}>
                  <input
                    type="checkbox"
                    checked={instruction.enabled}
                    title={instruction.enabled ? '停用' : '启用'}
                    aria-label={instruction.enabled ? `停用 ${instruction.name}` : `启用 ${instruction.name}`}
                    onClick={(event) => { event.stopPropagation() }}
                    onChange={() => { void toggleInstructionEnabled(space, instruction) }}
                  />
                  <button
                    type="button"
                    data-hover="true"
                    data-selected={selectedId === rowId || undefined}
                    style={nameButtonStyle}
                    onClick={(event) => { event.stopPropagation(); openInstructionEditor(space, instruction) }}
                  >
                    {instruction.name}
                  </button>
                </div>
                <div style={{ ...metaLineStyle, fontFamily: CODE_FONT }}>{instruction.cron}</div>
                <div style={metaLineStyle}>工作空间 {space.name}</div>
                <div style={metaLineStyle}>{next !== null ? `下次触发 ${formatStamp(next.toISOString())}` : '永不触发'}</div>
                {instruction.lastFiredAt !== undefined && <div style={metaLineStyle}>上次触发 {formatStamp(instruction.lastFiredAt)}</div>}
                {instruction.lastMissedAt !== undefined && (
                  <div style={{ ...metaLineStyle, ...missedBadgeStyle }}>上次错过 {formatStamp(instruction.lastMissedAt)}（不补跑）</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div style={editColStyle}>
        {draft === null ? (
          <div style={{ color: 'var(--yt-text-muted)' }}>选中左侧一条调度进行编辑，或新建一条。</div>
        ) : (
          <>
            {pendingAbandon !== null && (
              <div
                role="alertdialog"
                aria-label="未保存修改确认"
                tabIndex={-1}
                style={{
                  // sticky 钉顶（复检 P1）：确认条原先插在可滚动列的顶部，
                  // 编辑器下滚后点别的行，守卫在视口外——像「点了没反应」。
                  // 负外边距抵消列内边距，钉住时警示带横贯整栏、贴住顶缘。
                  position: 'sticky', top: 0, zIndex: 1,
                  margin: 'calc(-1 * var(--yt-space-4)) calc(-1 * var(--yt-space-4)) 0',
                  padding: 'var(--yt-space-2) var(--yt-space-4)',
                  display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'center', flexWrap: 'wrap',
                  background: 'var(--yt-warning-bg)', color: 'var(--yt-warning-text)',
                  borderBottom: '1px solid var(--yt-warning)',
                }}
              >
                <span>当前调度还没保存，放弃这些修改？</span>
                <button data-hover="true" type="button" style={raisedButtonStyle} onClick={confirmAbandon}>放弃修改</button>
                <button ref={keepEditingRef} data-hover="true" type="button" style={ghostButtonStyle} onClick={() => { setPendingAbandon(null) }}>继续编辑</button>
              </div>
            )}
            {draft.origin === 'new' && (
              <div style={{ display: 'flex', gap: 'var(--yt-space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={metaLineStyle}>调度对象</span>
                <label style={{ display: 'flex', gap: 'var(--yt-space-1)', alignItems: 'center' }}>
                  <input type="radio" name="schedule-kind" checked={draft.kind === 'prompt'} onChange={() => { switchDraftKind('prompt') }} />
                  提示词
                </label>
                <label style={{ display: 'flex', gap: 'var(--yt-space-1)', alignItems: 'center' }}>
                  <input type="radio" name="schedule-kind" checked={draft.kind === 'instruction'} onChange={() => { switchDraftKind('instruction') }} />
                  工作空间指令
                </label>
              </div>
            )}
            {draft.kind === 'prompt' && (
              <label style={fieldLabelStyle}>
                名称
                <input style={inputStyle} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} />
              </label>
            )}
            {draft.kind === 'instruction' && draft.name !== '' && (
              <div style={metaLineStyle}>调度对象：工作空间指令「{draft.name}」</div>
            )}
            {draft.kind === 'instruction' && (
              <label style={fieldLabelStyle}>
                工作空间
                <select
                  style={inputStyle}
                  value={draft.workspaceId ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft({ ...draft, workspaceId: event.target.value === '' ? null : event.target.value, instructionId: null })
                  }}
                >
                  <option value="">选择工作空间…</option>
                  {workspaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
                </select>
              </label>
            )}
            {draft.kind === 'instruction' && (() => {
              const space = workspaces.find(candidate => candidate.id === draft.workspaceId) ?? null
              return (
                <label style={fieldLabelStyle}>
                  指令
                  <select
                    style={inputStyle}
                    value={draft.instructionId ?? ''}
                    disabled={busy || space === null}
                    onChange={(event) => {
                      const picked = space?.instructions.find(candidate => candidate.id === event.target.value)
                      setDraft(picked === undefined
                        ? { ...draft, instructionId: null }
                        : {
                          ...draft,
                          instructionId: picked.id,
                          name: picked.name,
                          rule: ruleOfCron(picked.cron ?? ''),
                          enabled: picked.enabled,
                        })
                    }}
                  >
                    <option value="">选择指令…</option>
                    {(space?.instructions ?? []).map(instruction => (
                      <option key={instruction.id} value={instruction.id}>{instruction.name}</option>
                    ))}
                  </select>
                  <div style={metaLineStyle}>指令本体（步骤链）在「工作空间」里维护，这里只定到点怎么触发。</div>
                </label>
              )
            })()}
            {draft.kind === 'instruction' && instructionError !== null && (
              <div style={errorLineStyle} role="alert">{instructionError}</div>
            )}
            {draft.kind === 'prompt' && (
              <>
                <label style={fieldLabelStyle}>
                  提示词
                  <textarea
                    style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
                    value={draft.prompt}
                    onChange={(event) => { setDraft({ ...draft, prompt: event.target.value }) }}
                  />
                </label>
                <div style={metaLineStyle}>到点作为独立后台会话运行。</div>
                <div style={{ display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'center' }}>
                  <select
                    style={{ ...inputStyle, width: 180 }}
                    value={shortcutAlias}
                    title={shortcutAlias}
                    onChange={(event) => { setShortcutAlias(event.target.value) }}
                  >
                    <option value="">选择惯用提示词…</option>
                    {shortcuts.map(shortcut => <option key={shortcut.alias} value={shortcut.alias}>/{shortcut.alias}</option>)}
                  </select>
                  <button data-hover="true" type="button" style={raisedButtonStyle} disabled={shortcutAlias === ''} onClick={fillShortcut}>
                    从惯用提示词填入
                  </button>
                </div>
                <div style={metaLineStyle}>填入是拷贝快照：之后改惯用提示词不影响本条调度。</div>
                <label style={fieldLabelStyle}>
                  绑定能力（可选）
                  <select
                    style={inputStyle}
                    value={draft.capability}
                    onChange={(event) => { setDraft({ ...draft, capability: event.target.value }) }}
                  >
                    <option value="">不绑定</option>
                    {capabilityNames.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <div style={metaLineStyle}>绑定后触发时会把该能力的指令正文直接附在提示词前（首跳直通），agent 不必再花一轮读取能力。</div>
                </label>
              </>
            )}
            <div style={fieldLabelStyle}>
              触发规则
              <div style={{ display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  style={inputStyle}
                  value={draft.rule.mode}
                  onChange={(event) => {
                    const mode = event.target.value as RuleDraft['mode']
                    const cron = cronOfRule(draft.rule)
                    setDraft({
                      ...draft,
                      rule: mode === 'daily' ? { mode, time: '09:00' }
                        : mode === 'weekly' ? { mode, weekday: 1, time: '09:00' }
                          : mode === 'interval' ? { mode, minutes: 30 }
                            : { mode, cron },
                    })
                  }}
                >
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                  <option value="interval">每隔 N 分钟</option>
                  <option value="cron">高级（cron）</option>
                </select>
                {(draft.rule.mode === 'daily' || draft.rule.mode === 'weekly') && (
                  <>
                    {draft.rule.mode === 'weekly' && (
                      <select
                        style={inputStyle}
                        value={draft.rule.weekday}
                        onChange={(event) => {
                          setDraft({ ...draft, rule: { ...draft.rule, weekday: Number(event.target.value) } as RuleDraft })
                        }}
                      >
                        {WEEKDAY_NAMES.map((name, day) => <option key={day} value={day}>{name}</option>)}
                      </select>
                    )}
                    <input
                      type="time"
                      style={inputStyle}
                      value={'time' in draft.rule ? draft.rule.time : '09:00'}
                      onChange={(event) => { setDraft({ ...draft, rule: { ...draft.rule, time: event.target.value } as RuleDraft }) }}
                    />
                  </>
                )}
                {draft.rule.mode === 'interval' && (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      style={{ ...inputStyle, width: 72 }}
                      value={draft.rule.minutes}
                      onChange={(event) => {
                        setDraft({ ...draft, rule: { mode: 'interval', minutes: Math.min(60, Math.max(1, Number(event.target.value) || 1)) } })
                      }}
                    />
                    <span>分钟</span>
                  </>
                )}
                {draft.rule.mode === 'cron' && (
                  <input
                    style={{ ...inputStyle, width: 220, fontFamily: CODE_FONT }}
                    value={draft.rule.cron}
                    placeholder="分 时 日 月 周，如 0 9 * * 1-5"
                    onChange={(event) => { setDraft({ ...draft, rule: { mode: 'cron', cron: event.target.value } }) }}
                  />
                )}
              </div>
              <div style={metaLineStyle}>
                存储为 cron：<span style={{ fontFamily: CODE_FONT }}>{draftCron}</span>
              </div>
              {draftNext !== null && <div style={metaLineStyle}>下次触发 {formatStamp(draftNext.toISOString())}</div>}
              {draft.rule.mode === 'interval' && <div style={metaLineStyle}>超过 60 分钟请用高级 cron，分钟字段放不下更大的步进。</div>}
            </div>
            <div>
              <label style={{ display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => { setDraft({ ...draft, enabled: event.target.checked }) }}
                />
                启用
              </label>
              <div style={metaLineStyle}>停用的调度保留在列表里但不触发。</div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              {draft.kind === 'prompt' ? (
                <>
                  <button type="button" style={primaryButtonStyle} data-hover="primary" disabled={busy || draft.name.trim() === '' || draft.prompt.trim() === ''} onClick={() => { void saveDraft() }}>
                    {draft.id === null ? '创建' : '保存'}
                  </button>
                  <button data-hover="true" type="button" style={raisedButtonStyle} disabled={busy} onClick={() => { abandonGuard(() => { setDraft(null); setSelectedId(null); disarmDelete() }) }}>
                    取消
                  </button>
                  {draft.id !== null && (
                    <button data-hover="true"
                      type="button"
                      style={armedDeleteId === draft.id ? toolButtonArmedStyle : toolButtonStyle}
                      disabled={busy}
                      data-armed={(draft.id !== null && armedDeleteId === draft.id) || undefined}
                      title="删除这条调度，不可恢复"
                      onClick={() => {
                        if (draft.id === null) return
                        attemptDelete(draft.id, () => { void removeDraft() })
                      }}
                    >
                      {armedDeleteId === draft.id ? '确认删除？' : '删除'}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button type="button" style={primaryButtonStyle} data-hover="primary"
                    disabled={busy || draft.workspaceId === null || draft.instructionId === null}
                    onClick={() => { void saveDraft() }}>
                    保存
                  </button>
                  <button data-hover="true" type="button" style={raisedButtonStyle} disabled={busy} onClick={() => { abandonGuard(() => { setDraft(null); setSelectedId(null); disarmDelete() }) }}>
                    取消
                  </button>
                  <button data-hover="true"
                    type="button"
                    style={armedDeleteId === 'clear' ? toolButtonArmedStyle : toolButtonStyle}
                    disabled={busy || draft.workspaceId === null || draft.instructionId === null}
                    data-armed={armedDeleteId === 'clear' || undefined}
                    title="清除这条指令的定时，指令本身保留、回到仅手动"
                    onClick={() => { attemptDelete('clear', () => { void clearInstructionSchedule() }) }}
                  >
                    {armedDeleteId === 'clear' ? '确认清除？' : '清除定时'}
                  </button>
                  <button data-hover="true" type="button" style={raisedButtonStyle}
                    disabled={draft.workspaceId === null || draft.instructionId === null}
                    title="到「工作空间」页看这条指令的运行记录"
                    onClick={() => { onViewRunRecords() }}>
                    查看运行记录
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
