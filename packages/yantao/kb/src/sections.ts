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
