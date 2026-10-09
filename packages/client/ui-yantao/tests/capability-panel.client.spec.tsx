// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  KbCapabilityListResult, KbCapabilitySummary, KbUnregisteredSkill,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { CapabilityPanel, type CapabilityPanelProps } from '../src/client/CapabilityPanel.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const SUMMARY: KbCapabilitySummary = {
  name: 'mail',
  description: '读 Outlook 邮件',
  source: 'kb',
  directory: '/kb/.dsh/skills/mail',
  invocation: ['human', 'agent'],
}

const LISTED: KbCapabilityListResult = {
  capabilities: [SUMMARY],
  unregistered: [],
}

/** The panel's props, with spies standing in for the capability RPCs. */
function props(listed: KbCapabilityListResult = LISTED): CapabilityPanelProps {
  return {
    t,
    load: vi.fn(async () => listed),
    create: vi.fn(async () => ({ path: '.dsh/skills/new-one' })),
    adopt: vi.fn(async () => ({ path: '.dsh/skills/demo' })),
    register: vi.fn(async () => ({ path: '.dsh/skills/yantao.json' })),
    updateRoute: vi.fn(async () => ({ path: '.dsh/skills/yantao.json' })),
    unregister: vi.fn(async () => ({ path: '.dsh/skills/yantao.json' })),
    mail: (state: unknown) => <div data-mail-panel="true" data-mail-state={JSON.stringify(state) ?? undefined} />,
    loadShortcuts: vi.fn(async () => ({ shortcuts: [] })),
    saveShortcuts: vi.fn(),
    fillShortcut: vi.fn(),
  }
}

/** Open the inventory fold, then the detail view of the named capability. */
async function openDetail(name = 'mail'): Promise<void> {
  fireEvent.click(await screen.findByText(/能力清单/))
  fireEvent.click(await screen.findByText(name))
}

describe('CapabilityPanel 清单 (ADR-0052 决定 8)', () => {
  it('folds the inventory under the shortcuts, lists rows, and opens a detail on click', async () => {
    const panel = props()
    render(<CapabilityPanel {...panel} />)
    expect(await screen.findByText(/惯用提示词/)).toBeTruthy()
    // The inventory starts folded.
    expect(screen.queryByText('mail')).toBeNull()
    await openDetail()
    expect(panel.load).toHaveBeenCalledTimes(1)
    // The detail view replaced the list.
    expect(await screen.findByText('可达性')).toBeTruthy()
    expect(screen.getByText('读 Outlook 邮件')).toBeTruthy()
  })

  it('surfaces the 未注册 group: in-KB rows open registration, out-of-KB rows open adoption', async () => {
    const notesHelper: KbUnregisteredSkill = {
      name: 'notes-helper',
      description: 'KB 内技能',
      source: 'kb',
      userInvocable: true,
      flat: false,
      inKb: true,
      reason: '尚未注册：中央路由 .dsh/skills/yantao.json 里没有这个名字',
    }
    const demo: KbUnregisteredSkill = { name: 'demo', description: '外面', source: 'user', userInvocable: true, flat: false }
    const panel = props({ capabilities: [], unregistered: [notesHelper, demo] })
    const { container } = render(<CapabilityPanel {...panel} />)
    fireEvent.click(await screen.findByText(/能力清单/))
    expect(await screen.findByText('未注册技能（ADR-0025）')).toBeTruthy()
    // The in-KB row carries its reason.
    expect(screen.getByText('尚未注册：中央路由 .dsh/skills/yantao.json 里没有这个名字')).toBeTruthy()
    // The out-of-KB row opens the adoption confirm; adopting calls the RPC.
    fireEvent.click(screen.getByText('demo'))
    expect(await screen.findByText(/采纳「demo」？/)).toBeTruthy()
    fireEvent.click(screen.getByText('采纳', { exact: true }))
    await vi.waitFor(() =>{  expect(panel.adopt).toHaveBeenCalledWith('demo') })
    // The confirm folded away; the refreshed list no longer offers the row.
    await vi.waitFor(() =>{  expect(container.querySelector('[data-capability-confirm]')).toBeNull() })
  })

  it('registers an in-KB skill by writing its central route, with the reach checkboxes shaping the entry', async () => {
    const notesHelper: KbUnregisteredSkill = {
      name: 'notes-helper',
      description: 'KB 内技能',
      source: 'kb',
      userInvocable: true,
      flat: false,
      inKb: true,
      reason: '尚未注册：中央路由 .dsh/skills/yantao.json 里没有这个名字',
    }
    const panel = props({ capabilities: [], unregistered: [notesHelper] })
    const { container } = render(<CapabilityPanel {...panel} />)
    fireEvent.click(await screen.findByText(/能力清单/))
    fireEvent.click(await screen.findByText('notes-helper'))
    // The guided registration previews the route entry it will write.
    expect(await screen.findByText(/注册「notes-helper」为能力/)).toBeTruthy()
    expect(screen.getByText(/在 \.dsh\/skills\/yantao\.json 写入一条路由/)).toBeTruthy()
    expect(container.querySelector('[data-capability-register]')?.textContent).toContain('{"path":"notes-helper","invocation":["human"]}')
    // Flipping the agent reach widens the invocation in the preview…
    const agentBox = container.querySelector('[data-capability-register] input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(agentBox)
    expect(container.querySelector('[data-capability-register]')?.textContent).toContain('{"path":"notes-helper","invocation":["human","agent"]}')
    // …and the confirmed write carries it.
    fireEvent.click(screen.getByText('注册', { exact: true }))
    await vi.waitFor(() =>{  expect(panel.register).toHaveBeenCalledWith('notes-helper', { agentInvoke: true, resourceMenu: false, selectionMenu: false }) })
  })

  it('registers a plugin repository by extraction, previewing the first nested child', async () => {
    const repo: KbUnregisteredSkill = {
      name: 'repo',
      description: '插件仓库，内含技能：child-a、child-b',
      source: 'kb',
      directory: '/kb/.dsh/skills/repo',
      userInvocable: true,
      flat: false,
      inKb: true,
      plugin: true,
      pluginSkills: ['child-a', 'child-b'],
      reason: '插件仓库：顶层没有 SKILL.md，注册将在中央路由 .dsh/skills/yantao.json 为内含技能各写一条路由',
    }
    const panel = props({ capabilities: [], unregistered: [repo] })
    const { container } = render(<CapabilityPanel {...panel} />)
    fireEvent.click(await screen.findByText(/能力清单/))
    fireEvent.click(await screen.findByText('repo'))
    expect(await screen.findByText(/这是插件仓库/)).toBeTruthy()
    expect(container.querySelector('[data-capability-register]')?.textContent).toContain('{"path":"repo/skills/child-a","invocation":["human"]}')
    fireEvent.click(screen.getByText('注册', { exact: true }))
    await vi.waitFor(() =>{  expect(panel.register).toHaveBeenCalledWith('repo', { agentInvoke: false, resourceMenu: false, selectionMenu: false }) })
  })

  it('greyed rows do not open anything', async () => {
    const flat: KbUnregisteredSkill = {
      name: 'flat-one', description: '单文件', source: 'kb', userInvocable: true, flat: true, inKb: true,
      reason: '尚未注册：中央路由 .dsh/skills/yantao.json 里没有这个名字',
    }
    const panel = props({ capabilities: [], unregistered: [flat] })
    render(<CapabilityPanel {...panel} />)
    fireEvent.click(await screen.findByText(/能力清单/))
    fireEvent.click(await screen.findByText('flat-one'))
    // Nothing happened: no confirm, no register dialog, still on the list.
    expect(screen.queryByText(/注册「flat-one」为能力/)).toBeNull()
    expect(screen.queryByText(/采纳「flat-one」？/)).toBeNull()
  })

  it('scaffolds a new capability through the inline 新建 row', async () => {
    const panel = props()
    render(<CapabilityPanel {...panel} />)
    fireEvent.click(await screen.findByText(/能力清单/))
    fireEvent.click(screen.getByText('+ 新建能力'))
    const input = await screen.findByPlaceholderText('能力名称（如 paper-digest）')
    fireEvent.change(input, { target: { value: 'paper-digest' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() =>{  expect(panel.create).toHaveBeenCalledWith('paper-digest') })
  })

  it('renders a failed listing as an error line instead of a blank pane', async () => {
    const panel = props()
    ;(panel.load as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('还没有选择知识库目录，能力清单无处读取。'))
    const { container } = render(<CapabilityPanel {...panel} />)
    expect((await screen.findByText('还没有选择知识库目录，能力清单无处读取。'))).toBeTruthy()
    expect(container.querySelector('[data-capability-error]')).not.toBeNull()
  })

  it('opens the named capability when the frame reveals one', async () => {
    render(<CapabilityPanel {...props()} reveal={{ nonce: 1, capability: 'mail' }} />)
    // No clicks: the reveal alone lands on the detail view.
    expect(await screen.findByText('可达性')).toBeTruthy()
  })
})

describe('CapabilityPanel 详情 (ADR-0053 决定 1/2/3)', () => {
  it('shows the reach toggles reflecting the route, each writing the central route and nothing else', async () => {
    const panel = props()
    const { container } = render(<CapabilityPanel {...panel} />)
    await openDetail()
    expect(await screen.findByText('可达性')).toBeTruthy()
    const agent = container.querySelector('[data-capability-reach-agent]') as HTMLInputElement
    const resource = container.querySelector('[data-capability-reach-resource]') as HTMLInputElement
    const selection = container.querySelector('[data-capability-reach-selection]') as HTMLInputElement
    expect(agent.checked).toBe(true)
    expect(resource.checked).toBe(false)
    expect(selection.checked).toBe(false)
    // Revoking the agent reach narrows the invocation.
    fireEvent.click(agent)
    await vi.waitFor(() =>{  expect(panel.updateRoute).toHaveBeenCalledWith({ name: 'mail', invocation: ['human'] }) })
    // Turning the resource menu on writes the appliesTo.
    fireEvent.click(resource)
    await vi.waitFor(() =>{  expect(panel.updateRoute).toHaveBeenLastCalledWith({ name: 'mail', appliesTo: { resource: true } }) })
    expect(container.querySelector('[data-capability-unregister]')).not.toBeNull()
  })

  it('rides the untouched appliesTo dimensions along on every toggle', async () => {
    const rich: KbCapabilitySummary = {
      ...SUMMARY,
      invocation: ['human'],
      appliesTo: { resource: true, entity: ['paper'] },
    }
    const panel = props({ capabilities: [rich], unregistered: [] })
    const { container } = render(<CapabilityPanel {...panel} />)
    await openDetail()
    const selection = (await screen.findByText('可达性')) && (container.querySelector('[data-capability-reach-selection]') as HTMLInputElement)
    fireEvent.click(selection)
    await vi.waitFor(() =>{  expect(panel.updateRoute).toHaveBeenCalledWith({
      name: 'mail',
      appliesTo: { resource: true, entity: ['paper'], selection: true },
    }) })
    // An all-clear result is the explicit empty object, not an omission.
    const resource = container.querySelector('[data-capability-reach-resource]') as HTMLInputElement
    fireEvent.click(resource)
    await vi.waitFor(() =>{  expect(panel.updateRoute).toHaveBeenLastCalledWith({
      name: 'mail',
      appliesTo: { entity: ['paper'] },
    }) })
  })

  it('unregisters through an inline confirm, then reloads the list', async () => {
    const panel = props()
    // After the unregister the refreshed listing no longer carries the row,
    // so the panel falls back to the list view.
    let calls = 0
    ;(panel.load as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls += 1
      return calls === 1 ? LISTED : { capabilities: [], unregistered: [] }
    })
    const { container } = render(<CapabilityPanel {...panel} />)
    await openDetail()
    fireEvent.click(await screen.findByText('注销'))
    // The confirm spells out what is lost — and what is not.
    const confirm = container.querySelector('[data-capability-unregister-confirm]')
    expect(confirm?.textContent).toContain('从中央路由移除「mail」的条目')
    fireEvent.click(confirm!.querySelectorAll('button')[0]!)
    await vi.waitFor(() =>{  expect(panel.unregister).toHaveBeenCalledWith('mail') })
    // The parent's reload brought the list back.
    expect(await screen.findByText(/能力清单/)).toBeTruthy()
  })

  it('surfaces a failed route write as an error line', async () => {
    const panel = props()
    ;(panel.updateRoute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('没有能力「mail」的条目'))
    const { container } = render(<CapabilityPanel {...panel} />)
    await openDetail()
    const agent = (await screen.findByText('可达性')) && (container.querySelector('[data-capability-reach-agent]') as HTMLInputElement)
    fireEvent.click(agent)
    expect(await screen.findByText('没有能力「mail」的条目')).toBeTruthy()
    expect(container.querySelector('[data-capability-reach-error]')).not.toBeNull()
  })

  it('shows the run summary from the root store, hiding the line when the capability never ran', async () => {
    const ran: KbCapabilitySummary = {
      ...SUMMARY,
      lastRunAt: '2026-10-01T08:30:00Z',
      runCount: 3,
      lastFailAt: '2026-10-02T09:00:00Z',
      state: { folder: 'Inbox' },
    }
    const panel = props({ capabilities: [ran], unregistered: [] })
    const { container } = render(<CapabilityPanel {...panel} />)
    await openDetail()
    // The summary shows local wall-clock (`YYYY-MM-DD HH:mm`), not the raw
    // ISO stamp — compute the expectation in the runner's own timezone.
    const fmt = (iso: string): string => {
      const at = new Date(iso)
      const pad = (value: number): string => `${value}`.padStart(2, '0')
      return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
    }
    expect(await screen.findByText(`上次运行：${fmt('2026-10-01T08:30:00Z')} · 共 3 次 · 上次失败：${fmt('2026-10-02T09:00:00Z')}`)).toBeTruthy()
    // The mail panel receives the capability's persisted state.
    expect(container.querySelector('[data-mail-panel]')).not.toBeNull()
    expect(container.querySelector('[data-mail-state]')?.getAttribute('data-mail-state')).toBe(JSON.stringify({ folder: 'Inbox' }))
  })

  it('never runs: no run summary line', async () => {
    const { container } = render(<CapabilityPanel {...props()} />)
    await openDetail()
    expect(await screen.findByText('可达性')).toBeTruthy()
    expect(container.querySelector('[data-capability-last-run]')).toBeNull()
  })

  it('folds the technical details: the directory and the route entry as stored', async () => {
    const routed: KbCapabilitySummary = {
      ...SUMMARY,
      routePath: 'mail/sub',
      appliesTo: { selection: true },
    }
    const panel = props({ capabilities: [routed], unregistered: [] })
    const { container } = render(<CapabilityPanel {...panel} />)
    await openDetail()
    expect(await screen.findByText('可达性')).toBeTruthy()
    const details = container.querySelector('[data-capability-details]')
    expect(details?.textContent).toContain('目录：')
    expect(details?.textContent).toContain('/kb/.dsh/skills/mail')
    expect(details?.textContent).toContain('路由条目：')
    expect(details?.textContent).toContain('{"path":"mail/sub","invocation":["human","agent"],"appliesTo":{"selection":true}}')
  })
})
