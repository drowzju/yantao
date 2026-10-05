/**
 * The one modal-discipline every overlay shares (2026-10-05 模态纪律收敛):
 * ProposalCard proved the pattern — read the dialog's presence
 * (role=dialog + aria-modal belong to the markup), trap Tab inside the card,
 * take Esc as a first-class exit, guard Esc while a verdict is in flight, and
 * give the focus back to whoever held it before the dialog opened. This hook
 * is that pattern, extracted so ConfigDialog / QuestionDialog /
 * SessionDetailDrawer / ContextStatusBar stop reinventing fractions of it.
 *
 * The visual backdrop stays with each site; this hook owns only behaviour.
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

export interface DialogModalHandle {
  /**
   * The dialog element: receives the initial focus (`tabIndex={-1}`) and
   * bounds the Tab trap. Typed `RefObject<HTMLDivElement>` — this
   * TypeScript's div `ref` slot refuses the `| null` instantiation even
   * though the shapes coincide.
   */
  readonly cardRef: RefObject<HTMLDivElement>
  /** Attach to the wrapper that contains the card (the backdrop, or the card itself when there is no wrapper). */
  readonly onPanelKeyDown: (event: ReactKeyboardEvent) => void
}

export interface DialogModalOptions {
  /** Esc lands here — the site decides what an escape means (dismiss, abort, close). */
  readonly onClose: () => void
  /** While true Esc is inert: a verdict in flight must not be half-abandoned. */
  readonly busy?: boolean
  /** False while the dialog is not rendered; the focus handover only runs while active. */
  readonly active?: boolean
}

/**
 * Modal behaviour shared by every overlay: initial focus on the card, focus
 * restored on close, Esc (IME-guarded, busy-guarded) handed to `onClose`,
 * Tab cycled inside the card.
 */
export function useDialogModal(options: DialogModalOptions): DialogModalHandle {
  const { onClose, busy, active = true } = options
  const cardRef = useRef<HTMLDivElement | null>(null)
  // The callbacks ride in refs so the keydown handler and the focus effect
  // stay stable across renders — the trap must not re-run (and re-steal the
  // focus) every time a parent re-renders with a new closure.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cardRef.current?.focus()
    return () => { previous?.focus() }
  }, [active])

  const onPanelKeyDown = (event: ReactKeyboardEvent): void => {
    // IME 组合中的按键（选字/取消选字）不属于这层对话框。
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      if (busyRef.current !== true) {
        event.stopPropagation()
        onCloseRef.current()
      }
      return
    }
    if (event.key !== 'Tab') return
    const card = cardRef.current
    if (card === null) return
    const focusable = Array.from(card.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
    if (focusable.length === 0) { event.preventDefault(); return }
    const first = focusable.at(0)
    const last = focusable.at(-1)
    if (first === undefined || last === undefined) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return { cardRef, onPanelKeyDown }
}
