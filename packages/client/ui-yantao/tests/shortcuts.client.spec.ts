/**
 * Workbench keyboard commands register through the shared shortcuts service
 * (bench: the real ShortcutRegistry, a stub ctx.shortcuts) and fire into the
 * panel seat the frame fills on mount.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ShortcutCommand, ShortcutGesture, ShortcutPlatform } from '@deepseek-ai/dsh-client-shortcuts/client'
import { ShortcutRegistry } from '../../shortcuts/src/client/registry.ts'
import { WORKBENCH_TAB_JUMPS, installWorkbenchShortcuts } from '../src/client/shortcuts.ts'
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
  ctx.provide('shortcuts', { register: (command: ShortcutCommand) => {
    commands.set(command.id, command)
    return registry.register(command)
  }, catalog: registry.catalog })
  const locale = new LocaleRuntime(ctx)
  locale.register(WORKBENCH_NS, { zh, en })
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const recorded = recordPanels()
  const fiber = ctx.plugin((scoped) => {
    installWorkbenchShortcuts(scoped, recorded.panels, locale.bind(WORKBENCH_NS))
  })
  await fiber.await()
  return { ctx, fiber, registry, commands, ...recorded }
}

afterEach(() => { vi.restoreAllMocks() })

describe('workbench keyboard commands', () => {
  it('registers the four commands in table order, each with a binding', async () => {
    const b = await bench()
    expect(b.registry.catalog.getSnapshot().map(row => row.id)).toEqual([
      ...WORKBENCH_TAB_JUMPS.map(jump => `yantao.tab.${jump.tail}`),
      'yantao.config.open',
    ])
    expect(b.registry.catalog.getSnapshot().every(row => row.keys.length > 0)).toBe(true)
  })

  it('binds Ctrl+digit jumps and Ctrl+Shift config on web/windows, Cmd+Opt chords on desktop/macos', async () => {
    const b = await bench()
    expect(b.registry.catalog.getSnapshot().map(row => row.aria)).toEqual([
      'Control+1', 'Control+2', 'Control+3', 'Control+Shift+,',
    ])
    const mac = await bench('desktop', 'macos')
    expect(mac.registry.catalog.getSnapshot().map(row => row.keys)).toEqual([
      ['⌥', '⌘', '1'], ['⌥', '⌘', '2'], ['⌥', '⌘', '3'], ['⌥', '⌘', ','],
    ])
  })

  it('jumps tabs and opens config through the panel seat, from page and editable regions', async () => {
    const b = await bench()
    const consume = vi.fn()
    expect(b.registry.dispatch(key('Digit1'), context, consume)).toMatchObject({ status: 'handled', commandId: 'yantao.tab.conversation' })
    expect(b.registry.dispatch(key('Digit3'), { ...context, region: 'editable' }, consume))
      .toMatchObject({ status: 'handled', commandId: 'yantao.tab.insights' })
    expect(b.tabs).toEqual(['conversation', 'insights'])
    expect(b.registry.dispatch(key('Comma', { shift: true }), context, consume).commandId).toBe('yantao.config.open')
    expect(b.config).toEqual([true])
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
    ])
    expect(b.registry.catalog.getSnapshot().every(row => row.keys.length === 0 && row.aria === undefined)).toBe(true)
  })
})

describe('WORKBENCH_TAB_JUMPS', () => {
  it('is pure data: three jumps over Digit1..Digit3 onto distinct tabs (ADR-0057)', () => {
    expect(WORKBENCH_TAB_JUMPS).toHaveLength(3)
    expect(WORKBENCH_TAB_JUMPS.map(jump => jump.code)).toEqual(['Digit1', 'Digit2', 'Digit3'])
    expect(new Set(WORKBENCH_TAB_JUMPS.map(jump => jump.tab)).size).toBe(3)
  })
})
