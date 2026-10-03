/**
 * The 调度 tab's pane (ADR-0045 决定 8): the definition list on the left, the
 * editor on the right. Definitions are the human's alone — this pane is the
 * store's only writer (决定 4); run instances never appear here, they live in
 * the 任务 tab (决定 1). The trigger rule edits through simple options
 * (每天 / 每周 / 每隔 N 分钟) that merely generate the stored cron string,
 * with an advanced mode that types the cron directly (决定 6); the prompt
 * field's 「从惯用提示词填入」 copies a snapshot, never a reference (决定 5).
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { KbPromptShortcut, KbSchedule } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { cronNextFire } from './cron.ts'
import type { PromptShortcutLister } from './remote.ts'

/** The pane's props: the store's rows, the save seam, and the shortcut source. */
export interface SchedulePaneProps {
  /** The store's definitions in display order. */
  readonly schedules: readonly KbSchedule[]
  /** Replace the whole list; resolves true when the host accepted it. */
  readonly onSave: (next: readonly KbSchedule[]) => Promise<boolean>
  /** The 惯用提示词 loader — the editor's 填入 source (ADR-0040). */
  readonly promptShortcutList: PromptShortcutLister
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
}

/** A fresh schedule id — the browser twin of the kb store's `newScheduleId`. */
function newScheduleId(): string {
  const random = new Uint8Array(4)
  crypto.getRandomValues(random)
  return `sch_${Date.now().toString(36)}_${[...random].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/** Format one ISO stamp for the list's metadata line. */
function formatStamp(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getMonth() + 1}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

const paneStyle = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  fontFamily: FONT,
  fontSize: 13,
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
  padding: '8px 10px',
  borderBottom: '1px solid var(--yt-border-subtle)',
} as const

const listBodyStyle = { flex: 1, overflowY: 'auto', padding: 4 } as const

const rowStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  padding: '6px 8px',
  fontFamily: FONT,
  fontSize: 13,
} as const

const activeRowStyle = { ...rowStyle, background: 'var(--yt-accent-bg)', borderColor: 'var(--yt-accent-border)' } as const

const editColStyle = { flex: 1, minWidth: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 } as const

const fieldLabelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--yt-type-label)', color: 'var(--yt-text-muted)' } as const

const inputStyle = {
  fontFamily: FONT,
  fontSize: 13,
  padding: '4px 8px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-subtle)',
  borderRadius: 4,
  background: 'var(--yt-surface-raised)',
  color: 'inherit',
} as const

const buttonStyle = {
  fontFamily: FONT,
  fontSize: 13,
  padding: '4px 12px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-subtle)',
  borderRadius: 4,
  background: 'var(--yt-surface-raised)',
  color: 'inherit',
  cursor: 'pointer',
} as const

const primaryButtonStyle = { ...buttonStyle, background: 'var(--yt-accent-bg)', borderColor: 'var(--yt-accent-border)' } as const

const missedBadgeStyle = {
  color: 'var(--yt-warning)',
  fontSize: 'var(--yt-type-label)',
} as const

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/**
 * Render the 调度 tab: definition list + editor.
 * @param props - see {@link SchedulePaneProps}.
 */
export function SchedulePane({ schedules, onSave, promptShortcutList }: SchedulePaneProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [shortcuts, setShortcuts] = useState<readonly KbPromptShortcut[]>([])
  const [shortcutAlias, setShortcutAlias] = useState('')

  // The 填入 source loads once with the pane; a missing store is an empty menu.
  useEffect(() => {
    let stale = false
    promptShortcutList().then(
      (result) => { if (!stale) setShortcuts(result.shortcuts) },
      () => { /* the menu stays empty — 填入 simply offers nothing */ },
    )
    return () => { stale = true }
  }, [promptShortcutList])

  const openEditor = (schedule: KbSchedule): void => {
    setSelectedId(schedule.id)
    setDraft({ id: schedule.id, name: schedule.name, prompt: schedule.prompt, rule: ruleOfCron(schedule.cron), enabled: schedule.enabled })
  }

  const openNew = (): void => {
    setSelectedId(null)
    setDraft({ id: null, name: '', prompt: '', rule: { mode: 'daily', time: '09:00' }, enabled: true })
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
        const created: KbSchedule = { id: newScheduleId(), name: draft.name, prompt: draft.prompt, cron, enabled: draft.enabled }
        if (await onSave([...schedules, created])) {
          setSelectedId(created.id)
          setDraft({ ...draft, id: created.id })
        }
      } else {
        const next = schedules.map(row => row.id === draft.id
          ? { ...row, name: draft.name, prompt: draft.prompt, cron, enabled: draft.enabled }
          : row)
        if (await onSave(next)) setDraft({ ...draft })
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
          <button type="button" style={buttonStyle} onClick={openNew}>+ 新建</button>
        </div>
        <div style={listBodyStyle}>
          {schedules.length === 0 && <div style={{ padding: 8, color: 'var(--yt-text-muted)' }}>还没有调度。新建一条，到点自动在后台跑一段提示词。</div>}
          {schedules.map((schedule) => {
            const next = cronNextFire(schedule.cron, new Date())
            return (
              <button
                key={schedule.id}
                type="button"
                style={selectedId === schedule.id ? activeRowStyle : rowStyle}
                data-schedule-row={schedule.id}
                onClick={() => { openEditor(schedule) }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={schedule.enabled}
                    title={schedule.enabled ? '停用' : '启用'}
                    onClick={(event) => { event.stopPropagation() }}
                    onChange={() => { void toggleEnabled(schedule) }}
                  />
                  <span style={{ fontWeight: 500 }}>{schedule.name}</span>
                </div>
                <div style={{ color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)', marginTop: 2 }}>
                  {schedule.cron}{next !== null ? ` · 下次 ${formatStamp(next.toISOString())}` : ' · 永不触发'}
                </div>
                <div style={{ fontSize: 'var(--yt-type-label)', marginTop: 2, display: 'flex', gap: 8 }}>
                  {schedule.lastFiredAt !== undefined && <span style={{ color: 'var(--yt-text-muted)' }}>上次触发 {formatStamp(schedule.lastFiredAt)}</span>}
                  {schedule.lastMissedAt !== undefined && (
                    <span style={missedBadgeStyle} title="应用未在运行时错过的触发，按裁决不补跑">
                      上次错过 {formatStamp(schedule.lastMissedAt)}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div style={editColStyle}>
        {draft === null ? (
          <div style={{ color: 'var(--yt-text-muted)' }}>选中左侧一条调度进行编辑，或新建一条。</div>
        ) : (
          <>
            <label style={fieldLabelStyle}>
              名称
              <input style={inputStyle} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} />
            </label>
            <label style={fieldLabelStyle}>
              提示词（到点作为独立后台会话运行）
              <textarea
                style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
                value={draft.prompt}
                onChange={(event) => { setDraft({ ...draft, prompt: event.target.value }) }}
              />
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select style={inputStyle} value={shortcutAlias} onChange={(event) => { setShortcutAlias(event.target.value) }}>
                <option value="">选择惯用提示词…</option>
                {shortcuts.map(shortcut => <option key={shortcut.alias} value={shortcut.alias}>/{shortcut.alias}</option>)}
              </select>
              <button type="button" style={buttonStyle} disabled={shortcutAlias === ''} onClick={fillShortcut}>
                从惯用提示词填入
              </button>
              <span style={{ color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)' }}>拷贝快照，之后改惯用提示词不影响本条</span>
            </div>
            <div style={fieldLabelStyle}>
              触发规则
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
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
                    <span>分钟（超过 60 分钟请用高级 cron，分钟字段放不下更大的步进）</span>
                  </>
                )}
                {draft.rule.mode === 'cron' && (
                  <input
                    style={{ ...inputStyle, width: 220 }}
                    value={draft.rule.cron}
                    placeholder="分 时 日 月 周，如 0 9 * * 1-5"
                    onChange={(event) => { setDraft({ ...draft, rule: { mode: 'cron', cron: event.target.value } }) }}
                  />
                )}
              </div>
              <div style={{ color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)' }}>
                存储为 cron：{draftCron}{draftNext !== null ? ` · 下次触发 ${formatStamp(draftNext.toISOString())}` : ''}
              </div>
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => { setDraft({ ...draft, enabled: event.target.checked }) }}
              />
              启用（停用的调度保留在列表里但不触发）
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={primaryButtonStyle} disabled={busy || draft.name.trim() === '' || draft.prompt.trim() === ''} onClick={() => { void saveDraft() }}>
                {draft.id === null ? '创建' : '保存'}
              </button>
              {draft.id !== null && (
                <button type="button" style={{ ...buttonStyle, color: 'var(--yt-error)' }} disabled={busy} onClick={() => { void removeDraft() }}>
                  删除
                </button>
              )}
              <button type="button" style={buttonStyle} disabled={busy} onClick={() => { setDraft(null); setSelectedId(null) }}>
                取消
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
