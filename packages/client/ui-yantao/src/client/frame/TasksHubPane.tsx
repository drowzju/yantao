/**
 * The 任务 tab's assembled body (ADR-0057; 修订 2026-10-11: the three-region
 * composite proved cramped, so the body became a sub-tab shell like the
 * 洞察 tab's — 任务 / 提议 / 调度 as mutually-exclusive sub-pages). Unlike
 * the 洞察 shell the three panes stay MOUNTED and only toggle `display`:
 * SchedulePane's editor draft and InboxPane's open card must survive a
 * sub-switch, the same render-once bargain the centre tabs strike. The
 * sub-choice lives in component state — remembered within the session,
 * never persisted — and defaults to 任务.
 *
 * Pure layout: no data, no verbs, no i18n (the panes skip it too).
 */
import { useState, type ReactElement, type ReactNode } from 'react'

export interface TasksHubPaneProps {
  /** The 任务 sub-page: the task list (with the 详情 drawer's overlay seat). */
  readonly tasks: ReactNode
  /** The 提议 sub-page: the inbox rows. */
  readonly inbox: ReactNode
  /** The 调度 sub-page: the definitions-plus-editor pane. */
  readonly schedule: ReactNode
}

/** The three sub-pages, in strip order. */
type TasksSub = 'tasks' | 'inbox' | 'schedule'

const SUB_LABELS: Record<TasksSub, string> = {
  tasks: '任务',
  inbox: '提议',
  schedule: '调度',
}

const subButtonStyle = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'var(--yt-font-ui)',
  fontSize: 12,
  padding: '2px 10px',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  color: 'var(--yt-text-secondary)',
} as const

const activeSubButtonStyle = {
  ...subButtonStyle,
  background: 'var(--yt-surface-raised)',
  borderColor: 'var(--yt-border-subtle)',
  color: 'inherit',
} as const

const hubStyle = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'var(--yt-font-ui)',
  fontSize: 'var(--yt-type-body)',
} as const

const pageStyle = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
} as const

export function TasksHubPane({ tasks, inbox, schedule }: TasksHubPaneProps): ReactElement {
  // Remembered for the session only: switching centre tabs hides the pane but
  // never unmounts it, so the choice survives the round trip.
  const [sub, setSub] = useState<TasksSub>('tasks')
  return (
    <div style={hubStyle} data-tasks-hub="true" data-tasks-sub={sub}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px 0', flexShrink: 0 }}>
        {(Object.keys(SUB_LABELS) as TasksSub[]).map(key => (
          <button
            key={key}
            type="button"
            data-hover="tab"
            data-tasks-sub-button={key}
            style={sub === key ? activeSubButtonStyle : subButtonStyle}
            onClick={() => { setSub(key) }}
          >
            {SUB_LABELS[key]}
          </button>
        ))}
      </div>
      {/* All three stay mounted (render-once): only the visible one is
          flexed, the others are display:none — an editor draft or an open
          proposal card survives the sub-switch. */}
      <div style={{ ...pageStyle, ...(sub === 'tasks' ? {} : { display: 'none' }) }} data-tasks-page="tasks">
        {/* The 详情 drawer overlays its page (ADR-0033): position:relative
            keeps it inside the 任务 sub-page. */}
        <div style={{ ...pageStyle, flex: 1, position: 'relative' }}>{tasks}</div>
      </div>
      <div style={{ ...pageStyle, ...(sub === 'inbox' ? {} : { display: 'none' }) }} data-tasks-page="inbox">
        {inbox}
      </div>
      <div style={{ ...pageStyle, ...(sub === 'schedule' ? {} : { display: 'none' }) }} data-tasks-page="schedule">
        {schedule}
      </div>
    </div>
  )
}
