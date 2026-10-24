/**
 * Workbench keyboard commands (batch one of the keyboard-efficiency pass):
 * four centre-tab jumps (ADR-0057 collapsed the six-tab strip to three, then
 * 2026-10-23 added 提议 on the vacant Digit4 — Digit5-6 stay vacant rather
 * than carrying two-step sub-region semantics)
 * and the config dialog — registered through the shared shortcuts framework
 * (the same registry ui-workspace contributes to), never a bespoke keydown
 * listener. The proposal card's verdict keys (J/K/Space/Enter, 2026-10-12
 * 评审 P2-1) ride the same framework's fixed-command path: bare keys the web
 * whitelist refuses for editable commands, forwarded to the mounted card
 * through the {@link ./proposal-verdict-seat.ts} seat.
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
 *
 * 注意：registerFixed 的裁决键进的是注册表的 fixedCatalog，不是 catalog
 * （2026-10-14 快捷键目录缺 J/K/空格/回车 的病灶）——读面要订两个目录。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ShortcutCommand, ShortcutCommandId, ShortcutFixedInput } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'
import type { PanelToggles } from './frame/layout.ts'
import { CONVERSATION_TAB, INBOX_TAB, INSIGHTS_TAB, TASKS_TAB } from './tabs.ts'
import { PROPOSAL_MODAL_ID, proposalVerdictSeat, type ProposalVerdictHandler } from './proposal-verdict-seat.ts'

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

/** The four tab jumps in Digit1..Digit4 order — pure data, asserted in tests.
    提议 补 Digit4（2026-10-23 评审 P2）：它是常驻且不可关的一等页签，此前
    唯一只能靠鼠标点的固定页签；Digit4 在 ADR-0057 平铺化后一直空着。 */
export const WORKBENCH_TAB_JUMPS: readonly WorkbenchTabJump[] = [
  { tail: 'conversation', labelKey: 'center.conversation', aliases: ['go to conversation'], code: 'Digit1', tab: CONVERSATION_TAB },
  { tail: 'tasks', labelKey: 'center.tasks', aliases: ['go to tasks'], code: 'Digit2', tab: TASKS_TAB },
  { tail: 'insights', labelKey: 'center.insights', aliases: ['go to insights'], code: 'Digit3', tab: INSIGHTS_TAB },
  { tail: 'inbox', labelKey: 'center.inbox', aliases: ['go to proposals', 'inbox'], code: 'Digit4', tab: INBOX_TAB },
]

/**
 * One proposal-verdict fixed key (2026-10-12 评审 P2-1 批次一)：bare keys the
 * web whitelist refuses for editable commands, so they ride the fixed-command
 * path instead — owner-arbitrated local input, reserved against editable
 * bindings, surfaced in the catalog's `approval` group. Pure data, asserted
 * in tests.
 */
export interface ProposalVerdictKey {
  /** Command-id tail after `yantao.proposal.`. */
  readonly tail: string
  /** Label key in the workbench dictionary. */
  readonly labelKey: WorkbenchLocaleKey
  /** Readable keycap for the fixed catalog. */
  readonly keycap: string
  /** Physical key code. */
  readonly code: string
  /** The seat method the keystroke fires. */
  readonly action: keyof ProposalVerdictHandler
}

/** The four verdict keys in vim-adjacent order — J/K move, Space ticks, Enter confirms. */
export const PROPOSAL_VERDICT_KEYS: readonly ProposalVerdictKey[] = [
  { tail: 'cursor-down', labelKey: 'shortcut.proposalCursorDown', keycap: 'J', code: 'KeyJ', action: 'moveDown' },
  { tail: 'cursor-up', labelKey: 'shortcut.proposalCursorUp', keycap: 'K', code: 'KeyK', action: 'moveUp' },
  { tail: 'tick', labelKey: 'shortcut.proposalTick', keycap: 'Space', code: 'Space', action: 'toggleTick' },
  { tail: 'confirm', labelKey: 'shortcut.proposalConfirm', keycap: 'Enter', code: 'Enter', action: 'confirmWrite' },
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

  // 提案裁决键（批次一）：固定键走 approval 组注册并预约占位；真正的裁决
  // 动作由挂载中的提案卡通过座位应答——卡片不在，键就是哑弹。只认提案卡
  // 模态顶层的 page 区域输入：输入框里照常打字，聚焦的勾选框保留原生
  // Space/Enter 行为，不会双重触发。
  for (const verdict of PROPOSAL_VERDICT_KEYS) {
    ctx.effect(() => ctx.shortcuts.registerFixed({
      id: `yantao.proposal.${verdict.tail}` as ShortcutCommandId,
      label: () => t(verdict.labelKey),
      keys: [verdict.keycap],
      bindings: [{ code: verdict.code, modifiers: [] }],
      group: 'approval',
    }), `ui-yantao: yantao.proposal.${verdict.tail}`)
  }
  ctx.effect(() => ctx.shortcuts.observeFixedInput((input: ShortcutFixedInput) => {
    if (input.type !== 'keydown') return
    const { gesture, context, consume } = input
    // 长按连发只留给移动；Space/Enter 各按一次只做一件事。
    const moves = gesture.code === 'KeyJ' || gesture.code === 'KeyK'
    if (gesture.composing || (gesture.repeat && !moves)) return
    if (gesture.control || gesture.alt || gesture.shift || gesture.meta) return
    if (context.modal !== PROPOSAL_MODAL_ID || context.region !== 'page') return
    const verdict = PROPOSAL_VERDICT_KEYS.find(candidate => candidate.code === gesture.code)
    const handler = proposalVerdictSeat.current
    if (verdict === undefined || handler === null) return
    consume()
    handler[verdict.action]()
  }), 'ui-yantao: proposal verdict fixed input')
}
