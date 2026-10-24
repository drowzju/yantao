/**
 * Workbench keyboard commands register through the shared shortcuts service
 * (bench: the real ShortcutRegistry, a stub ctx.shortcuts) and fire into the
 * panel seat the frame fills on mount.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ShortcutCommand, ShortcutFixedInput, ShortcutGesture, ShortcutPlatform } from '@deepseek-ai/dsh-client-shortcuts/client'
import { ShortcutRegistry } from '../../shortcuts/src/client/registry.ts'
import { PROPOSAL_VERDICT_KEYS, WORKBENCH_TAB_JUMPS, installWorkbenchShortcuts } from '../src/client/shortcuts.ts'
import { proposalVerdictSeat } from '../src/client/proposal-verdict-seat.ts'
import { inboxSeat } from '../src/client/inbox-seat.ts'
import { type PanelToggles } from '../src/client/frame/layout.ts'
import { WORKBENCH_NS, en, zh } from '../src/client/locales.ts'

const context = { region: 'page', modal: null, target: null } as const
/** Ctrl+chord by default; pass `{ shift: true }` for the two-modifier chords. */
const key = (code: string, rest: Partial<ShortcutGesture> = {}): ShortcutGesture => ({
  code, control: true, alt: false, shift: false, meta: false, repeat: false,
  composing: false, defaultPrevented: false, ...rest,
})

/** A panel seat that records every call instead of driving the frame. */
function recordPanels() {
  const tabs: string[] = []
  const config: boolean[] = []
  const panels: PanelToggles = {
    toggleIntake: () => {},
    activateTab: (tab) => { tabs.push(tab) },
    setConfigOpen: (open) => { config.push(open) },
  }
  return { panels, tabs, config }
}

async function bench(runtime: 'web' | 'desktop' = 'web', platform: ShortcutPlatform = 'windows') {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const registry = new ShortcutRegistry(runtime, platform)
  const commands = new Map<string, ShortcutCommand>()
  let fixedListener: ((input: ShortcutFixedInput) => void) | null = null
  ctx.provide('shortcuts', {
    register: (command: ShortcutCommand) => {
      commands.set(command.id, command)
      return registry.register(command)
    },
    catalog: registry.catalog,
    registerFixed: (command: Parameters<typeof registry.registerFixed>[0]) => registry.registerFixed(command),
    observeFixedInput: (listener: (input: ShortcutFixedInput) => void) => {
      fixedListener = listener
      return () => { fixedListener = null }
    },
  })
  const locale = new LocaleRuntime(ctx)
  locale.register(WORKBENCH_NS, { zh, en })
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const recorded = recordPanels()
  const fiber = ctx.plugin((scoped) => {
    installWorkbenchShortcuts(scoped, recorded.panels, locale.bind(WORKBENCH_NS))
  })
  await fiber.await()
  /** Deliver one fixed-input keystroke to the observed listener. */
  const fireFixed = (input: ShortcutFixedInput): void => { fixedListener?.(input) }
  return { ctx, fiber, registry, commands, fireFixed, ...recorded }
}

afterEach(() => { vi.restoreAllMocks() })

describe('workbench keyboard commands', () => {
  it('registers the six commands in table order, each with a binding', async () => {
    const b = await bench()
    expect(b.registry.catalog.getSnapshot().map(row => row.id)).toEqual([
      ...WORKBENCH_TAB_JUMPS.map(jump => `yantao.tab.${jump.tail}`),
      'yantao.config.open',
      'yantao.inbox.next',
    ])
    expect(b.registry.catalog.getSnapshot().every(row => row.keys.length > 0)).toBe(true)
  })

  it('binds Ctrl+digit jumps and Ctrl+Shift config on web/windows, Cmd+Opt chords on desktop/macos', async () => {
    const b = await bench()
    expect(b.registry.catalog.getSnapshot().map(row => row.aria)).toEqual([
      'Control+1', 'Control+2', 'Control+3', 'Control+4', 'Control+Shift+,', 'Control+Shift+.',
    ])
    const mac = await bench('desktop', 'macos')
    expect(mac.registry.catalog.getSnapshot().map(row => row.keys)).toEqual([
      ['⌥', '⌘', '1'], ['⌥', '⌘', '2'], ['⌥', '⌘', '3'], ['⌥', '⌘', '4'], ['⌥', '⌘', ','], ['⌥', '⌘', '.'],
    ])
  })

  it('jumps tabs and opens config through the panel seat, from page and editable regions', async () => {
    const b = await bench()
    const consume = vi.fn()
    expect(b.registry.dispatch(key('Digit1'), context, consume)).toMatchObject({ status: 'handled', commandId: 'yantao.tab.conversation' })
    expect(b.registry.dispatch(key('Digit3'), { ...context, region: 'editable' }, consume))
      .toMatchObject({ status: 'handled', commandId: 'yantao.tab.insights' })
    expect(b.registry.dispatch(key('Digit4'), context, consume))
      .toMatchObject({ status: 'handled', commandId: 'yantao.tab.inbox' })
    expect(b.tabs).toEqual(['conversation', 'insights', 'inbox'])
    expect(b.registry.dispatch(key('Comma', { shift: true }), context, consume).commandId).toBe('yantao.config.open')
    expect(b.config).toEqual([true])
  })

  it('jumps to the next undecided proposal: inbox first, then the pane seat', async () => {
    const b = await bench()
    const next = vi.fn()
    inboxSeat.current = next
    onTestFinished(() => { inboxSeat.current = null })
    const consume = vi.fn()
    expect(b.registry.dispatch(key('Period', { shift: true }), context, consume))
      .toMatchObject({ status: 'handled', commandId: 'yantao.inbox.next' })
    expect(b.tabs).toEqual(['inbox'])
    expect(next).toHaveBeenCalledOnce()
  })

  it('blocks while a modal is open and passes composed input through', async () => {
    const b = await bench()
    const consume = vi.fn()
    expect(b.registry.dispatch(key('Digit1'), { ...context, modal: 'settings' }, consume))
      .toMatchObject({ status: 'blocked', commandId: 'yantao.tab.conversation', reason: 'modal' })
    expect(consume).toHaveBeenCalledOnce()
    expect(b.registry.dispatch(key('Digit1', { composing: true }), context, consume)).toEqual({ status: 'pass' })
    expect(b.tabs).toEqual([])
  })

  it('drops every registration with the plugin fiber', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.registry.catalog.getSnapshot()).toEqual([])
  })

  it('leaves web/linux unbound — the browser whitelist has no branch for these chords there', async () => {
    const b = await bench('web', 'linux')
    expect(b.registry.catalog.getSnapshot().map(row => row.id)).toEqual([
      ...WORKBENCH_TAB_JUMPS.map(jump => `yantao.tab.${jump.tail}`),
      'yantao.config.open',
      'yantao.inbox.next',
    ])
    expect(b.registry.catalog.getSnapshot().every(row => row.keys.length === 0 && row.aria === undefined)).toBe(true)
  })
})

describe('WORKBENCH_TAB_JUMPS', () => {
  it('is pure data: four jumps over Digit1..Digit4 onto distinct tabs (ADR-0057)', () => {
    expect(WORKBENCH_TAB_JUMPS).toHaveLength(4)
    expect(WORKBENCH_TAB_JUMPS.map(jump => jump.code)).toEqual(['Digit1', 'Digit2', 'Digit3', 'Digit4'])
    expect(new Set(WORKBENCH_TAB_JUMPS.map(jump => jump.tab)).size).toBe(4)
  })
})

describe('proposal verdict fixed keys (2026-10-12 评审 P2-1)', () => {
  /** A bare keystroke (no modifiers) as the DOM adapter would deliver it. */
  const bare = (code: string, rest: Partial<ShortcutGesture> = {}): ShortcutGesture => ({
    code, control: false, alt: false, shift: false, meta: false, repeat: false,
    composing: false, defaultPrevented: false, ...rest,
  })

  it('registers the four fixed commands in the approval group, reserving their bare keys', async () => {
    const b = await bench()
    const rows = b.registry.fixedCatalog.getSnapshot().filter(row => row.id.startsWith('yantao.proposal.'))
    expect(rows.map(row => row.id)).toEqual(PROPOSAL_VERDICT_KEYS.map(verdict => `yantao.proposal.${verdict.tail}`))
    expect(rows.every(row => row.group === 'approval')).toBe(true)
    expect(rows.map(row => row.keys)).toEqual([['J'], ['K'], ['Space'], ['Enter']])
    // The reservation keeps editable commands off these keys.
    expect(b.registry.definitions().filter(def => def.id.startsWith('yantao.proposal.')).every(def => def.fixed !== undefined)).toBe(true)
  })

  it('fires the seat handler for proposal-modal page input and consumes it', async () => {
    const b = await bench()
    const handler = { moveDown: vi.fn(), moveUp: vi.fn(), toggleTick: vi.fn(), confirmWrite: vi.fn() }
    proposalVerdictSeat.current = handler
    onTestFinished(() => { proposalVerdictSeat.current = null })
    const consume = vi.fn()
    b.fireFixed({ type: 'keydown', gesture: bare('KeyJ'), context: { ...context, modal: 'proposal' }, consume })
    b.fireFixed({ type: 'keydown', gesture: bare('KeyK'), context: { ...context, modal: 'proposal' }, consume })
    b.fireFixed({ type: 'keydown', gesture: bare('Space'), context: { ...context, modal: 'proposal' }, consume })
    b.fireFixed({ type: 'keydown', gesture: bare('Enter'), context: { ...context, modal: 'proposal' }, consume })
    expect(handler.moveDown).toHaveBeenCalledOnce()
    expect(handler.moveUp).toHaveBeenCalledOnce()
    expect(handler.toggleTick).toHaveBeenCalledOnce()
    expect(handler.confirmWrite).toHaveBeenCalledOnce()
    expect(consume).toHaveBeenCalledTimes(4)
  })

  it('ignores other modals, editable regions, modifier chords, and foreign keys', async () => {
    const b = await bench()
    const handler = { moveDown: vi.fn(), moveUp: vi.fn(), toggleTick: vi.fn(), confirmWrite: vi.fn() }
    proposalVerdictSeat.current = handler
    onTestFinished(() => { proposalVerdictSeat.current = null })
    const consume = vi.fn()
    b.fireFixed({ type: 'keydown', gesture: bare('KeyJ'), context: { ...context, modal: 'settings' }, consume })
    b.fireFixed({ type: 'keydown', gesture: bare('KeyJ'), context: { ...context, modal: 'proposal', region: 'editable' }, consume })
    b.fireFixed({ type: 'keydown', gesture: bare('KeyJ', { control: true }), context: { ...context, modal: 'proposal' }, consume })
    b.fireFixed({ type: 'keydown', gesture: bare('KeyL'), context: { ...context, modal: 'proposal' }, consume })
    expect(consume).not.toHaveBeenCalled()
    expect(handler.moveDown).not.toHaveBeenCalled()
  })

  it('lets J/K repeat but not Space/Enter, and drops the seat with the fiber', async () => {
    const b = await bench()
    const handler = { moveDown: vi.fn(), moveUp: vi.fn(), toggleTick: vi.fn(), confirmWrite: vi.fn() }
    proposalVerdictSeat.current = handler
    onTestFinished(() => { proposalVerdictSeat.current = null })
    const consume = vi.fn()
    b.fireFixed({ type: 'keydown', gesture: bare('KeyJ', { repeat: true }), context: { ...context, modal: 'proposal' }, consume })
    b.fireFixed({ type: 'keydown', gesture: bare('Space', { repeat: true }), context: { ...context, modal: 'proposal' }, consume })
    expect(handler.moveDown).toHaveBeenCalledOnce()
    expect(handler.toggleTick).not.toHaveBeenCalled()
    await b.fiber.dispose()
    b.fireFixed({ type: 'keydown', gesture: bare('KeyJ'), context: { ...context, modal: 'proposal' }, consume })
    expect(handler.moveDown).toHaveBeenCalledOnce()
  })

  it('stays silent when no card occupies the seat', async () => {
    const b = await bench()
    const consume = vi.fn()
    b.fireFixed({ type: 'keydown', gesture: bare('KeyJ'), context: { ...context, modal: 'proposal' }, consume })
    expect(consume).not.toHaveBeenCalled()
  })
})
