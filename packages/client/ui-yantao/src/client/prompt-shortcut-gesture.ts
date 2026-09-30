/**
 * The `/` source for prompt shortcuts (ADR-0040 决定 5/7).
 *
 * The 惯用提示词 are the human's own favorite slash combos: `/alias` expands
 * to its stored text by the agent's reading of the injected 惯用提示词
 * section — the same pre-step mechanics as every skill gesture. This source
 * is that gesture's autocomplete for the saved favorites: pinned to the top
 * of the `/` menu (order −10, above ui-commands' 0 and ui-skill's 2), and a
 * pick inserts the plain `/alias ` token exactly like the capability source.
 *
 * Deliberately no `matchEnter`/`matchSpace`: the alias is prose the host
 * pre-step expands, not a client claim, so enter keeps its existing masters
 * (the same stance as {@link ../capability-gesture.ts}).
 * @module @deepseek-ai/dsh-client-ui-yantao/prompt-shortcut-gesture
 */
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { PromptShortcutLister } from './remote.ts'

/** Cap on rows offered at once: the menu is a picker, not a browser. */
const LIMIT = 20

/**
 * Build the `/` source over the saved prompt shortcuts.
 * @param list - the shortcut loader (`yantaoKb.promptShortcutList`).
 * @returns the source, ready for `inputTriggers.registerSource`.
 */
export function promptShortcutSource(list: PromptShortcutLister): InputTriggerSource {
  return {
    trigger: '/',
    name: 'prompt-shortcut',
    // Pinned above the command (0) and skill (2) groups: these are the
    // human's own habits, the rows they reach for first.
    order: -10,
    async candidates(_session, { query, signal }) {
      const { shortcuts } = await list()
      if (signal.aborted) return []
      const needle = query.trim().toLocaleLowerCase()
      return shortcuts
        .filter(shortcut => needle === ''
          || shortcut.alias.toLocaleLowerCase().includes(needle)
          || shortcut.text.toLocaleLowerCase().includes(needle))
        .slice(0, LIMIT)
        .map(shortcut => ({
          name: shortcut.alias,
          description: shortcut.text,
          section: '惯用',
        }))
    },
    onPick({ candidate }) {
      // Plain text, not a chip: the alias is a prose convention the
      // controller's pre-step and the injected section both read.
      return { text: `/${candidate.name} ` }
    },
  }
}
