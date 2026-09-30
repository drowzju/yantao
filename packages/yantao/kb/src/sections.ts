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
 * The four yantao sections, in reading order. Orders sit in the 100–200
 * band: persona is 0, dsh's PLAN_POLICY is 500 and its tool sections start
 * at 1000 (`packages/core/system-prompt/src/index.ts` SECTION_ORDERS).
 */
export const YANTAO_SECTIONS: readonly YantaoSection[] = [
  { name: 'yantao:philosophy', order: 100, file: 'philosophy.md' },
  { name: 'yantao:filesystem', order: 120, file: 'filesystem.md' },
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
