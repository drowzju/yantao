// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KbSchedule, KbWorkspace } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { SchedulePane, type SchedulePaneProps } from '../src/client/SchedulePane.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const ROW_A: KbSchedule = {
  id: 'sch_a', name: '早报', prompt: '写早报', cron: '0 9 * * *', enabled: true,
}
const ROW_B: KbSchedule = {
  id: 'sch_b', name: '晚报', prompt: '写晚报', cron: '0 18 * * *', enabled: true,
}

const SPACE: KbWorkspace = {
  id: 'wsp_a', name: '报告目录', directory: 'D:/reports', agent: 'codebuddy',
  instructions: [{
    id: 'ins_a', name: '周报整理', cron: '30 9 * * *', enabled: true,
    steps: ['第一步：收集'],
  }],
}

function props(overrides: Partial<SchedulePaneProps> = {}): SchedulePaneProps {
  return {
    t,
    schedules: [ROW_A, ROW_B],
    onSave: vi.fn(async () => true),
    promptShortcutList: vi.fn(async () => ({ shortcuts: [] })),
    capabilityNames: [],
    workspaces: [SPACE],
    onInstructionScheduleSave: vi.fn(async () => null),
    onViewRunRecords: () => {},
    ...overrides,
  }
}

describe('SchedulePane 未保存确认条（脏态守卫收敛）', () => {
  it('脏时点别的行出确认条；点「放弃修改」后确认条消失并打开目标行', () => {
    render(<SchedulePane {...props()} />)
    fireEvent.click(screen.getByText('早报'))
    const nameInput = screen.getByLabelText('名称') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '早报改' } })
    fireEvent.click(screen.getByText('晚报'))
    expect(screen.getByText('当前调度还没保存，放弃这些修改？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(screen.queryByText('当前调度还没保存，放弃这些修改？')).toBeNull()
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('晚报')
  })

  it('脏时点「继续编辑」确认条消失、草稿原样保留', () => {
    render(<SchedulePane {...props()} />)
    fireEvent.click(screen.getByText('早报'))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '早报改' } })
    fireEvent.click(screen.getByText('晚报'))
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByText('当前调度还没保存，放弃这些修改？')).toBeNull()
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('早报改')
  })

  it('保存成功后再换行不再出确认条（快照已刷新）', async () => {
    const onSave = vi.fn(async (next: readonly KbSchedule[]) => {
      await act(async () => { /* noop */ })
      void next
      return true
    })
    render(<SchedulePane {...props({ onSave })} />)
    fireEvent.click(screen.getByText('早报'))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '早报改' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
    fireEvent.click(screen.getByText('晚报'))
    expect(onSave).toHaveBeenCalledOnce()
    expect(screen.queryByText('当前调度还没保存，放弃这些修改？')).toBeNull()
  })

  it('ADR-0064：指令调度保存成功后再换行不再出确认条', async () => {
    const onInstructionScheduleSave = vi.fn(async () => null)
    const view = render(<SchedulePane {...props({ onInstructionScheduleSave })} />)
    fireEvent.click(screen.getByText('周报整理'))
    fireEvent.change(view.container.querySelector('input[type="time"]') as HTMLInputElement, {
      target: { value: '10:30' },
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
    expect(onInstructionScheduleSave).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('早报'))
    expect(screen.queryByText('当前调度还没保存，放弃这些修改？')).toBeNull()
  })

  it('竞态：保存在途时点别的行布下确认条，保存落定后确认条自动消散', async () => {
    let resolveSave: ((accepted: boolean) => void) | null = null
    const onSave = vi.fn((_next: readonly KbSchedule[]) => new Promise<boolean>((resolve) => {
      resolveSave = resolve
    }))
    render(<SchedulePane {...props({ onSave })} />)
    fireEvent.click(screen.getByText('早报'))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '早报改' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    // 保存在途：快照尚未刷新，此时点别的行——守卫按当时还脏的状态布下确认条。
    fireEvent.click(screen.getByText('晚报'))
    expect(screen.getByText('当前调度还没保存，放弃这些修改？')).toBeTruthy()
    // 保存落定，快照刷新，草稿已干净——确认条应当自行消散。
    await act(async () => { resolveSave?.(true) })
    expect(screen.queryByText('当前调度还没保存，放弃这些修改？')).toBeNull()
  })

  it('确认条挂着时把草稿手工改回原样，确认条自动消散', () => {
    render(<SchedulePane {...props()} />)
    fireEvent.click(screen.getByText('早报'))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '早报改' } })
    fireEvent.click(screen.getByText('晚报'))
    expect(screen.getByText('当前调度还没保存，放弃这些修改？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '早报' } })
    fireEvent.click(screen.getByText('晚报'))
    expect(screen.queryByText('当前调度还没保存，放弃这些修改？')).toBeNull()
  })
})
