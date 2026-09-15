/**
 * The `/` source for KB capabilities (ADR-0025 决定 6).
 *
 * The controller's pre-step already answers a message **opening** with
 * `/name` by injecting the named capability's SKILL.md body (决定 3); this
 * source is that gesture's autocomplete: typing `/` offers the capabilities
 * the gesture recognizes — instruction-type and human-invocable ones — and a
 * pick inserts the plain `/name ` token into the draft.
 *
 * Deliberately no `matchEnter`/`matchSpace`: those hooks are first-claim-wins
 * in registration order, and defining one would contest ui-commands' command
 * adjudication. The menu is completion only; the enter key keeps its existing
 * masters.
 * @module @deepseek-ai/dsh-client-ui-yantao/capability-gesture
 */
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { CapabilityLoader } from './remote.ts'

/** Cap on rows offered at once: the menu is a picker, not a browser. */
const LIMIT = 40

/**
 * Build the `/` source over the capability list.
 * @param list - the capability loader (`yantaoKb.capabilityList`).
 * @returns the source, ready for `inputTriggers.registerSource`.
 */
export function capabilityGestureSource(list: CapabilityLoader): InputTriggerSource {
  return {
    trigger: '/',
    name: 'capability',
    async candidates(_session, { query, signal }) {
      const { capabilities } = await list()
      if (signal.aborted) return []
      const needle = query.trim().toLocaleLowerCase()
      return capabilities
        .filter(capability => capability.entry === undefined && capability.invocation.includes('human'))
        .filter(capability => needle === ''
          || capability.name.toLocaleLowerCase().includes(needle)
          || capability.description.toLocaleLowerCase().includes(needle))
        .slice(0, LIMIT)
        .map(capability => ({
          name: capability.name,
          description: capability.description,
          section: '能力',
        }))
    },
    onPick({ candidate }) {
      // Plain text, not a chip: the gesture is a prose convention the
      // controller's pre-step reads off the message's first text block.
      return { text: `/${candidate.name} ` }
    },
  }
}
