/**
 * The selection right-click menu (ADR-0025 决定 5): the selected text plus
 * the instruction capabilities that opted in through
 * `appliesTo.selection: true`. The fixed 「发送到会话」 item is the gesture's
 * base meaning — the selection *is* the prompt — and needs no capability.
 * @module @deepseek-ai/dsh-client-ui-yantao/SelectionMenu
 */
import { useEffect, useRef, type ReactElement } from 'react'
import type { KbCapabilitySummary } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

const menuStyle = {
  position: 'fixed',
  zIndex: 40,
  padding: 4,
  background: '#fff',
  border: '1px solid #e6e2d8',
  borderRadius: 4,
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  fontFamily: FONT,
  fontSize: 13,
} as const

const itemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '3px 8px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  borderRadius: 3,
  whiteSpace: 'nowrap',
} as const

const noteStyle = { padding: '2px 8px', color: '#9a9488', fontSize: 12 } as const

/**
 * The selection menu, fixed-positioned at the mouseup point.
 * @param props - the selection, its position, the opted-in capabilities, and
 *   the two actions.
 * @returns the menu element.
 */
export function SelectionMenu(props: {  /** The selected text, as the user marked it. */
  readonly text: string
  /** The mouseup point, in client coordinates. */
  readonly x: number
  readonly y: number
  /** The instruction capabilities that declared `appliesTo.selection`. */
  readonly capabilities: readonly KbCapabilitySummary[]
  /** Send the raw selection to the current session (「发送到会话」). */
  readonly onSend: (text: string) => void
  /** Run one selection capability: its SKILL.md body + the selection. */
  readonly onRun: (name: string, selection: string) => void
  readonly onClose: () => void
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) props.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [props])

  return (
    <div ref={ref} style={{ ...menuStyle, left: props.x, top: props.y }} data-selection-menu="true">
      <div style={noteStyle}>选中文字</div>
      <button
        type="button"
        style={itemStyle}
        data-selection-send="true"
        onClick={() => { props.onSend(props.text); props.onClose() }}
      >
        发送到会话
      </button>
      {props.capabilities.length > 0 && <div style={noteStyle}>能力</div>}
      {props.capabilities.map(capability => (
        <button
          key={capability.name}
          type="button"
          style={itemStyle}
          data-selection-capability={capability.name}
          title={capability.description}
          onClick={() => { props.onRun(capability.name, props.text); props.onClose() }}
        >
          {capability.name}
        </button>
      ))}
    </div>
  )
}

/**
 * The middle-pane right-click's no-selection sibling (ADR-0025 决定 5): the
 * same opted-in capabilities, but the open file is the object — no selection
 * to quote, so no 「发送到会话」 item. The frame runs a capability as
 * SKILL.md body + `@path`, the resource right-click's serialization.
 * @param props - the position, the opted-in capabilities, and the two actions.
 * @returns the menu element.
 */
export function CapabilityMenu(props: {
  /** The contextmenu point, in client coordinates. */
  readonly x: number
  readonly y: number
  /** The instruction capabilities that declared `appliesTo.selection`. */
  readonly capabilities: readonly KbCapabilitySummary[]
  /** Run one capability against the open file. */
  readonly onRun: (name: string) => void
  readonly onClose: () => void
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) props.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [props])

  return (
    <div ref={ref} style={{ ...menuStyle, left: props.x, top: props.y }} data-capability-menu="true">
      <div style={noteStyle}>对当前文件调用能力</div>
      {props.capabilities.map(capability => (
        <button
          key={capability.name}
          type="button"
          style={itemStyle}
          data-file-capability={capability.name}
          title={capability.description}
          onClick={() => { props.onRun(capability.name); props.onClose() }}
        >
          {capability.name}
        </button>
      ))}
    </div>
  )
}
