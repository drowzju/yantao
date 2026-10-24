/**
 * The 任务 tab's 「详情」 drawer (ADR-0033): one task run's session transcript,
 * read back from the durable log and rendered read-only — prompts and replies
 * verbatim, tool calls as collapsible nodes showing the name and an argument
 * digest until opened. Mounted inside the 任务 tab's box (absolute, its own
 * scroll), closed by Esc or the close button.
 *
 * Presentation only: the shaping and loading live in `session-detail.ts`,
 * pinned by unit tests.
 * @module @deepseek-ai/dsh-client-ui-yantao/SessionDetailDrawer
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { formatTokens } from './insights.ts'
import type { DetailItem, SessionDetailLoader, SessionUsage } from './session-detail.ts'
import { useDialogModal } from './use-dialog-modal.ts'
import type { TaskRow } from './task-view.ts'
import type { WorkbenchT } from './locales.ts'

/** The drawer's props: the anchored row, the injected loader, the close verb. */
export interface SessionDetailDrawerProps {
  /** The task row whose 「详情」 was clicked — carries the session anchor. */
  readonly row: TaskRow
  /** Read one session's transcript back (ADR-0033). */
  readonly load: SessionDetailLoader
  /** Close the drawer (Esc and the ✕ both land here). */
  readonly onClose: () => void
  /** The workbench dictionary's bound translator. */
  readonly t: WorkbenchT
}

const backdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'transparent',
  zIndex: 15,
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  inset: '12px 12px 12px 12px',
  zIndex: 16,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--yt-surface-primary)',
  border: '1px solid var(--yt-border-strong)',
  borderRadius: 8,
  boxShadow: 'var(--yt-shadow-overlay)',
  minWidth: 0,
  overflow: 'hidden',
  // 面板自身接收初始焦点（tabIndex=-1）；轮廓交给面板内的真控件去画。
  outline: 'none',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--yt-space-2)',
  padding: 'var(--yt-space-2) var(--yt-space-3)',
  borderBottom: '1px solid var(--yt-border-subtle)',
  flex: 'none',
}

const titleStyle: CSSProperties = {
  fontSize: 'var(--yt-type-body)',
  fontWeight: 600,
  color: 'var(--yt-text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const closeButtonStyle: CSSProperties = {
  flex: 'none',
  border: 'none',
  background: 'transparent',
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-title)',
  lineHeight: 1,
  padding: 'var(--yt-space-1) var(--yt-space-1)',
  cursor: 'pointer',
  borderRadius: 4,
}

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--yt-space-2) var(--yt-space-3) var(--yt-space-4)',
}

const noticeStyle: CSSProperties = {
  padding: 'var(--yt-space-5) var(--yt-space-3)',
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-label)',
  textAlign: 'center',
}

const errorStyle: CSSProperties = {
  ...noticeStyle,
  color: 'var(--yt-error)',
}

const dividerStyle: CSSProperties = {
  margin: 'var(--yt-space-3) 0 var(--yt-space-2)',
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-label)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--yt-space-2)',
}

const dividerLineStyle: CSSProperties = {
  flex: 1,
  borderTop: '1px solid var(--yt-border-subtle)',
}

const bubbleStyle: CSSProperties = {
  margin: 'var(--yt-space-1) 0',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderRadius: 6,
  fontSize: 'var(--yt-type-label)',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const userBubbleStyle: CSSProperties = {
  ...bubbleStyle,
  background: 'var(--yt-surface-raised)',
  // 说话人身份靠底色差就够了：3px 侧边彩条是最容易被认出的 AI 味记号
  // （impeccable side-tab），换成整圈细描边。
  border: '1px solid var(--yt-accent-border)',
}

const injectedBubbleStyle: CSSProperties = {
  ...bubbleStyle,
  background: 'transparent',
  border: '1px dashed var(--yt-border-subtle)',
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-label)',
}

const assistantBubbleStyle: CSSProperties = {
  ...bubbleStyle,
  background: 'transparent',
}

const toolHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--yt-space-1)',
  width: '100%',
  border: 'none',
  background: 'transparent',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: 'var(--yt-type-label)',
  color: 'var(--yt-text-secondary)',
  borderRadius: 6,
}

const toolBodyStyle: CSSProperties = {
  margin: '0 0 var(--yt-space-1) var(--yt-space-2)',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderLeft: '2px solid var(--yt-border-subtle)',
  fontSize: 'var(--yt-type-label)',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: 'var(--yt-text-secondary)',
}

const errorTagStyle: CSSProperties = {
  color: 'var(--yt-error)',
  fontWeight: 600,
}

const usageStripStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--yt-space-1) var(--yt-space-3)',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  margin: '0 0 var(--yt-space-2)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  background: 'var(--yt-surface-raised)',
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-label)',
  fontVariantNumeric: 'tabular-nums',
}

const usageLabelStyle: CSSProperties = {
  color: 'var(--yt-text-muted)',
}

/** The 「详情」 drawer over one task run's session log (ADR-0033). */
export function SessionDetailDrawer(props: {
  readonly row: TaskRow
  readonly load: SessionDetailLoader
  readonly onClose: () => void
  readonly t: WorkbenchT
}): ReactElement {
  const { row, load, onClose } = props
  const [items, setItems] = useState<readonly DetailItem[] | null>(null)
  const [usage, setUsage] = useState<SessionUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openTools, setOpenTools] = useState<ReadonlySet<number>>(new Set())

  // Load once per mount; the caller keys the drawer by row id, so a new row
  // re-mounts and re-reads. A running task reads what has been flushed so far.
  useEffect(() => {
    const controller = new AbortController()
    setItems(null)
    setUsage(null)
    setError(null)
    load(row.sessionId as string, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setItems(loaded.items)
        setUsage(loaded.usage)
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => { controller.abort() }
  }, [row, load])

  // Esc closes — the drawer is an overlay, so the escape hatch is keyboard-first.
  // 模态纪律（2026-10-05 收敛）：Esc 与 Tab 圈闭走 useDialogModal，初始焦点
  // 落在面板上、关闭时还给触发点——与 ProposalCard/ConfigDialog 同一套，
  // 替代原先只挂在 window 上、不管焦点的裸 Esc 监听。
  const { cardRef, onPanelKeyDown } = useDialogModal({ onClose })

  const toggleTool = (seq: number): void => {
    setOpenTools((current) => {
      const next = new Set(current)
      if (next.has(seq)) next.delete(seq)
      else next.add(seq)
      return next
    })
  }

  let lastTurn = -1
  const rendered: ReactElement[] = []
  for (const item of items ?? []) {
    const divider = item.turn !== lastTurn
      ? (
        <div key={`turn-${item.seq}`} style={dividerStyle}>
          <span>{`第 ${item.turn + 1} 轮`}</span>
          <span style={dividerLineStyle} />
        </div>
      )
      : null
    lastTurn = item.turn
    if (divider !== null) rendered.push(divider)
    if (item.kind === 'user') {
      rendered.push(
        item.injected
          ? <div key={item.seq} style={injectedBubbleStyle}>{item.text}</div>
          : <div key={item.seq} style={userBubbleStyle}>{item.text}</div>,
      )
      continue
    }
    if (item.kind === 'assistant') {
      rendered.push(<div key={item.seq} style={assistantBubbleStyle}>{item.text}</div>)
      continue
    }
    const open = openTools.has(item.seq)
    const digest = item.args.length > 60 ? `${item.args.slice(0, 60)}…` : item.args
    rendered.push(
      <div key={item.seq}>
        <button data-hover="true"
          type="button"
          style={toolHeaderStyle}
          onClick={() => { toggleTool(item.seq) }}
          aria-expanded={open}
        >
          <span>{open ? '▾' : '▸'}</span>
          <span style={item.error !== null ? errorTagStyle : undefined}>{item.name}</span>
          {/* 2026-10-23 评审 B：12px 摘要 opacity 0.7 实测 3.05:1，不过 AA——摘要
              正是「这次工具调了什么」的唯一线索，改用 secondary token（5.77:1）。 */}
          <span style={{ color: 'var(--yt-text-secondary)' }}>{digest}</span>
        </button>
        {open && (
          <div style={toolBodyStyle}>
            <div style={{ color: 'var(--yt-text-muted)', marginBottom: 'var(--yt-space-1)' }}>参数</div>
            <div>{item.args}</div>
            <div style={{ color: 'var(--yt-text-muted)', marginTop: 'var(--yt-space-1)', marginBottom: 'var(--yt-space-1)' }}>
              {item.error !== null ? `结果（${item.error}）` : '结果'}
            </div>
            <div>{item.result ?? '（尚未返回）'}</div>
          </div>
        )}
      </div>,
    )
  }

  return (
    // Keydown lands on the wrapper holding backdrop + panel, per the hook
    // doc's "attach to the wrapper that contains the card" guidance; every
    // keystroke that matters originates inside the panel and bubbles here.
    <div onKeyDown={onPanelKeyDown}>
      <div style={backdropStyle} onClick={onClose} />
      <div style={panelStyle} role="dialog" aria-modal="true" aria-label={row.title} tabIndex={-1} ref={cardRef} data-task-detail-panel="true">
        <div style={headerStyle}>
          <span style={titleStyle}>{`${row.title} · 会话详情`}</span>
          <button data-hover="true" type="button" style={closeButtonStyle} onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div style={bodyStyle}>
          {usage !== null && (
            <div style={usageStripStyle} data-task-usage="true">
              <span>
                <span style={usageLabelStyle}>用量 </span>
                {`输入 ${formatTokens(usage.inputTokens)} · 输出 ${formatTokens(usage.outputTokens)} · 共 ${formatTokens(usage.inputTokens + usage.outputTokens)} tokens（${usage.steps} 步）`}
              </span>
              {usage.lastInputTokens !== null && usage.contextWindow !== null && (() => {
                const percent = Math.min(100, Math.round(usage.lastInputTokens / usage.contextWindow * 100))
                const tone = percent > 95
                  ? 'var(--yt-error)'
                  : percent > 80 ? 'var(--yt-warning-text)' : undefined
                return (
                  <span>
                    <span style={usageLabelStyle}>末次上下文 </span>
                    {`${formatTokens(usage.lastInputTokens)} / ${formatTokens(usage.contextWindow)}`}
                    <span style={tone !== undefined ? { color: tone, fontWeight: 600 } : undefined}>{`（${percent}%）`}</span>
                  </span>
                )
              })()}
            </div>
          )}
          {error !== null && <div style={errorStyle}>{`读取失败：${error}`}</div>}
          {error === null && items === null && <div style={noticeStyle}>读取中…</div>}
          {error === null && items !== null && rendered.length === 0 && (
            <div style={noticeStyle}>这个会话还没有可展示的内容。</div>
          )}
          {rendered}
        </div>
      </div>
    </div>
  )
}
