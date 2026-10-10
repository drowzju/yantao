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
 * The workbench's presenter sheet, inserted once, retracted with the
 * presenter. Three residents:
 * - the keyboard focus ring — upstream ships no `:focus-visible` rule of its
 *   own, so keyboard focus was invisible everywhere our components reach;
 * - the placeholder ink — the embedded conversation composer hardcodes a
 *   2.1:1 grey for its placeholder (detected 2026-10-05); muted token ink
 *   reads the same intent at AA contrast in both schemes. Two rules, because
 *   the composer has two placeholders: the real `::placeholder` pseudo, and
 *   a simulated one — upstream's styled `div.PNvALW_placeholder` (hashed
 *   CSS-module class, third-round forensics 2026-10-05) that the pseudo
 *   rule cannot reach. The class is addressed directly; if upstream renames
 *   the hash the rule quietly stops matching and the detector re-flags the
 *   contrast — the honest failure mode.
 * - the body motion ban — a layout-property transition (`max-width`,
 *   `margin-right`) was observed live on `body` (detected 2026-10-05);
 *   layout transitions jitter every frame, so the presenter forbids them at
 *   the one element it owns outright.
 * - the hover/active feedback layer (2026-10-09 评审 P1) — every clickable
 *   element in the workbench is an inline style object, so a stylesheet
 *   `:hover` background loses to the inline `background` and the whole UI
 *   answered nothing to the pointer. The rules below hook the `data-hover`
 *   attribute components stamp themselves with and win the cascade with
 *   `!important` — the same carve-out the placeholder ink already took. The
 *   motion ban above is untouched: hover answers instantly, no transition.
 */
const FOCUS_RING_CSS = `
:focus-visible {
  outline: 2px solid var(--yt-accent-strong, #3a66b5);
  outline-offset: 1px;
}
::placeholder {
  color: var(--yt-text-muted, #726c5e);
  opacity: 1;
}
.PNvALW_placeholder {
  color: var(--yt-text-muted, #726c5e) !important;
}
body {
  transition: none !important;
}
/* 2026-10-10 ocr 评审：:hover 命中 :disabled——忙碌态按钮也被涂灰，加
   :not(:disabled) 门。 */
button[data-hover]:not([data-hover="primary"]):not([data-hover="close"]):not(:disabled):hover {
  background: var(--yt-surface-secondary) !important;
}
button[data-hover]:not([data-hover="primary"]):not([data-hover="close"]):not(:disabled):active {
  background: var(--yt-border-subtle) !important;
}
/* A selected row is already accented — hover deepens nothing, press keeps
   the selection colour instead of flashing neutral. The exclusion chain is
   mirrored from the generic rule so the carve-out out-specifies it
   ((0,5,1) > (0,4,1)，两边都 !important——2026-10-10 ocr 评审：原先
   (0,3,1) 输给通用规则，选中 tab 悬停照样闪灰，豁免是死 CSS）。 */
button[data-hover][data-selected]:not([data-hover="primary"]):not([data-hover="close"]):not(:disabled):hover {
  background: var(--yt-accent-bg) !important;
}
button[data-hover][data-selected]:not([data-hover="primary"]):not([data-hover="close"]):not(:disabled):active {
  background: var(--yt-accent-bg) !important;
}
/* The solid accent face brightens/darkens with the scheme instead of
   trading its accent for a neutral surface. */
button[data-hover="primary"]:hover {
  filter: brightness(0.94);
}
body[data-ds-dark-theme] button[data-hover="primary"]:hover {
  filter: brightness(1.1);
}
button[data-hover="primary"]:active {
  filter: brightness(0.88);
}
button[data-hover="close"]:hover {
  background: transparent !important;
  color: var(--yt-text-primary) !important;
}
/* 2026-10-09 第二轮评审 P1-A：hover 覆盖由 tests/hover-gate.client.spec.ts
   门禁保证（每个 <button> 必须携带 data-hover），此前的 [data-row-menu]
   作用域规则与之重复，随门禁一并退役。 */
/* 2026-10-09 第三轮评审 P1：role="button" 的可点击行（调度行等）在此前
   只有收件箱 pane 拿到治疗——同样的行，一处有声一处无声。门禁（hover-gate）
   只扫 <button> 标签看不到它们，故这里全局兜底。
   2026-10-10 ocr 评审：!important 压得过选中行的内联 accent 样式，悬停
   选中调度行视觉上「取消选中」——选中行以 data-selected 豁免（SchedulePane
   负责标注），兜底只管未选中的行。 */
[role="button"][tabindex]:not([data-selected]):hover {
  background: var(--yt-surface-secondary) !important;
}
[role="button"][tabindex]:not([data-selected]):active {
  background: var(--yt-border-subtle) !important;
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
