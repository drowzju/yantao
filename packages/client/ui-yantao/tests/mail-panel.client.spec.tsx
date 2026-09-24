// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KbMailMessage, KbTodoItem } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { AnalysisProgress, AnalysisRun, KnownEntities, MailAnalysis } from '../src/client/mail-analysis.ts'
import type { MailEntities } from '../src/client/mail-apply.ts'
import { MailPanel, type MailPanelProps } from '../src/client/MailPanel.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const TODOS_PATH = 'entities/todos.md'
const TEXT = '- [ ] 已有的待办\n'

const MAILS: readonly KbMailMessage[] = [
  {
    id: 'a',
    entryId: 'a',
    receivedAt: '2026-09-09T10:00:00+00:00',
    senderName: '张三',
    senderAddress: 'zhangsan@example.com',
    subject: '季度汇报',
    body: '正文',
    truncated: false,
    toMe: 'to',
  },
]

const ENTITIES: MailEntities = {
  projects: ['飞书迁移'],
  areas: [],
  meetings: [],
  people: [],
  files: [{ name: '飞书迁移', path: 'entities/projects/飞书迁移.md' }],
  meetingFiles: [],
}

const VERDICT: MailAnalysis = {
  verdicts: [{ mail: 1, importance: 'focus', why: '上级主送' }],
  people: [{ name: '张三', relation: 'peer', reason: '一起做汇报' }],
  todos: [{ title: '发汇报', due: '2026-09-12', body: '' }],
  projects: [{ name: '飞书迁移', note: '对方确认了时间' }],
  newProjects: [],
  meetings: [],
  deletions: [],
  resources: [{ name: '汇报模板', summary: '两句话', mail: 1 }],
  memories: [],
}

/** The panel's props, with spies standing in for the RPCs and the writes. */
function props(overrides: Partial<MailPanelProps> = {}): MailPanelProps {
  return {
    t,
    fetch: async () => ({ since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: false, messages: MAILS }),
    mark: vi.fn(async () => ({ lastReadAt: '2026-09-09T10:00:00+00:00' })),
    analyse: async () => ({ sessionId: 'session-1', title: '邮件分析 2026-09-10', analysis: VERDICT }),
    target: {
      createEntity: vi.fn(async () => 'entities/people/张三.md'),
      read: vi.fn(async () => '## 状态\n\n\n## 流水\n\n- 2026-01-01 创建 飞书迁移\n'),
      write: vi.fn(async () => {}),
      todos: async () => ({ path: TODOS_PATH, text: TEXT, items: [{ done: false, title: '已有的待办', body: '', extra: [] }] }),
      writeTodos: vi.fn(async () => ({ path: TODOS_PATH, text: TEXT })),
      memoryAdd: vi.fn(async (scope: string, text: string) => ({ path: `.dsh/yantao/memory/${scope}.md`, entry: { id: 'm1', text } })),
    },
    entities: async () => ENTITIES,
    ...overrides,
  }
}

/** The verdict one analysis run answers with. */
const RUN: AnalysisRun = { sessionId: 'session-1', title: '邮件分析 2026-09-10', analysis: VERDICT }

/** Read a batch and open the review window; returns the props it ran with. */
async function openReview(overrides: Partial<MailPanelProps> = {}): Promise<MailPanelProps> {
  const panel = props(overrides)
  render(<MailPanel {...panel} />)
  await act(async () => {
    fireEvent.click(screen.getByText('往后 →'))
  })
  await screen.findByText(/1 封 · /)
  await act(async () => {
    fireEvent.click(screen.getByText('分析这 1 封'))
  })
  await screen.findByText('邮件分析 2026-09-10')
  return panel
}

describe('MailPanel', () => {
  it('says what the connector is before anything is read', () => {
    render(<MailPanel {...props()} />)
    expect(screen.getByText(/Outlook（COM 子进程）/)).toBeTruthy()
  })

  it('shows the processed range from the capability\'s state, and extends it after a verdict', async () => {
    const panel = props({
      processed: { firstReadAt: '2025-12-31T00:00:00+00:00', lastReadAt: '2026-01-31T00:00:00+00:00' },
      mark: vi.fn(async () => ({ lastReadAt: '2026-09-09T10:00:00+00:00', firstReadAt: '2025-12-31T00:00:00+00:00' })),
    })
    render(<MailPanel {...panel} />)
    expect(screen.getByText('已处理：2025-12-31 到 2026-01-31')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/1 封 · /)
    // The read itself does not move the cursor; the range still says 1 月底.
    expect(screen.getByText('已处理：2025-12-31 到 2026-01-31')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('分析这 1 封'))
    })
    fireEvent.click(screen.getByText('全部接受'))
    await act(async () => {
      fireEvent.click(screen.getByText('确认写入（4）'))
    })
    // The mark answer moves the range's end; the start stays the minimum.
    expect(await screen.findByText('已处理：2025-12-31 到 2026-09-09')).toBeTruthy()
  })

  it('shows only the watermark when the range\'s start is unknown', () => {
    render(<MailPanel {...props({ processed: { lastReadAt: '2026-01-31T00:00:00+00:00' } })} />)
    expect(screen.getByText('已处理：2026-01-31')).toBeTruthy()
  })

  it('reads the newest batch with 往后, and an older window with 往前', async () => {
    const fetch = vi.fn(async (_bounds?: { since?: string; until?: string }) => ({
      since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: false, messages: MAILS,
    }))
    render(<MailPanel {...props({ fetch })} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/1 封 · /)
    // Nothing was loaded yet, so the host fills the lower bound itself.
    expect(fetch.mock.calls[0]?.[0]).toEqual({})

    await act(async () => {
      fireEvent.click(screen.getByText('← 往前'))
    })
    const bounds = fetch.mock.calls[1]?.[0] as { since: string; until: string }
    expect(bounds.until).toBe('2026-09-09T10:00:00+00:00')
    // One 30-day step back from the oldest mail on screen.
    expect(bounds.since).toBe(new Date(Date.parse(bounds.until) - 30 * 24 * 3600 * 1000).toISOString())
  })

  it('says which stage the analysis has reached, and how far it has got', async () => {
    let release = (): void => {}
    const analyse = vi.fn((_mails: readonly KbMailMessage[], _known: KnownEntities, onProgress?: (p: AnalysisProgress) => void) => {
      onProgress?.({ stage: 'answer', done: 1, total: 1, verdicts: [{ mail: 1, importance: 'focus', why: '上级主送' }] })
      return new Promise<AnalysisRun>((resolve) => {
        release = () => { resolve(RUN) }
      })
    })
    render(<MailPanel {...props({ analyse })} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/1 封 · /)
    await act(async () => {
      fireEvent.click(screen.getByText('分析这 1 封'))
    })
    expect(screen.getByText(/已分析 1\/1/)).toBeTruthy()
    // The judged mail lights up with its importance badge.
    expect(screen.getByText('重点')).toBeTruthy()
    await act(async () => {
      release()
    })
    expect(await screen.findByText('邮件分析 2026-09-10')).toBeTruthy()
  })

  it('shows the 重点提醒 block above the tickable groups', async () => {
    await openReview()
    expect(screen.getByText('重点提醒')).toBeTruthy()
    expect(screen.getByText(/张三：季度汇报/)).toBeTruthy()
  })

  it('shows the host\'s message and its remedy when the read fails', async () => {
    const failure = Object.assign(new Error('无法连接 Outlook：COM/MAPI 接口不可用。'), {
      details: { kind: 'outlook-unavailable', hint: '经典 Outlook 桌面版必须已启动。' },
    })
    render(<MailPanel {...props({ fetch: async () => { throw failure } })} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    expect(await screen.findByText(/COM\/MAPI 接口不可用/)).toBeTruthy()
    expect(screen.getByText(/经典 Outlook 桌面版必须已启动/)).toBeTruthy()
  })

  it('offers the KB\'s own entities to the analysis', async () => {
    const analyse = vi.fn(async (_mails: readonly KbMailMessage[], _known: KnownEntities) =>
      ({ sessionId: 's', title: '邮件分析 2026-09-10', analysis: VERDICT }))
    await openReview({ analyse })
    expect(analyse.mock.calls[0]?.[1]).toMatchObject({ projects: ['飞书迁移'], people: [] })
  })

  it('feeds the read\'s behavior memory into the analysis (ADR-0032 批次④)', async () => {
    const analyse = vi.fn(async (
      _mails: readonly KbMailMessage[], _known: KnownEntities,
      _onProgress?: (progress: AnalysisProgress) => void, _signal?: AbortSignal, memory?: string,
    ) => {
      void memory
      return { sessionId: 's', title: '邮件分析 2026-09-10', analysis: VERDICT }
    })
    await openReview({
      fetch: async () => ({
        since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: false, messages: MAILS,
        memory: '【行为记忆】人在以往运行中为「mail」沉淀的规则（历次纠正的累积），本次运行遵守：\n- 汇报先发给直属上级',
      }),
      analyse,
    })
    expect(analyse.mock.calls[0]?.[4]).toContain('汇报先发给直属上级')
  })

  it('ticks nothing to begin with, and 全部接受 ticks every row', async () => {
    await openReview()
    expect(screen.getByText('确认写入（0）')).toBeTruthy()
    fireEvent.click(screen.getByText('全部接受'))
    expect(screen.getByText('确认写入（4）')).toBeTruthy()
    fireEvent.click(screen.getByText('全部忽略'))
    expect(screen.getByText('确认写入（0）')).toBeTruthy()
  })

  it('writes only what the human ticked, and only after confirmation', async () => {
    const panel = await openReview()
    const target = panel.target
    // Nothing has been written at this point: the window is still open.
    expect((target.createEntity as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('全部接受'))
    await act(async () => {
      fireEvent.click(screen.getByText('确认写入（4）'))
    })
    await waitFor(() => {
      expect(target.createEntity as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('person', '张三', 'peer')
    })

    const written = (target.write as unknown as ReturnType<typeof vi.fn>).mock.calls
    // The project note is appended to 流水, never rewritten.
    const [projectPath, projectContent] = written[0] as [string, string]
    expect(projectPath).toBe('entities/projects/飞书迁移.md')
    expect(projectContent).toContain('- 2026-01-01 创建 飞书迁移')
    expect(projectContent).toContain('对方确认了时间')
    // The chosen mail becomes a resource note.
    expect(written[1]?.[0]).toBe('resources/汇报模板.md')

    const todoArgs = (target.writeTodos as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      expectedText: string
      items: readonly KbTodoItem[]
    }
    expect(todoArgs.expectedText).toBe(TEXT)
    expect(todoArgs.items.map(item => item.title)).toEqual(['已有的待办', '发汇报'])
    // The cursor moves with the newest mail that was read; the oldest names the range's start.
    expect(panel.mark).toHaveBeenCalledWith({
      lastReadAt: '2026-09-09T10:00:00+00:00',
      firstReadAt: '2026-09-09T10:00:00+00:00',
    })
    expect(await screen.findByText(/实体 张三/)).toBeTruthy()
  })

  it('writes nothing when the verdict is dismissed, but still counts the mails as read', async () => {
    const panel = await openReview()
    await act(async () => {
      fireEvent.click(screen.getByText('取消'))
    })
    expect((panel.target.createEntity as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(panel.mark).toHaveBeenCalled()
    })
  })

  it('reports a project the KB does not hold instead of inventing a file', async () => {
    await openReview({ entities: async () => ({ projects: [], areas: [], meetings: [], people: [], files: [], meetingFiles: [] }) })
    fireEvent.click(screen.getByText('全部接受'))
    await act(async () => {
      fireEvent.click(screen.getByText('确认写入（4）'))
    })
    expect(await screen.findByText(/实体 飞书迁移：知识库里没有这个实体/)).toBeTruthy()
  })

  it('turns the verdict\'s memories into add-memory rows pinned to the mail scope (ADR-0032)', async () => {
    const panel = await openReview({
      analyse: async () => ({
        sessionId: 'session-1', title: '邮件分析 2026-09-10',
        analysis: { ...VERDICT, memories: [{ text: '汇报先发给直属上级', why: '上级主送' }] },
      }),
    })
    // The card carries a 记忆 group with the proposed line.
    expect(screen.getByText('记忆')).toBeTruthy()
    expect(screen.getByText('汇报先发给直属上级')).toBeTruthy()

    fireEvent.click(screen.getByText('全部接受'))
    await act(async () => {
      fireEvent.click(screen.getByText('确认写入（5）'))
    })
    await waitFor(() => {
      expect(panel.target.memoryAdd as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('mail', '汇报先发给直属上级')
    })
    expect(await screen.findByText(/记忆（mail）汇报先发给直属上级/)).toBeTruthy()
  })

  it('writes the human-side memory straight through memoryAdd, with 已记得 for duplicates', async () => {
    const memoryAdd = vi.fn(async (scope: string, text: string) => ({ path: `.dsh/yantao/memory/${scope}.md`, entry: { id: 'm1', text } }))
    render(<MailPanel {...props({ memoryAdd })} />)
    const box = screen.getByPlaceholderText('要记住的纠正或偏好（一句话）') as HTMLInputElement
    fireEvent.change(box, { target: { value: '周报周五下班前发' } })
    await act(async () => {
      fireEvent.click(screen.getByText('记住'))
    })
    expect(memoryAdd).toHaveBeenCalledWith('mail', '周报周五下班前发')
    expect(await screen.findByText('已记住。')).toBeTruthy()
    expect(box.value).toBe('')

    fireEvent.change(box, { target: { value: '周报周五下班前发' } })
    ;(memoryAdd as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('这条记忆已经存在（作用域 mail）：周报周五下班前发'))
    await act(async () => {
      fireEvent.click(screen.getByText('记住'))
    })
    expect(await screen.findByText('这条已经记得了。')).toBeTruthy()
  })
})

describe('MailPanel cancellation', () => {
  it('stops the analysis on 取消, keeping the landed verdicts (ADR-0031)', async () => {
    const panel = props({
      analyse: async (_mails, _known, onProgress, signal) => {
        onProgress?.({ stage: 'answer', done: 1, total: 2, verdicts: [{ mail: 1, importance: 'focus', why: '上级主送' }] })
        return new Promise<AnalysisRun>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('aborted'))
          }, { once: true })
        })
      },
    })
    render(<MailPanel {...panel} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/1 封 · /)
    await act(async () => {
      fireEvent.click(screen.getByText('分析这 1 封'))
    })
    // The landed verdict is lit while the run is still going.
    await screen.findByText('重点')
    expect(screen.getByText('取消')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('取消'))
    })
    // Back to idle: no error raised, the verdict stays, the run says it stopped.
    await waitFor(() => { expect(screen.queryByText('取消')).toBeNull() })
    expect(screen.getByText('重点')).toBeTruthy()
    expect(screen.getByText('已取消，已完成的判定保留。')).toBeTruthy()
    expect(screen.queryByText(/失败/)).toBeNull()
  })
})

describe('MailPanel threads', () => {
  const threadMail = (id: string, receivedAt: string, overrides: Partial<KbMailMessage> = {}): KbMailMessage => ({
    id,
    entryId: id,
    receivedAt,
    senderName: '张三',
    senderAddress: 'zhangsan@example.com',
    subject: '季度汇报',
    body: '',
    truncated: false,
    toMe: 'to',
    conversationId: 'C1',
    conversationTopic: '季度汇报',
    ...overrides,
  })

  const THREADED: readonly KbMailMessage[] = [
    threadMail('t3', '2026-09-09T10:00:00+00:00'),
    threadMail('t2', '2026-09-09T09:00:00+00:00'),
    threadMail('t1', '2026-09-08T08:00:00+00:00'),
  ]

  it('groups a multi-mail thread under one collapsible header, collapsed from three on', async () => {
    const { container } = render(<MailPanel {...props({ fetch: async () => ({ since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: false, messages: THREADED }) })} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/3 封 · /)
    const header = container.querySelector('[data-mail-thread-toggle]')
    expect(header).not.toBeNull()
    expect(container.textContent).toContain('×3')
    // Collapsed by default: the member rows are hidden until the header is clicked.
    expect(container.querySelector('[data-mail-row="1"]')).toBeNull()
    await act(async () => {
      fireEvent.click(header as Element)
    })
    expect(container.querySelector('[data-mail-row="1"]')).not.toBeNull()
    expect(container.querySelector('[data-mail-row="3"]')).not.toBeNull()
  })

  it('expands a pair by default and leaves a single mail without any header', async () => {
    const pair = THREADED.slice(0, 2)
    const { container } = render(<MailPanel {...props({ fetch: async () => ({ since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: false, messages: pair }) })} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/2 封 · /)
    expect(container.querySelector('[data-mail-thread-toggle]')).not.toBeNull()
    expect(container.querySelector('[data-mail-row="1"]')).not.toBeNull()

    cleanup()
    const solo = render(<MailPanel {...props()} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/1 封 · /)
    expect(solo.container.querySelector('[data-mail-thread-toggle]')).toBeNull()
    expect(solo.container.querySelector('[data-mail-row="1"]')).not.toBeNull()
  })

  it('rolls the loudest member verdict up to the header, keeping per-mail badges on members', async () => {
    const { container } = render(<MailPanel {...props({
      fetch: async () => ({ since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: false, messages: THREADED }),
      analyse: async (_mails, _known, onProgress) => {
        onProgress?.({
          stage: 'answer', done: 3, total: 3,
          verdicts: [
            { mail: 1, importance: 'digest', why: '通知' },
            { mail: 2, importance: 'focus', why: '上级主送' },
            { mail: 3, importance: 'normal', why: '' },
          ],
        })
        return new Promise<AnalysisRun>(() => {})
      },
    })} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/3 封 · /)
    await act(async () => {
      fireEvent.click(screen.getByText('分析这 3 封'))
    })
    await screen.findByText(/×3/)
    expect(container.querySelector('[data-mail-thread-verdict="focus"]')).not.toBeNull()
    // Expand: the per-mail badges still light on their original rows.
    await act(async () => {
      fireEvent.click(container.querySelector('[data-mail-thread-toggle]') as Element)
    })
    const member = container.querySelector('[data-mail-row="2"] [data-mail-verdict="focus"]')
    expect(member).not.toBeNull()
  })

  it('keeps the expanded state across a refetch that regroups the batch', async () => {
    const { container } = render(<MailPanel {...props({ fetch: async () => ({ since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: false, messages: [...THREADED] }) })} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/3 封 · /)
    await act(async () => {
      fireEvent.click(container.querySelector('[data-mail-thread-toggle]') as Element)
    })
    expect(container.querySelector('[data-mail-row="1"]')).not.toBeNull()
    // A fresh batch (new array identity) regroups, but the expansion survives.
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/3 封 · /)
    expect(container.querySelector('[data-mail-row="1"]')).not.toBeNull()
  })

  it('groups each read window on its own, without merging across batches', async () => {
    let call = 0
    const { container } = render(<MailPanel {...props({
      fetch: vi.fn(async () => {
        call += 1
        return { since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: call < 2, messages: call === 1 ? THREADED : [threadMail('t0', '2026-09-07T07:00:00+00:00')] }
      }),
    })} />)
    await act(async () => {
      fireEvent.click(screen.getByText('往后 →'))
    })
    await screen.findByText(/3 封 · /)
    expect(container.querySelector('[data-mail-thread-toggle]')).not.toBeNull()
    // The older window holds one mail of the same conversation: alone, no header.
    await act(async () => {
      fireEvent.click(screen.getByText('← 往前'))
    })
    await screen.findByText(/1 封 · /)
    expect(container.querySelector('[data-mail-thread-toggle]')).toBeNull()
  })
})
