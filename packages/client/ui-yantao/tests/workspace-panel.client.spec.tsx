// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  KbWorkspace, KbWorkspaceListResult, KbWorkspaceRunsClearResult, KbWorkspaceRunsListResult, KbWorkspaceSaveArgs, KbWorkspaceSaveResult,
} from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { WorkspacePanel, type WorkspacePanelProps } from '../src/client/WorkspacePanel.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const SPACE: KbWorkspace = {
  id: 'wsp_a_1', name: '报告目录', directory: 'D:/reports', agent: 'codebuddy',
  instructions: [{
    id: 'ins_a_1', name: '周报整理', cron: '0 9 * * 1-5', enabled: true,
    steps: ['第一步：收集', '第二步：汇总'],
  }],
}

const MANUAL_SPACE: KbWorkspace = {
  id: 'wsp_b_1', name: '草稿目录', directory: 'D:/drafts', agent: 'codebuddy', model: 'glm-4',
  instructions: [{ id: 'ins_b_1', name: '随手清理', enabled: false, steps: ['清理草稿'] }],
}

const RUNS: KbWorkspaceRunsListResult = {
  runs: [
    {
      id: 'run_live', workspaceId: 'wsp_a_1', instructionId: 'ins_a_1', instructionName: '周报整理',
      trigger: 'manual', status: 'running', startedAt: '2026-10-10T09:00:00Z',
      steps: [{ index: 0, promptSnapshot: '第一步：收集' }],
    },
    {
      id: 'run_old', workspaceId: 'wsp_a_1', instructionName: '周报整理', instructionId: 'ins_a_1',
      trigger: 'cron', status: 'failed', startedAt: '2026-10-09T09:00:00Z', finishedAt: '2026-10-09T09:02:00Z',
      failedStep: 1,
      steps: [
        { index: 0, promptSnapshot: '第一步：收集', startedAt: '2026-10-09T09:00:00Z', finishedAt: '2026-10-09T09:01:00Z', exitCode: 0, sessionId: 'sess1' },
        { index: 1, promptSnapshot: '第二步：汇总', startedAt: '2026-10-09T09:01:00Z', finishedAt: '2026-10-09T09:02:00Z', exitCode: 1, error: 'codebuddy 输出不是合法 JSON' },
      ],
    },
    {
      id: 'run_ok', workspaceId: 'wsp_b_1', instructionId: 'ins_b_1', instructionName: '随手清理',
      trigger: 'manual', status: 'success', startedAt: '2026-10-08T09:00:00Z', finishedAt: '2026-10-08T09:01:00Z',
      finalResult: '清理完成，共 3 个文件。',
      steps: [{ index: 0, promptSnapshot: '清理草稿', startedAt: '2026-10-08T09:00:00Z', finishedAt: '2026-10-08T09:01:00Z', exitCode: 0, sessionId: 'sess2', resultExcerpt: '清理完成，共 3 个文件。' }],
    },
  ],
  path: '.dsh/yantao/workspace-runs.json',
}

/** The panel's props, with spies standing in for the five workspace RPCs. */
function props(overrides: Partial<WorkspacePanelProps> = {}): WorkspacePanelProps {
  const listed: KbWorkspaceListResult = { workspaces: [SPACE, MANUAL_SPACE], path: '.dsh/yantao/workspaces.json' }
  return {
    t,
    list: vi.fn(async () => listed),
    save: vi.fn(async (args: KbWorkspaceSaveArgs): Promise<KbWorkspaceSaveResult> => ({
      workspaces: args.workspaces, path: '.dsh/yantao/workspaces.json',
    })),
    run: vi.fn(async () => ({ runId: 'run_new' })),
    stop: vi.fn(async () => ({ runs: RUNS.runs })),
    listRuns: vi.fn(async () => RUNS),
    clearRuns: vi.fn(async (): Promise<KbWorkspaceRunsClearResult> => ({ cleared: 2, runs: [RUNS.runs[0]] })),
    deleteRun: vi.fn(async () => ({ runs: RUNS.runs.filter(run => run.id !== 'run_old') })),
    onOpenLog: vi.fn(),
    ...overrides,
  }
}

describe('WorkspacePanel', () => {
  it('lists workspaces with cron/manual tags, step counts and the disabled tag', async () => {
    const { container } = render(<WorkspacePanel {...props()} />)
    await screen.findByText('报告目录')
    expect(container.querySelector('[data-workspace-space="wsp_a_1"]')).not.toBeNull()
    // 触发列只答「怎么触发」；cron 表达式收在单元格的 title 里
    // （2026-10-12 截图评审：裸 cron 把名称列挤到硬折行；
    //   2026-10-15 名称列也带 title 兜底省略，故按下标取第二列）。
    const triggerCell = container.querySelector('[data-workspace-instruction="ins_a_1"] td:nth-of-type(2)')
    expect(triggerCell?.textContent).toBe('定时')
    expect(triggerCell?.getAttribute('title')).toBe('0 9 * * 1-5')
    expect(container.querySelector('[data-workspace-instruction="ins_a_1"]')?.textContent).toContain('2 步')
    expect(container.querySelector('[data-workspace-instruction="ins_b_1"]')?.textContent).toContain('已停用')
    expect(container.querySelector('[data-workspace-instruction="ins_b_1"]')?.textContent).toContain('手动')
  })

  it('creates a workspace through a full-list save, minting a wsp_ id', async () => {
    const panel = props()
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    fireEvent.click(container.querySelector('[data-workspace-add-space]') as Element)
    fireEvent.change(screen.getByPlaceholderText('名称'), { target: { value: '新空间' } })
    fireEvent.change(screen.getByPlaceholderText('目录（绝对路径，agent 的工作目录）'), { target: { value: 'D:/new' } })
    await act(async () => {
      fireEvent.click(screen.getAllByText('保存')[0])
    })
    expect(panel.save).toHaveBeenCalledTimes(1)
    const args = (panel.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as KbWorkspaceSaveArgs
    expect(args.workspaces).toHaveLength(3)
    const created = args.workspaces[2]
    expect(created.id).toMatch(/^wsp_[0-9a-z]+_[0-9a-f]{8}$/)
    expect(created.name).toBe('新空间')
    expect(created.agent).toBe('codebuddy')
    expect(created.instructions).toEqual([])
    expect(await screen.findByText('已保存。')).toBeTruthy()
  })

  it('adds an instruction with a minted ins_ id; empty cron means manual', async () => {
    const panel = props()
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    fireEvent.click(container.querySelector('[data-workspace-add-instruction="wsp_a_1"]') as Element)
    fireEvent.change(screen.getByPlaceholderText('指令名称'), { target: { value: '日常巡检' } })
    fireEvent.change(screen.getByPlaceholderText('五段 cron（分 时 日 月 周），留空则仅手动'), { target: { value: '' } })
    fireEvent.change(container.querySelector('[data-workspace-instruction-form="new"] textarea') as Element, { target: { value: '巡检一遍' } })
    await act(async () => {
      fireEvent.click(screen.getAllByText('保存').at(-1) as Element)
    })
    expect(panel.save).toHaveBeenCalledTimes(1)
    const args = (panel.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as KbWorkspaceSaveArgs
    const instruction = args.workspaces[0].instructions.at(-1)
    expect(instruction?.id).toMatch(/^ins_[0-9a-z]+_[0-9a-f]{8}$/)
    expect(instruction?.cron).toBeUndefined()
    expect(instruction?.enabled).toBe(true)
    expect(instruction?.steps).toEqual(['巡检一遍'])
  })

  it('triggers an instruction manually and refreshes the history', async () => {
    const panel = props()
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    await act(async () => {
      fireEvent.click(container.querySelector('[data-workspace-run="ins_b_1"]') as Element)
    })
    expect(panel.run).toHaveBeenCalledWith({ workspaceId: 'wsp_b_1', instructionId: 'ins_b_1' })
    expect(await screen.findByText('已触发。')).toBeTruthy()
    await waitFor(() => {
      expect(panel.listRuns).toHaveBeenCalledTimes(2)
    })
  })

  it('renders the history with statuses and the failed step, and stops a live run', async () => {
    const panel = props()
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    expect(container.querySelector('[data-workspace-run="run_ok"]')?.textContent).toContain('清理完成，共 3 个文件。')
    expect(container.querySelector('[data-workspace-run="run_old"]')?.getAttribute('data-workspace-run-status')).toBe('failed')
    expect(container.querySelector('[data-workspace-run="run_old"]')?.textContent).toContain('第 2 步失败')
    expect(container.querySelector('[data-workspace-run="run_old"]')?.textContent).toContain('codebuddy 输出不是合法 JSON')
    // Only the live run offers the stop gesture.
    expect(container.querySelector('[data-workspace-run-stop="run_old"]')).toBeNull()
    await act(async () => {
      fireEvent.click(container.querySelector('[data-workspace-run-stop="run_live"]') as Element)
    })
    expect(panel.stop).toHaveBeenCalledWith('run_live')
    expect(await screen.findByText('已请求停止。')).toBeTruthy()
  })

  it('offers 查看 on every history row and opens the run log through the callback', async () => {
    const panel = props()
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    // Every run row — settled or live — carries the view gesture.
    expect(container.querySelectorAll('[data-workspace-run-view]')).toHaveLength(3)
    await act(async () => {
      fireEvent.click(container.querySelector('[data-workspace-run-view="run_old"]') as Element)
    })
    expect(panel.onOpenLog).toHaveBeenCalledWith('run_old')
  })

  it('arms the instruction delete: the first click arms, the second deletes', async () => {
    const panel = props()
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    const del = () => container.querySelector('[data-workspace-instruction-delete="ins_a_1"]') as Element
    await act(async () => {
      fireEvent.click(del())
    })
    expect(panel.save).not.toHaveBeenCalled()
    expect(del().textContent).toContain('确认删除？')
    await act(async () => {
      fireEvent.click(del())
    })
    expect(panel.save).toHaveBeenCalledTimes(1)
    const args = (panel.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as KbWorkspaceSaveArgs
    expect(args.workspaces[0].instructions).toEqual([])
  })

  it('arms the history clear: the first click arms, the second clears the finalized rows', async () => {
    const panel = props()
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    const clear = () => container.querySelector('[data-workspace-clear-history]') as Element
    expect(clear()).not.toBeNull()
    await act(async () => {
      fireEvent.click(clear())
    })
    expect(panel.clearRuns).not.toHaveBeenCalled()
    expect(clear().textContent).toContain('确认清空？')
    await act(async () => {
      fireEvent.click(clear())
    })
    expect(panel.clearRuns).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('已清空 2 条。')).toBeTruthy()
    // 只剩仍在运行的那条
    expect(container.querySelector('[data-workspace-run="run_live"]')).not.toBeNull()
    expect(container.querySelector('[data-workspace-run="run_old"]')).toBeNull()
    expect(container.querySelector('[data-workspace-run="run_ok"]')).toBeNull()
  })

  it('offers − on settled history rows only, arming before deleting one', async () => {
    const panel = props()
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    // 运行中的那条没有 −（存储层也会拒绝，但界面先不给入口）
    expect(container.querySelector('[data-workspace-run-delete="run_live"]')).toBeNull()
    expect(container.querySelectorAll('[data-workspace-run-delete]')).toHaveLength(2)
    const del = () => container.querySelector('[data-workspace-run-delete="run_old"]') as Element
    await act(async () => {
      fireEvent.click(del())
    })
    expect(panel.deleteRun).not.toHaveBeenCalled()
    expect(del().getAttribute('data-armed')).toBe('true')
    expect(del().textContent).toContain('确认删除？')
    await act(async () => {
      fireEvent.click(del())
    })
    expect(panel.deleteRun).toHaveBeenCalledTimes(1)
    expect(panel.deleteRun).toHaveBeenCalledWith('run_old')
    // 删除后该行消失，其余两行保持原位
    expect(container.querySelector('[data-workspace-run="run_old"]')).toBeNull()
    expect(container.querySelector('[data-workspace-run="run_live"]')).not.toBeNull()
    expect(container.querySelector('[data-workspace-run="run_ok"]')).not.toBeNull()
  })

  it('hides the clear gesture when the history is empty', async () => {
    const { container } = render(<WorkspacePanel {...props({
      listRuns: vi.fn(async (): Promise<KbWorkspaceRunsListResult> => ({ runs: [], path: '.dsh/yantao/workspace-runs.json' })),
    })} />)
    await screen.findByText('报告目录')
    expect(await screen.findByText('还没有运行记录。')).toBeTruthy()
    expect(container.querySelector('[data-workspace-clear-history]')).toBeNull()
  })

  it('shows the empty state when nothing is configured', async () => {
    const { container } = render(<WorkspacePanel {...props({
      list: vi.fn(async (): Promise<KbWorkspaceListResult> => ({ workspaces: [], path: '.dsh/yantao/workspaces.json' })),
    })} />)
    expect(await screen.findByText('还没有工作空间。')).toBeTruthy()
    expect(container.querySelector('[data-workspace-empty]')).not.toBeNull()
  })

  it('surfaces a save refusal verbatim and keeps the list as it was', async () => {
    const panel = props({
      save: vi.fn(async () => { throw new Error('指令「日常巡检」至少需要一个提示词步骤') }),
    })
    const { container } = render(<WorkspacePanel {...panel} />)
    await screen.findByText('报告目录')
    fireEvent.click(container.querySelector('[data-workspace-add-instruction="wsp_a_1"]') as Element)
    fireEvent.change(screen.getByPlaceholderText('指令名称'), { target: { value: '日常巡检' } })
    fireEvent.change(container.querySelector('[data-workspace-instruction-form="new"] textarea') as Element, { target: { value: '巡检一遍' } })
    await act(async () => {
      fireEvent.click(screen.getAllByText('保存').at(-1))
    })
    expect(await screen.findByText('指令「日常巡检」至少需要一个提示词步骤')).toBeTruthy()
    expect(container.querySelector('[data-workspace-error]')).not.toBeNull()
    // The refusal kept the editor open for revision.
    expect(container.querySelector('[data-workspace-instruction-form="new"]')).not.toBeNull()
  })
})
