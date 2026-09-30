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
import { formatTokens } from './ContextStatusBar.tsx'
import type { DetailItem, SessionDetailLoader, SessionUsage } from './session-detail.ts'
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
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
  minWidth: 0,
  overflow: 'hidden',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '10px 14px',
  borderBottom: '1px solid var(--yt-border-subtle)',
  flex: 'none',
}

const titleStyle: CSSProperties = {
  fontSize: 13,
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
  fontSize: 16,
  lineHeight: 1,
  padding: '2px 6px',
  cursor: 'pointer',
  borderRadius: 4,
}

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '8px 14px 16px',
}

const noticeStyle: CSSProperties = {
  padding: '24px 14px',
  color: 'var(--yt-text-secondary)',
  fontSize: 12,
  textAlign: 'center',
}

const errorStyle: CSSProperties = {
  ...noticeStyle,
  color: 'var(--yt-error)',
}

const dividerStyle: CSSProperties = {
  margin: '14px 0 8px',
  color: 'var(--yt-text-secondary)',
  fontSize: 11,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const dividerLineStyle: CSSProperties = {
  flex: 1,
  borderTop: '1px solid var(--yt-border-subtle)',
}

const bubbleStyle: CSSProperties = {
  margin: '4px 0',
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 12,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const userBubbleStyle: CSSProperties = {
  ...bubbleStyle,
  background: 'var(--yt-surface-raised)',
  borderLeft: '3px solid var(--yt-accent)',
}

const injectedBubbleStyle: CSSProperties = {
  ...bubbleStyle,
  background: 'transparent',
  border: '1px dashed var(--yt-border-subtle)',
  color: 'var(--yt-text-secondary)',
  fontSize: 11,
}

const assistantBubbleStyle: CSSProperties = {
  ...bubbleStyle,
  background: 'transparent',
  borderLeft: '3px solid var(--yt-border-strong)',
}

const toolHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  width: '100%',
  border: 'none',
  background: 'transparent',
  padding: '4px 10px',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--yt-text-secondary)',
  borderRadius: 6,
}

const toolBodyStyle: CSSProperties = {
  margin: '0 0 4px 10px',
  padding: '6px 10px',
  borderLeft: '2px solid var(--yt-border-subtle)',
  fontSize: 11,
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
  gap: '2px 14px',
  padding: '6px 10px',
  margin: '0 0 8px',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  background: 'var(--yt-surface-raised)',
  color: 'var(--yt-text-secondary)',
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
}

const usageLabelStyle: CSSProperties = {
  color: 'var(--yt-text-tertiary)',
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

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
        <button
          type="button"
          style={toolHeaderStyle}
          onClick={() => { toggleTool(item.seq) }}
          aria-expanded={open}
        >
          <span>{open ? '▾' : '▸'}</span>
          <span style={item.error !== null ? errorTagStyle : undefined}>{item.name}</span>
          <span style={{ opacity: 0.7 }}>{digest}</span>
        </button>
        {open && (
          <div style={toolBodyStyle}>
            <div style={{ color: 'var(--yt-text-tertiary)', marginBottom: 2 }}>参数</div>
            <div>{item.args}</div>
            <div style={{ color: 'var(--yt-text-tertiary)', marginTop: 6, marginBottom: 2 }}>
              {item.error !== null ? `结果（${item.error}）` : '结果'}
            </div>
            <div>{item.result ?? '（尚未返回）'}</div>
          </div>
        )}
      </div>,
    )
  }

  return (
    <>
      <div style={backdropStyle} onClick={onClose} />
      <div style={panelStyle} role="dialog" aria-label={row.title} data-task-detail-panel="true">
        <div style={headerStyle}>
          <span style={titleStyle}>{`${row.title} · 会话详情`}</span>
          <button type="button" style={closeButtonStyle} onClick={onClose} aria-label="关闭">✕</button>
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
    </>
  )
}
