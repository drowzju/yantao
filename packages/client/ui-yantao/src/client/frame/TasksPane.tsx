/**
 * The 任务 tab's body (ADR-0031): one flat list of this session's task
 * executions, running on top, each row 「动作＋对象」/ stage / detail /
 * elapsed, with 取消 where the row is still running and 查看 where jumping
 * makes sense. Pure presentation — rows, cancel and jump arrive as props;
 * the only state of its own is the one-second clock the elapsed column
 * ticks by.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { formatElapsed, sortTaskRows, type TaskRow, type TaskStatus } from '../task-view.ts'

/** The pane's props: the frame's rows plus the verbs it offers per row. */
export interface TasksPaneProps {
  /** The frame's task rows in arrival order; the pane sorts them for display. */
  readonly rows: readonly TaskRow[]
  /** Stop one running task (the frame routes to the right cancel path). */
  readonly onCancel: (row: TaskRow) => void
  /** Jump to where the task's outcome lives (会话 for refine, the connector tab otherwise). */
  readonly onJump: (row: TaskRow) => void
  /** Open one task's 「详情」 drawer (ADR-0033) — offered only for rows anchored to a session. */
  readonly onDetail: (row: TaskRow) => void
}

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

const paneStyle = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflowY: 'auto',
  padding: '8px 12px',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
} as const

const emptyStyle = { color: 'var(--yt-text-muted)', padding: '24px 0', textAlign: 'center' } as const

const rowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '6px 10px',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  background: 'var(--yt-surface-raised)',
} as const

const titleStyle = { fontWeight: 600, whiteSpace: 'nowrap' } as const

const stageStyle = { color: 'var(--yt-text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } as const

const elapsedStyle = { color: 'var(--yt-text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const

const chipStyle = {
  borderRadius: 8,
  padding: '0 8px',
  fontSize: 'var(--yt-type-label)',
  whiteSpace: 'nowrap',
} as const

/** Chip text and tint per status — the row's one glanceable verdict. */
const STATUS_CHIPS: Record<TaskStatus, { label: string; color: string }> = {
  running: { label: '运行中', color: 'var(--yt-accent)' },
  waiting: { label: '待确认', color: 'var(--yt-warning)' },
  done: { label: '已完成', color: 'var(--yt-success)' },
  cancelled: { label: '已取消', color: 'var(--yt-text-muted)' },
  failed: { label: '失败', color: 'var(--yt-error)' },
}

const actionButtonStyle = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--yt-border-strong)',
  borderRadius: 4,
  background: 'var(--yt-surface-raised)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-label)',
  padding: '1px 8px',
  whiteSpace: 'nowrap',
} as const

/** One row of the list. */
function TaskLine({ row, onCancel, onJump, onDetail }: {
  row: TaskRow
  onCancel: (row: TaskRow) => void
  onJump: (row: TaskRow) => void
  onDetail: (row: TaskRow) => void
}): ReactElement {
  const chip = STATUS_CHIPS[row.status]
  const elapsed = formatElapsed((row.endedAt ?? Date.now()) - row.startedAt)
  return (
    <div style={rowStyle} data-task-row={row.id} data-task-status={row.status} data-task-kind={row.kind}>
      <span style={{ ...chipStyle, color: '#fff', background: chip.color }} data-task-chip={row.status}>
        {chip.label}
      </span>
      <span style={titleStyle}>{row.title}</span>
      <span style={stageStyle}>{row.stage}{row.detail !== null ? ` · ${row.detail}` : ''}</span>
      <span style={elapsedStyle}>{elapsed}</span>
      {row.status === 'running' && (
        <button type="button" style={actionButtonStyle} data-task-cancel="true" onClick={() => { onCancel(row) }}>
          取消
        </button>
      )}
      <button type="button" style={actionButtonStyle} data-task-jump="true" onClick={() => { onJump(row) }}>
        查看
      </button>
      {/* ADR-0033: the read-only transcript drawer, only where the run made a
          session — script capabilities are bare subprocesses with no log. */}
      {row.sessionId !== null && (
        <button type="button" style={actionButtonStyle} data-task-detail="true" onClick={() => { onDetail(row) }}>
          详情
        </button>
      )}
    </div>
  )
}

/**
 * Render the 任务 tab's list.
 * @param props - see {@link TasksPaneProps}.
 * @returns the pane element.
 */
export function TasksPane({ rows, onCancel, onJump, onDetail }: TasksPaneProps): ReactElement {
  // The elapsed column ticks: one re-render a second while anything is live,
  // none at all once every row has ended.
  const [, setTick] = useState(0)
  const live = rows.some(row => row.status === 'running' || row.status === 'waiting')
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => { setTick(tick => tick + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [live])

  const sorted = sortTaskRows(rows)
  if (sorted.length === 0) {
    return (
      <div style={paneStyle}>
        <div style={emptyStyle}>本会话还没有任务。提炼、邮件分析和能力执行开始后会出现在这里。</div>
      </div>
    )
  }
  return (
    <div style={paneStyle} data-tasks-pane="true">
      {sorted.map(row => (
        <TaskLine key={row.id} row={row} onCancel={onCancel} onJump={onJump} onDetail={onDetail} />
      ))}
    </div>
  )
}
