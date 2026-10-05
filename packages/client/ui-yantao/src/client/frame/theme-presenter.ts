/**
 * Global theme DOM applier for the workbench frame (ADR-0011). ui-theme's
 * boot script owns the pre-plugin interval; after the plugin tree activates,
 * whoever owns the frame owns these DOM fields — `html { color-scheme }` for
 * native UA chrome, `body[data-ds-dark-theme]` for the token palette, the
 * content font-size axis, the active theme's alias-token overrides, the
 * `--yt-*` design-token family (docs/yantao/design.md §2–4), and one
 * presenter-owned `meta[name="theme-color"]`. Pure DOM writes: the presenter
 * only ever retracts what it wrote itself.
 */
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { ytTokensFor } from './yt-tokens.ts'

/** Body attribute selecting the dark base palette in the token stylesheets. */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme'
/** Body variable carrying the user's content font size in px. */
export const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size'
/** Id of the one stylesheet this presenter owns (the keyboard focus ring). */
const FOCUS_STYLE_ID = 'yt-focus-ring'

/**
 * The workbench's keyboard focus ring. Upstream ships no `:focus-visible`
 * rule of its own, so keyboard focus was invisible everywhere our components
 * reach — the ring is presenter-owned like the tokens it draws from, one
 * sheet, inserted once, retracted with the presenter.
 */
const FOCUS_RING_CSS = `
:focus-visible {
  outline: 2px solid var(--yt-accent-strong, #3a66b5);
  outline-offset: 1px;
}
`

/** Applies theme snapshots to the document; one instance per plugin fiber. */
export class ThemePresenter {
  /** Token names this presenter wrote in the last apply (its retraction set). */
  #appliedTokens: string[] = []
  /** The single metadata node this presenter inserts and removes. */
  readonly #themeColorMeta: HTMLMetaElement
  /** The focus-ring stylesheet, inserted once on first apply. */
  #focusStyle: HTMLStyleElement | undefined

  constructor() {
    this.#themeColorMeta = document.createElement('meta')
    this.#themeColorMeta.name = 'theme-color'
  }

  /**
   * Project a snapshot onto the document.
   * @param snapshot - resolved theme snapshot from ctx.theme.
   */
  apply(snapshot: ThemeSnapshot): void {
    if (this.#focusStyle === undefined) {
      const existing = document.getElementById(FOCUS_STYLE_ID)
      this.#focusStyle = existing instanceof HTMLStyleElement ? existing : undefined
      if (this.#focusStyle === undefined) {
        this.#focusStyle = document.createElement('style')
        this.#focusStyle.id = FOCUS_STYLE_ID
        this.#focusStyle.textContent = FOCUS_RING_CSS
        document.head.append(this.#focusStyle)
      }
    }
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`)
    for (const name of this.#appliedTokens) body.style.removeProperty(name)
    this.#appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.#appliedTokens.push(name)
    }
    // Our own `--yt-*` family (docs/yantao/design.md §2–4): the same write
    // and retraction discipline as the alias tokens, keyed on the scheme.
    for (const [name, value] of Object.entries(ytTokensFor(scheme))) {
      body.style.setProperty(name, value)
      this.#appliedTokens.push(name)
    }
    this.#themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.#themeColorMeta.isConnected) document.head.append(this.#themeColorMeta)
  }

  /** Retract every field this presenter wrote. */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE)
    for (const name of this.#appliedTokens) body.style.removeProperty(name)
    this.#appliedTokens = []
    this.#focusStyle?.remove()
    this.#focusStyle = undefined
    this.#themeColorMeta.remove()
  }
}
