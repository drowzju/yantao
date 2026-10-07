/**
 * Shared behavior for the workbench's floating menus (the row menu, the
 * directory menu, the selection menu, the capability menu): dismissal,
 * keyboard traversal, and viewport clamping. One hook, four tenants — the
 * menu disciplines stopped being each station's own conscience (2026-10-05
 * 第三轮评审 P2#5) and became structure, the way use-dialog-modal did for
 * modals.
 * @module @deepseek-ai/dsh-client-ui-yantao/menu-behavior
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** The menu's minimum distance from the viewport edge after clamping. */
const MENU_MARGIN = 8

/**
 * Dismiss-on-Escape/outside-click, focus entry, and arrow-key traversal for
 * one floating menu. On mount the first enabled item takes focus (a menu is
 * a modal gesture: the keyboard user lands inside it, not beside it);
 * ↑/↓ walk the enabled items, Home/End jump to the ends, Tab leaves the
 * menu (closing it — a menu is not a tab stop), Escape dismisses, and a
 * `mousedown` anywhere outside dismisses too. The `mousedown` that opened
 * the menu has already been dispatched, so it cannot close itself the
 * moment it appears.
 *
 * The returned position is the given anchor clamped into the viewport —
 * computed after mount, when the menu's real size is measurable, so a menu
 * opened near the screen's right or bottom edge stays fully on screen.
 * @param ref - the menu's root element.
 * @param onClose - the close callback.
 * @param anchor - the requested position in client coordinates.
 * @returns the clamped position to render at.
 */
export function useFloatingMenu(
  ref: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
  anchor: { readonly x: number; readonly y: number },
): { readonly left: number; readonly top: number } {
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y })

  // The close callback rides in a ref: every tenant passes a fresh inline
  // lambda, and the effect below must not tear down/re-register (and snap
  // the focus back to the first item) whenever a parent re-renders with a
  // new closure — the same discipline use-dialog-modal documents.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Clamp after paint-but-before-display (layout effect, so the first frame
  // never flashes at an off-screen position).
  useLayoutEffect(() => {
    const el = ref.current
    const width = el?.offsetWidth ?? 0
    const height = el?.offsetHeight ?? 0
    setPosition({
      left: Math.max(MENU_MARGIN, Math.min(anchor.x, window.innerWidth - width - MENU_MARGIN)),
      top: Math.max(MENU_MARGIN, Math.min(anchor.y, window.innerHeight - height - MENU_MARGIN)),
    })
  }, [anchor.x, anchor.y, ref])

  useEffect(() => {
    const items = (): HTMLButtonElement[] =>
      Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
      const enabled = items()
      if (enabled.length === 0) return
      const current = enabled.indexOf(document.activeElement as HTMLButtonElement)
      let next: number
      if (event.key === 'ArrowDown') next = Math.min(current + 1, enabled.length - 1)
      else if (event.key === 'ArrowUp') next = Math.max(current - 1, 0)
      else if (event.key === 'Home') next = 0
      else next = enabled.length - 1
      event.preventDefault()
      enabled[next]?.focus()
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    // Land on the first item: the menu opens into the keyboard user's hands.
    items()[0]?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [ref])

  return position
}
