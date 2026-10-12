/**
 * Workbench keyboard commands (batch one of the keyboard-efficiency pass):
 * three centre-tab jumps (ADR-0057 collapsed the six-tab strip to three;
 * Digit4-6 sit vacant rather than carrying two-step sub-region semantics)
 * and the config dialog — registered through the shared shortcuts framework
 * (the same registry ui-workspace contributes to), never a bespoke keydown
 * listener.
 *
 * Bindings follow the ruling that yantao's desktop shell has no keyboard
 * bridge, so the effective runtime is `web`. The tab jumps ride the
 * primary+digit branch of the web whitelist (single modifier, delivered in
 * the Electron shell where no browser tab-switcher competes for Ctrl+1..9):
 * Ctrl+1/2/3 on windows/linux, Cmd+1/2/3 on macOS. Every other command keeps
 * the two-modifier primary+shift chord — Ctrl+Shift+… on windows/linux,
 * Cmd+Opt+… on macOS (Cmd+Shift+3/4/5 belong to system screenshots).
 * `web:linux` stays unset — the browser binding whitelist has no branch for
 * either chord there, so declaring one would throw at registration; the
 * registry treats a missing profile as unbound.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ShortcutCommand, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'
import type { PanelToggles } from './frame/layout.ts'
import { CONVERSATION_TAB, INSIGHTS_TAB, TASKS_TAB } from './tabs.ts'

/** One centre-tab jump: the registry row and the tab it activates. */
export interface WorkbenchTabJump {
  /** Command-id tail after `yantao.tab.`. */
  readonly tail: string
  /** Label key in the workbench dictionary. */
  readonly labelKey: WorkbenchLocaleKey
  /** Free-text search aliases for the (future) shortcut directory. */
  readonly aliases: readonly string[]
  /** Physical key code. */
  readonly code: string
  /** Centre-tab key handed to `panels.activateTab`. */
  readonly tab: string
}

/** The three tab jumps in Digit1..Digit3 order — pure data, asserted in tests. */
export const WORKBENCH_TAB_JUMPS: readonly WorkbenchTabJump[] = [
  { tail: 'conversation', labelKey: 'center.conversation', aliases: ['go to conversation'], code: 'Digit1', tab: CONVERSATION_TAB },
  { tail: 'tasks', labelKey: 'center.tasks', aliases: ['go to tasks'], code: 'Digit2', tab: TASKS_TAB },
  { tail: 'insights', labelKey: 'center.insights', aliases: ['go to insights'], code: 'Digit3', tab: INSIGHTS_TAB },
]

/**
 * Register the workbench commands. Resolve always reports handled:
 * before the frame mounts the calls land on the panel seat's no-ops, the
 * same early-call-is-a-silent-no-op philosophy as `ctx.layout`.
 * @param ctx - plugin context with the shortcuts service injected.
 * @param panels - the panel seat the frame fills on mount.
 * @param t - the workbench translate face.
 */
export function installWorkbenchShortcuts(ctx: Context, panels: PanelToggles, t: WorkbenchT): void {
  const register = (id: string, label: () => string, aliases: readonly string[], code: string,
    chord: readonly ('primary' | 'alt' | 'shift')[], resolve: ShortcutCommand['resolve']): void => {
    ctx.effect(() => ctx.shortcuts.register({
      id: id as ShortcutCommandId, label, aliases, defaults: {
        'desktop:macos': { code, modifiers: ['primary', 'alt'] },
        'web:macos': { code, modifiers: ['primary', 'alt'] },
        'desktop:windows': { code, modifiers: [...chord] },
        'desktop:linux': { code, modifiers: [...chord] },
        'web:windows': { code, modifiers: [...chord] },
      },
      regions: ['page', 'editable'], modals: [], resolve,
    }), `ui-yantao: ${id}`)
  }
  for (const jump of WORKBENCH_TAB_JUMPS) {
    register(`yantao.tab.${jump.tail}`, () => t(jump.labelKey), jump.aliases, jump.code, ['primary'],
      () => ({ status: 'handled', run: () => { panels.activateTab(jump.tab) } }))
  }
  register('yantao.config.open', () => t('shortcut.configOpen'), ['open settings', 'config'], 'Comma',
    ['primary', 'shift'], () => ({ status: 'handled', run: () => { panels.setConfigOpen(true) } }))
}
