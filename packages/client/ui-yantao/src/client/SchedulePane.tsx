/**
 * The 调度 tab's pane (ADR-0045 决定 8): the definition list on the left, the
 * editor on the right. Definitions are the human's alone — this pane is the
 * store's only writer (决定 4); run instances never appear here, they live in
 * the 任务 tab (决定 1). The trigger rule edits through simple options
 * (每天 / 每周 / 每隔 N 分钟) that merely generate the stored cron string,
 * with an advanced mode that types the cron directly (决定 6); the prompt
 * field's 「从惯用提示词填入」 copies a snapshot, never a reference (决定 5).
 *
 * Design discipline (apps/yantao/DESIGN.md): colors and metrics ride the
 * `--yt-*` tokens; the cron is a code fragment and wears the code font;
 * evidence (下次触发/上次触发/上次错过) owns its own muted line — never a
 * ` · ` tail; the destructive 删除 arms through a two-click tool button; the
 * dirty-editor guard is an in-pane confirm strip, never window.confirm.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { KbPromptShortcut, KbSchedule } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { cronNextFire } from './cron.ts'
import { ghostButtonStyle, primaryButtonStyle, raisedButtonStyle, toolButtonArmedStyle, toolButtonStyle } from './buttons.ts'
import { useArmedAction } from './use-armed-action.ts'
import { formatStamp } from './stamp.ts'
import type { PromptShortcutLister } from './remote.ts'

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

/** One schedule being edited; `id` null means a not-yet-saved new row. */
interface EditorDraft {
  readonly id: string | null
  name: string
  prompt: string
  rule: RuleDraft
  enabled: boolean
  /** The optional capability binding (首跳直通)；'' = 不绑定. */
  capability: string
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

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/**
 * Render the 调度 tab: definition list + editor.
 * @param props - see {@link SchedulePaneProps}.
 */
export function SchedulePane({ schedules, onSave, promptShortcutList, capabilityNames }: SchedulePaneProps): ReactElement {
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
  // 撕裂暖纸语境——dirty 时先把续作存起来，人点「放弃修改」才放行。
  const [pendingAbandon, setPendingAbandon] = useState<(() => void) | null>(null)
  // 确认条出现即夺焦（复检 P1 补课）：alertdialog 不移焦点等于没宣告，
  // 默认落在「继续编辑」——Enter 的默认动作永远是非破坏的那一侧。
  const keepEditingRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (pendingAbandon !== null) keepEditingRef.current?.focus()
  }, [pendingAbandon])

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
      const next: EditorDraft = {
        id: schedule.id,
        name: schedule.name,
        prompt: schedule.prompt,
        rule: ruleOfCron(schedule.cron),
        enabled: schedule.enabled,
        capability: schedule.capability ?? '',
      }
      setDraft(next)
      setSnapshot(JSON.stringify(next))
    })
  }

  const openNew = (): void => {
    abandonGuard(() => {
      setSelectedId(null)
      disarmDelete()
      const next: EditorDraft = { id: null, name: '', prompt: '', rule: { mode: 'daily', time: '09:00' }, enabled: true, capability: '' }
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
          {schedules.length === 0 && (
            <div style={{ padding: 'var(--yt-space-2)', color: 'var(--yt-text-muted)' }}>还没有调度。新建一条，到点自动在后台跑一段提示词。</div>
          )}
          {schedules.map((schedule) => {
            const next = cronNextFire(schedule.cron, new Date())
            return (
              <div
                key={schedule.id}
                style={selectedId === schedule.id ? activeRowStyle : rowStyle}
                data-schedule-row={schedule.id}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-space-2)' }}>
                  <input
                    type="checkbox"
                    checked={schedule.enabled}
                    title={schedule.enabled ? '停用' : '启用'}
                    aria-label={schedule.enabled ? `停用 ${schedule.name}` : `启用 ${schedule.name}`}
                    onChange={() => { void toggleEnabled(schedule) }}
                  />
                  {/* 选中行里的名称钮带 data-selected：悬停豁免通用涂灰规则，
                      保持 accent 洗染（theme-presenter 的按钮豁免链）。 */}
                  <button
                    type="button"
                    data-hover="true"
                    data-selected={selectedId === schedule.id || undefined}
                    style={nameButtonStyle}
                    onClick={() => { openEditor(schedule) }}
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
            <label style={fieldLabelStyle}>
              名称
              <input style={inputStyle} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} />
            </label>
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
            <div style={{ display: 'flex', gap: 'var(--yt-space-2)', alignItems: 'center' }}>
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
            </div>
          </>
        )}
      </div>
    </div>
  )
}
