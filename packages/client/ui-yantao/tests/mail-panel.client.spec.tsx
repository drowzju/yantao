// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KbMailMessage, KbTodoItem } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { AnalysisProgress, AnalysisRun, KnownEntities, MailAnalysis } from '../src/client/mail-analysis.ts'
import type { MailEntities } from '../src/client/mail-apply.ts'
import { MailPanel, type MailPanelProps } from '../src/client/MailPanel.tsx'

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
  },
]

const ENTITIES: MailEntities = {
  projects: ['飞书迁移'],
  people: [],
  files: [{ name: '飞书迁移', path: 'entities/projects/飞书迁移.md' }],
}

const VERDICT: MailAnalysis = {
  people: [{ name: '张三', relation: '合作方', reason: '一起做汇报' }],
  todos: [{ title: '发汇报', due: '2026-09-12', body: '' }],
  projects: [{ name: '飞书迁移', note: '对方确认了时间' }],
  resources: [{ name: '汇报模板', summary: '两句话' }],
}

/** The panel's props, with spies standing in for the RPCs and the writes. */
function props(overrides: Partial<MailPanelProps> = {}): MailPanelProps {
  return {
    fetch: async () => ({ since: '2026-09-01T00:00:00.000Z', stale: false, hasMore: false, messages: MAILS }),
    mark: vi.fn(async () => ({ lastReadAt: '2026-09-09T10:00:00+00:00' })),
    analyse: async () => ({ sessionId: 'session-1', title: '邮件分析 2026-09-10', analysis: VERDICT }),
    target: {
      createEntity: vi.fn(async () => 'entities/people/张三.md'),
      read: vi.fn(async () => '## 状态\n\n\n## 流水\n\n- 2026-01-01 创建 飞书迁移\n'),
      write: vi.fn(async () => {}),
      todos: async () => ({ path: TODOS_PATH, text: TEXT, items: [{ done: false, title: '已有的待办', body: '', extra: [] }] }),
      writeTodos: vi.fn(async () => ({ path: TODOS_PATH, text: TEXT })),
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
  await screen.findByText('邮件分析结果')
  return panel
}

describe('MailPanel', () => {
  it('says what the connector is before anything is read', () => {
    render(<MailPanel {...props()} />)
    expect(screen.getByText(/Outlook（COM 子进程）/)).toBeTruthy()
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

  it('says which stage the analysis has reached', async () => {
    let release = (): void => {}
    const analyse = vi.fn((_mails: readonly KbMailMessage[], _known: KnownEntities, onProgress?: (p: AnalysisProgress) => void) => {
      onProgress?.({ stage: 'answer' })
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
    expect(screen.getByText(/模型正在读这批邮件/)).toBeTruthy()
    await act(async () => {
      release()
    })
    expect(await screen.findByText('邮件分析结果')).toBeTruthy()
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
      expect(target.createEntity as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('person', '张三')
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
    // The cursor moves with the newest mail that was read.
    expect(panel.mark).toHaveBeenCalledWith({ lastReadAt: '2026-09-09T10:00:00+00:00' })
    expect(await screen.findByText(/人物 张三/)).toBeTruthy()
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
    await openReview({ entities: async () => ({ projects: [], people: [], files: [] }) })
    fireEvent.click(screen.getByText('全部接受'))
    await act(async () => {
      fireEvent.click(screen.getByText('确认写入（4）'))
    })
    expect(await screen.findByText(/项目 飞书迁移：知识库里没有这个实体/)).toBeTruthy()
  })
})
