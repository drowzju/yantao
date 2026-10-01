// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  KbCapabilityDeclarationResult, KbCapabilityListResult,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { CapabilityPanel, type CapabilityPanelProps } from '../src/client/CapabilityPanel.tsx'
import type { CapabilityRunRecord } from '../src/client/capability-distill.ts'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const LISTED: KbCapabilityListResult = {
  capabilities: [
    {
      name: 'mail',
      description: '读 Outlook 邮件',
      source: 'custom',
      directory: '/kb/.dsh/skills/mail',
      entry: 'scripts/entry.py',
      runtime: 'python',
      invocation: ['human', 'agent'],
    },
  ],
  unregistered: [],
}

const DECLARED: KbCapabilityDeclarationResult = {
  name: 'mail',
  directory: '/kb/.dsh/skills/mail',
  sidecar: {
    present: true,
    source: 'sidecar',
    raw: '{\n  "entry": "scripts/entry.py",\n  "runtime": "python"\n}\n',
    resolved: {
      kind: 'script',
      entry: 'scripts/entry.py',
      runtime: 'python',
      version: '3',
      invocation: ['human', 'agent'],
      entryCandidates: ['/kb/.dsh/skills/mail/scripts/entry.py', '/kb/.dsh/scripts/entry.py'],
      entryPath: '/kb/.dsh/skills/mail/scripts/entry.py',
    },
  },
  route: { registered: false },
  agentInvocable: true,
}

/** The panel's props, with spies standing in for the capability RPCs. */
function props(overrides: Partial<CapabilityPanelProps> = {}): CapabilityPanelProps {
  return {
    t,
    load: vi.fn(async () => LISTED),
    loadDeclaration: vi.fn(async () => DECLARED),
    create: vi.fn(),
    adopt: vi.fn(),
    register: vi.fn(),
    mail: () => <div data-mail-panel="true" />,
    loadShortcuts: vi.fn(async () => ({ shortcuts: [] })),
    saveShortcuts: vi.fn(),
    fillShortcut: vi.fn(),
    runs: [],
    onDistill: vi.fn(),
    distilling: null,
    ...overrides,
  }
}

/** Open the detail view of the one listed capability. */
async function openDetail(): Promise<void> {
  fireEvent.click(await screen.findByText(/能力清单/))
  fireEvent.click(await screen.findByText('mail'))
}

describe('CapabilityPanel 声明 section (ADR-0043 决定 7)', () => {
  it('shows the resolved declaration flat, the raw sidecar folded, and the gate answer', async () => {
    const panel = props()
    const { container } = render(<CapabilityPanel {...panel} />)
    await openDetail()
    expect(panel.loadDeclaration).toHaveBeenCalledWith('mail')
    expect(await screen.findByText('声明')).toBeTruthy()
    // Parsed fields, flat.
    expect(container.querySelector('[data-declaration-kind="script"]')).not.toBeNull()
    expect(screen.getByText('scripts/entry.py')).toBeTruthy()
    // The winning path appears twice: the 入口解析 line and the candidate list.
    expect(screen.getAllByText('/kb/.dsh/skills/mail/scripts/entry.py').length).toBeGreaterThan(0)
    expect(screen.getByText('/kb/.dsh/scripts/entry.py')).toBeTruthy()
    // The raw sidecar folds away.
    const raw = container.querySelector('[data-declaration-raw]')
    expect(raw).not.toBeNull()
    expect(raw?.textContent).toContain('"entry": "scripts/entry.py"')
    // The route miss and the gate answer are visible.
    expect(container.querySelector('[data-declaration-route="missing"]')?.textContent).toContain('未注册')
    expect(container.querySelector('[data-declaration-agent="yes"]')).not.toBeNull()
  })

  it('spells out a missing sidecar and a broken entry in warning text', async () => {
    const broken: KbCapabilityDeclarationResult = {
      name: 'mail',
      sidecar: { present: false, problem: 'sidecar 不存在：目录内没有 yantao.json，SKILL.md 也没有 metadata.yantao 段。' },
      route: { registered: false },
      agentInvocable: false,
    }
    const { container } = render(<CapabilityPanel {...props({ loadDeclaration: vi.fn(async () => broken) })} />)
    await openDetail()
    expect((await screen.findByText(/sidecar 不存在/)).textContent).toContain('sidecar 不存在')
    expect(container.querySelector('[data-declaration-problem="sidecar"]')).not.toBeNull()
    expect(container.querySelector('[data-declaration-route="missing"]')).not.toBeNull()
    expect(container.querySelector('[data-declaration-agent="no"]')).not.toBeNull()
  })

  it('warns when the entry file is missing and shows a registered route', async () => {
    const missingEntry: KbCapabilityDeclarationResult = {
      ...DECLARED,
      sidecar: {
        present: true,
        source: 'sidecar',
        resolved: {
          kind: 'script',
          entry: 'scripts/missing.py',
          runtime: 'python',
          invocation: ['human'],
          entryCandidates: ['/kb/.dsh/skills/mail/scripts/missing.py'],
        },
      },
      route: { registered: true, path: 'mail', invocation: ['human', 'agent'] },
      agentInvocable: false,
    }
    const { container } = render(<CapabilityPanel {...props({ loadDeclaration: vi.fn(async () => missingEntry) })} />)
    await openDetail()
    expect((await screen.findByText(/入口脚本不存在/)).textContent).toContain('入口脚本不存在')
    expect(container.querySelector('[data-declaration-route="registered"]')?.textContent).toContain('mail')
    // The sidecar's human-only declaration wins the gate over the route.
    expect(container.querySelector('[data-declaration-agent="no"]')).not.toBeNull()
  })

  it('renders the RPC failure as an error line instead of a blank pane', async () => {
    const failing = props({
      loadDeclaration: vi.fn(async () => {
        throw new Error('还没有选择知识库目录，能力的声明无处读取。')
      }),
    })
    const { container } = render(<CapabilityPanel {...failing} />)
    await openDetail()
    expect((await screen.findByText('还没有选择知识库目录，能力的声明无处读取。'))).toBeTruthy()
    expect(container.querySelector('[data-declaration-error]')).not.toBeNull()
  })
})

describe('CapabilityPanel 运行记录 (ADR-0044 决定 6)', () => {
  const OK_RUN: CapabilityRunRecord = {
    id: 'cap-run-0',
    name: 'mail',
    ok: true,
    exec: {
      command: 'python scripts/entry.py --folder Inbox',
      exitCode: 0,
      durationMs: 1234,
      stdoutTail: '共 3 封新邮件',
      stderrTail: '',
    },
    at: new Date('2026-10-01T08:30:00').getTime(),
  }
  const FAILED_RUN: CapabilityRunRecord = {
    id: 'cap-run-1',
    name: 'mail',
    ok: false,
    exec: {
      command: 'python scripts/entry.py --fetch',
      exitCode: 1,
      durationMs: 5678,
      stdoutTail: '',
      stderrTail: '连接超时',
    },
    at: new Date('2026-10-01T09:00:00').getTime(),
  }

  it('hides the run-records section when the session has no runs', async () => {
    const { container } = render(<CapabilityPanel {...props()} />)
    await openDetail()
    expect(await screen.findByText('声明')).toBeTruthy()
    expect(container.querySelector('[data-capability-runs]')).toBeNull()
  })

  it('lists this session\'s runs with verdict, envelope fold, and a distill button per record', async () => {
    const { container } = render(<CapabilityPanel {...props({ runs: [OK_RUN, FAILED_RUN] })} />)
    await openDetail()
    expect(container.querySelector('[data-capability-runs]')).not.toBeNull()
    expect(container.querySelectorAll('[data-capability-run]').length).toBe(2)
    // The settled verdicts, with the envelope's numbers beside them.
    expect(screen.getByText(/成功 · 退出码 0 · 1234 ms/)).toBeTruthy()
    expect(screen.getByText(/失败 · 退出码 1 · 5678 ms/)).toBeTruthy()
    // The envelope folds: the command is the summary, the tails lie beneath.
    fireEvent.click(screen.getByText('python scripts/entry.py --folder Inbox'))
    expect(await screen.findByText('共 3 封新邮件')).toBeTruthy()
    expect(screen.getByText('连接超时')).toBeTruthy()
    // One distill button per record.
    expect(container.querySelector('[data-capability-distill="cap-run-0"]')).not.toBeNull()
    expect(container.querySelector('[data-capability-distill="cap-run-1"]')).not.toBeNull()
  })

  it('hands the clicked record to the distill gesture', async () => {
    const onDistill = vi.fn()
    const { container } = render(<CapabilityPanel {...props({ runs: [OK_RUN, FAILED_RUN], onDistill })} />)
    await openDetail()
    const first = container.querySelector('[data-capability-distill="cap-run-0"]') as HTMLButtonElement
    fireEvent.click(first)
    expect(onDistill).toHaveBeenCalledTimes(1)
    expect(onDistill).toHaveBeenCalledWith(OK_RUN)
  })

  it('rests every button while one record distils, labelling the busy one', async () => {
    const { container } = render(<CapabilityPanel {...props({ runs: [OK_RUN, FAILED_RUN], distilling: 'cap-run-1' })} />)
    await openDetail()
    const first = container.querySelector('[data-capability-distill="cap-run-0"]') as HTMLButtonElement
    const second = container.querySelector('[data-capability-distill="cap-run-1"]') as HTMLButtonElement
    expect(first.disabled).toBe(true)
    expect(second.disabled).toBe(true)
    expect(second.textContent).toBe('提炼中…')
    expect(first.textContent).toBe('提炼经验')
  })
})
