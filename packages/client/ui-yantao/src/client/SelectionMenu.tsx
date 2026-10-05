/**
 * The selection right-click menu (ADR-0025 决定 5): the selected text plus
 * the instruction capabilities that opted in through
 * `appliesTo.selection: true`. The fixed 「发送到会话」 item is the gesture's
 * base meaning — the selection *is* the prompt — and needs no capability.
 * Keyboard traversal, dismissal and viewport clamping live in the shared
 * useFloatingMenu (menu-behavior.ts), same as the rails' row menu.
 * @module @deepseek-ai/dsh-client-ui-yantao/SelectionMenu
 */
import { useRef, type ReactElement } from 'react'
import type { KbCapabilitySummary } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { WorkbenchT } from './locales.ts'
import { useFloatingMenu } from './menu-behavior.ts'

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

const menuStyle = {
  position: 'fixed',
  zIndex: 40,
  padding: 4,
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  fontFamily: FONT,
  fontSize: 'var(--yt-type-body)',
} as const

const itemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '3px 8px',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  borderRadius: 3,
  whiteSpace: 'nowrap',
} as const

const noteStyle = { padding: '2px 8px', color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)' } as const

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
  /** Run one selection capability: the `/name` gesture message (ADR-0026 决定 4). */
  readonly onRun: (name: string, selection: string) => void
  readonly onClose: () => void
  readonly t: WorkbenchT
}): ReactElement {
  const { t } = props
  const ref = useRef<HTMLDivElement | null>(null)
  const position = useFloatingMenu(ref, props.onClose, props)

  return (
    <div ref={ref} role="menu" style={{ ...menuStyle, left: position.left, top: position.top }} data-selection-menu="true">
      <div style={noteStyle}>{t('selection.title')}</div>
      <button
        type="button"
        role="menuitem"
        style={itemStyle}
        data-selection-send="true"
        onClick={() => { props.onSend(props.text); props.onClose() }}
      >
        {t('selection.send')}
      </button>
      {props.capabilities.length > 0 && <div style={noteStyle}>{t('selection.capability')}</div>}
      {props.capabilities.map(capability => (
        <button
          key={capability.name}
          type="button"
          role="menuitem"
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
 * to quote, so no 「发送到会话」 item. The frame runs the capability as the
 * `/name @path` gesture message (ADR-0026 决定 4).
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
  readonly onRun: (capability: KbCapabilitySummary) => void
  readonly onClose: () => void
  readonly t: WorkbenchT
}): ReactElement {
  const { t } = props
  const ref = useRef<HTMLDivElement | null>(null)
  const position = useFloatingMenu(ref, props.onClose, props)

  return (
    <div ref={ref} role="menu" style={{ ...menuStyle, left: position.left, top: position.top }} data-capability-menu="true">
      <div style={noteStyle}>{t('selection.runOnFile')}</div>
      {props.capabilities.map(capability => (
        <button
          key={capability.name}
          type="button"
          role="menuitem"
          style={itemStyle}
          data-file-capability={capability.name}
          title={capability.description}
          onClick={() => { props.onRun(capability); props.onClose() }}
        >
          {capability.name}
        </button>
      ))}
    </div>
  )
}
