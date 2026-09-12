/**
 * The reading-project dialog's three faces (ADR-0020).
 *
 * {@link ReadingDialog} is the app-level confirm that stands between a
 * resource and its 读书项目: the question it asks is a known two-choice —
 * name the project, and whether the agent should read the book now — so it is
 * a dialog, not an agent round-trip. Confirming hands the work to the
 * background task slot (reading-task.ts) and closes at once: the chain takes
 * minutes, and the workbench must not hold still for it.
 *
 * {@link ReadingMonitor} is the bottom bar that reports the slot's stage and
 * carries the cancel button; a failed task dies there too, with the model's
 * own words in the error and the session's name spelled out so the原话 can be
 * found again. {@link ReadingProposal} (its own file) is the verdict window
 * the slot reopens when the first round lands.
 * @module @deepseek-ai/dsh-client-ui-yantao/ReadingDialog
 */
import { useState, type ReactElement } from 'react'
import type { ReadingTask } from './reading-task.ts'
import { readingSessionTitle } from './reading-flow.ts'

/** Dialog props. */
export interface ReadingDialogProps {
  /** The resource the project reads, `resources/…`. */
  readonly resourcePath: string
  /** Start the background task for this resource; the dialog closes at once. */
  readonly onStart: (title: string, read: boolean) => void
  /** Close without creating anything. */
  readonly onCancel: () => void
  /** Another reading task is running: creation is refused until it ends. */
  readonly disabled?: boolean
}

const overlayStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(251, 250, 247, 0.94)',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 13,
} as const

const cardStyle = {
  minWidth: 340,
  maxWidth: 'min(480px, 92vw)',
  padding: 24,
  background: '#fff',
  border: '1px solid #e6e2d8',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
} as const

const hintStyle = { color: '#6b6455', fontSize: 12 } as const

const inputStyle = { padding: '4px 6px', width: '100%', boxSizing: 'border-box' } as const

const buttonStyle = { padding: '4px 10px' } as const

/**
 * The book's display name, read out of the resource's file name: the
 * extension goes, the rest is the human's to edit.
 * @param resourcePath - the resource's KB-relative path.
 * @returns the pre-filled book title.
 */
export function bookTitleOf(resourcePath: string): string {
  const base = resourcePath.slice(resourcePath.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * Render the reading-project form.
 * @param props - see {@link ReadingDialogProps}.
 * @returns the dialog element.
 */
export function ReadingDialog(props: ReadingDialogProps): ReactElement {
  const [title, setTitle] = useState(bookTitleOf(props.resourcePath))
  const [read, setRead] = useState(true)

  return (
    <div style={overlayStyle} data-reading-dialog="true">
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>创建读书项目</div>
        <div style={hintStyle}>
          为 <span title={props.resourcePath}>{bookTitleOf(props.resourcePath)}</span> 建一个项目，
          frontmatter 里会记下它读的是哪本书。
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          书名
          <input
            type="text"
            style={inputStyle}
            value={title}
            onChange={(event) => { setTitle(event.target.value) }}
            aria-label="书名"
          />
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={read}
            onChange={() => { setRead(value => !value) }}
            aria-label="读取书籍内容"
          />
          是否需要我读取书籍内容为你整理大纲？
        </label>
        <div style={hintStyle}>读书在后台进行，不挡住工作台；进度显示在下方状态条。</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={buttonStyle} onClick={props.onCancel}>取消</button>
          <button
            type="button"
            style={buttonStyle}
            disabled={props.disabled === true || title.trim() === ''}
            title={props.disabled === true ? '已有一个读书任务在运行' : undefined}
            onClick={() => { props.onStart(title.trim(), read) }}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  )
}

/** What each stage of a running task says in the bar. */
const STAGE_LABELS: Record<ReadingTask['stage'], string> = {
  creating: '正在创建读书项目…',
  extracting: '正在抽取书籍文本…（缺少 Python 解析库时会自动安装）',
  session: '正在创建会话…',
  prompt: '正在向模型布置任务…',
  reading: '模型正在读书…（抽样阅读，几分钟内完成）',
  writing: '正在写入领域关联…',
}

/** Monitor bar props. */
export interface ReadingMonitorProps {
  /** The task to report. */
  readonly task: ReadingTask
  /** Abort a running task. */
  readonly onCancel: () => void
  /** Clear a failed task. */
  readonly onDismiss: () => void
  /** Open the project file (a failed task keeps it). */
  readonly onOpen: (projectPath: string) => void
}

const barStyle = {
  gridColumn: '1 / -1',
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  padding: '5px 12px',
  borderTop: '1px solid #e6e2d8',
  background: '#fbfaf7',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 12,
  minHeight: 28,
} as const

const errorStyle = { color: '#b4453a' } as const

const mutedStyle = { color: '#6b6455' } as const

const flexibleStyle = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

/**
 * Render the bottom bar that follows the reading task.
 * @param props - see {@link ReadingMonitorProps}.
 * @returns the bar element.
 */
export function ReadingMonitor(props: ReadingMonitorProps): ReactElement {
  const { task } = props
  const sessionTitle = readingSessionTitle(task.bookTitle)
  if (task.status === 'failed') {
    return (
      <div style={barStyle} data-reading-monitor="failed">
        <span style={errorStyle} title={task.error ?? undefined} data-reading-error="true">{task.error}</span>
        {task.hint !== null && <span style={mutedStyle} title={task.hint}>{task.hint}</span>}
        <span style={{ ...flexibleStyle, ...mutedStyle }} title={sessionTitle}>
          会话「{sessionTitle}」保留在会话列表里，可打开查看原话。
        </span>
        {task.projectPath !== null && (
          <button
            type="button"
            style={buttonStyle}
            onClick={() => { if (task.projectPath !== null) props.onOpen(task.projectPath) }}
          >
            打开项目
          </button>
        )}
        <button type="button" style={buttonStyle} onClick={props.onDismiss}>关闭</button>
      </div>
    )
  }
  return (
    <div style={barStyle} data-reading-monitor={task.status} data-reading-stage={task.stage}>
      <span style={flexibleStyle}>{STAGE_LABELS[task.stage]}</span>
      {task.status === 'running' && (
        <button type="button" style={buttonStyle} onClick={props.onCancel}>取消</button>
      )}
    </div>
  )
}
