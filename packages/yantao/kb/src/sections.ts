/**
 * The yantao prompt sections layered over dsh's system-prompt registry
 * (ADR-0022): the content source is the Markdown files in
 * `prompt/sections/`, read once at plugin init and registered as static
 * sections. Editing a file changes the prompt on the next host start —
 * no rebuild — which is the layer's whole point.
 * @module sections
 */

import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { readGlobalMemoryEntries, renderGlobalMemorySection } from './memory.ts'
import { readPromptShortcutsSync, renderPromptShortcutsSection } from './prompt-shortcuts.ts'

/** One prompt section this plugin contributes. */
export interface YantaoSection {
  /** Registry section name (namespaced, shadowable by a scoped section). */
  readonly name: string
  /** Placement: after the deployment persona (0), before dsh's policy/tool sections (500+). */
  readonly order: number
  /** File name under `prompt/sections/`. */
  readonly file: string
}

/**
 * The static yantao sections, in reading order. Orders sit in the 100–200
 * band: persona is 0, dsh's PLAN_POLICY is 500 and its tool sections start
 * at 1000 (`packages/core/system-prompt/src/index.ts` SECTION_ORDERS).
 * `yantao:filesystem` (120) used to be the fourth static; ADR-0042 made it
 * a dynamic section so the prompt states the live KB root — see
 * {@link FILESYSTEM_SECTION}.
 */
export const YANTAO_SECTIONS: readonly YantaoSection[] = [
  { name: 'yantao:philosophy', order: 100, file: 'philosophy.md' },
  { name: 'yantao:memory', order: 140, file: 'memory.md' },
  { name: 'yantao:skills', order: 160, file: 'skills.md' },
] as const

/**
 * Read one section's Markdown. Both `src/index.ts` and the bundled
 * `lib/index.js` sit one level under the package root, so the same
 * relative URL resolves in vitest and in the built host (the pattern
 * proven by the controller's `builtin.ts`). A missing file throws —
 * a packaging hole must shrink the prompt loudly, not silently.
 * @param file - the section file name under `prompt/sections/`.
 * @returns the file's full text.
 */
export function loadSectionText(file: string): string {
  return readFileSync(new URL(`../prompt/sections/${file}`, import.meta.url), 'utf8')
}

/**
 * The filesystem section (ADR-0042): same `filesystem.md` source as the
 * other disciplines, but rendered per assembly so the one `{{kbRoot}}`
 * placeholder resolves to the live root — the section is where the agent
 * learns what 「资源」 refers to by default, and the absolute path grounds
 * that lesson. A root retarget lands on the next step, no rebuild.
 */
export const FILESYSTEM_SECTION = { name: 'yantao:filesystem', order: 120 } as const

/**
 * The dynamic section (ADR-0022 增补, sanctioned by ADR-0032 决定 4): unlike
 * the four static disciplines, its text is a provider evaluated at every
 * assembly, so the global behavior memory the human approved across runs is
 * reflected on the next step without any rebuild. Placement follows the
 * static `yantao:memory` (140) — identity → disciplines → accumulated
 * behavior → skills.
 */
export const BEHAVIOR_MEMORY_SECTION = { name: 'yantao:behavior-memory', order: 150 } as const

/**
 * The prompt-shortcuts section (ADR-0040 决定 5): the human's favorite slash
 * aliases, injected so the agent — the expansion authority for every entry
 * point — recognizes a hand-typed `/alias` too. Placement follows the
 * behavior memory (150), before the skills discipline (160).
 */
export const PROMPT_SHORTCUTS_SECTION = { name: 'yantao:prompt-shortcuts', order: 155 } as const

/**
 * The clock section: the agent has no clock of its own — without this line it
 * cannot resolve relative dates («今晚», «明天») into calendar days, and every
 * dated artifact it drafts is a guess. Evaluated at every assembly, so a
 * midnight rollover is honored on the next step with zero rebuild. Placement
 * precedes the filesystem discipline (120): the date is ground truth the
 * disciplines build on.
 */
export const CLOCK_SECTION = { name: 'yantao:clock', order: 110 } as const

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const

/**
 * Render the clock line for a given instant — a pure function so tests pin
 * the format. Output is a single line, e.g. 「今天是 2026年10月17日 星期六。」
 */
export function renderClockLine(now: Date): string {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const d = now.getDate()
  const weekday = WEEKDAY_ZH[now.getDay()]
  return `今天是 ${y}年${m}月${d}日 星期${weekday}。`
}

/**
 * Register the filesystem section (ADR-0042): the static disciplines'
 * `filesystem.md` with `{{kbRoot}}` resolved against the live root on every
 * assembly, so a `setRoot` retarget is honored without re-registering.
 * @param ctx - the mounting plugin context (needs `effect` and `systemPrompt`).
 * @param root - the live KB root, read per assembly.
 */
export function registerFilesystemSection(ctx: Context, root: () => string): void {
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: FILESYSTEM_SECTION.name,
      order: FILESYSTEM_SECTION.order,
      text: () => loadSectionText('filesystem.md').replaceAll('{{kbRoot}}', root()),
    }),
    `yantao-kb: register dynamic prompt section ${FILESYSTEM_SECTION.name}`,
  )
}

/**
 * Register the dynamic behavior-memory section. The provider reads
 * `<kbRoot>/.dsh/yantao/memory/global.md` through the live-root getter on
 * every assembly, so a `setRoot` retarget is honored without re-registering.
 * @param ctx - the mounting plugin context (needs `effect` and `systemPrompt`).
 * @param root - the live KB root, read per assembly.
 */
export function registerBehaviorMemorySection(ctx: Context, root: () => string): void {
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: BEHAVIOR_MEMORY_SECTION.name,
      order: BEHAVIOR_MEMORY_SECTION.order,
      text: () => renderGlobalMemorySection(readGlobalMemoryEntries(root())),
    }),
    `yantao-kb: register dynamic prompt section ${BEHAVIOR_MEMORY_SECTION.name}`,
  )
}

/**
 * Register the prompt-shortcuts section (ADR-0040 决定 5). Like the behavior
 * memory, the provider re-reads `<kbRoot>/.dsh/yantao/prompt-shortcuts.json`
 * on every assembly, so a UI save lands on the agent's next step. A corrupt
 * store degrades to an empty section — the prompt must not die because the
 * human's hand edit broke the JSON; the UI's own read reports the error
 * loudly instead.
 * @param ctx - the mounting plugin context (needs `effect` and `systemPrompt`).
 * @param root - the live KB root, read per assembly.
 */
export function registerPromptShortcutsSection(ctx: Context, root: () => string): void {
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: PROMPT_SHORTCUTS_SECTION.name,
      order: PROMPT_SHORTCUTS_SECTION.order,
      text: () => {
        try {
          return renderPromptShortcutsSection(readPromptShortcutsSync(root()))
        } catch {
          return ''
        }
      },
    }),
    `yantao-kb: register dynamic prompt section ${PROMPT_SHORTCUTS_SECTION.name}`,
  )
}

/**
 * Register the clock section: a one-line date stamp re-evaluated at every
 * assembly. The provider cannot realistically throw, but the guard keeps a
 * hostile `Date` override from killing prompt assembly outright.
 * @param ctx - the mounting plugin context (needs `effect` and `systemPrompt`).
 */
export function registerClockSection(ctx: Context): void {
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: CLOCK_SECTION.name,
      order: CLOCK_SECTION.order,
      text: () => {
        try {
          return renderClockLine(new Date())
        } catch {
          return ''
        }
      },
    }),
    `yantao-kb: register dynamic prompt section ${CLOCK_SECTION.name}`,
  )
}

/**
 * Register every yantao section in the calling context's scope. Each
 * registration is a cordis effect, so plugin disposal unregisters the
 * section. Static text, read once — the ADR-0022 layer is per-boot, not
 * per-step.
 * @param ctx - the mounting plugin context (needs `effect` and `systemPrompt`).
 */
export function registerPromptSections(ctx: Context): void {
  for (const section of YANTAO_SECTIONS) {
    ctx.effect(
      () => ctx.systemPrompt.section({ name: section.name, order: section.order, text: loadSectionText(section.file) }),
      `yantao-kb: register prompt section ${section.name}`,
    )
  }
}
