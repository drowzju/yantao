import { describe, expect, it, vi } from 'vitest'
import { RunPusher, type WorkspaceRunEvent } from '../src/run-push.ts'
import type { ProposalPushChannel } from '../src/proposal-push.ts'

function channel(overrides: Partial<ProposalPushChannel> = {}): ProposalPushChannel & {
  sendMarkdown: ReturnType<typeof vi.fn>
} {
  return {
    accountId: 'acc_default',
    ownerStaffId: () => 'staff_owner',
    cards: undefined,
    sendMarkdown: vi.fn(async () => true),
    ...overrides,
  } as never
}

function runEvent(overrides: Record<string, unknown> = {}): WorkspaceRunEvent {
  return {
    run: {
      id: 'run_1',
      workspaceId: 'wsp_a',
      instructionName: '晨检',
      trigger: 'cron',
      status: 'success',
      startedAt: '2026-10-19T09:00:00.000Z',
      finishedAt: '2026-10-19T09:00:45.000Z',
      finalResult: '晨检完成，一切正常。',
      steps: [{ index: 0, resultExcerpt: '晨检完成，一切正常。' }],
      ...overrides,
    },
  }
}

describe('RunPusher.handleEvent（ADR-0065 决定 3）', () => {
  it('成功运行推一张 markdown 结果卡：指令、触发、耗时、结果摘要、指路', async () => {
    const ch = channel()
    const pusher = new RunPusher({ log: vi.fn() })
    pusher.addChannel(ch)
    await pusher.handleEvent(runEvent())
    expect(ch.sendMarkdown).toHaveBeenCalledTimes(1)
    const [userId, title, text] = ch.sendMarkdown.mock.calls[0] as [string, string, string]
    expect(userId).toBe('staff_owner')
    expect(title).toBe('工作空间运行✔ 成功')
    expect(text).toContain('指令：晨检')
    expect(text).toContain('触发：定时')
    expect(text).toContain('耗时：45 秒')
    expect(text).toContain('结果摘要：晨检完成，一切正常。')
    expect(text).toContain('完整日志见工作台 · 工作空间 · 运行历史')
  })

  it('失败运行带失败原因（取失败步的 error）', async () => {
    const ch = channel()
    const pusher = new RunPusher({ log: vi.fn() })
    pusher.addChannel(ch)
    await pusher.handleEvent(runEvent({
      status: 'failed',
      failedStep: 1,
      finalResult: undefined,
      steps: [
        { index: 0, resultExcerpt: '第一步好了' },
        { index: 1, error: '退出码 1：boom' },
      ],
    }))
    const [, title, text] = ch.sendMarkdown.mock.calls[0] as [string, string, string]
    expect(title).toBe('工作空间运行✘ 失败')
    expect(text).toContain('失败原因：退出码 1：boom')
    expect(text).not.toContain('结果摘要')
  })

  it('停止运行也推（■ 已停止）', async () => {
    const ch = channel()
    const pusher = new RunPusher({ log: vi.fn() })
    pusher.addChannel(ch)
    await pusher.handleEvent(runEvent({ status: 'stopped', finalResult: undefined, finishedAt: '2026-10-19T09:02:00.000Z' }))
    const [, title, text] = ch.sendMarkdown.mock.calls[0] as [string, string, string]
    expect(title).toBe('工作空间运行■ 已停止')
    expect(text).toContain('耗时：2 分钟')
  })

  it('interrupted / missed 不推（簿记噪音与控制器死亡）', async () => {
    const log = vi.fn()
    const ch = channel()
    const pusher = new RunPusher({ log })
    pusher.addChannel(ch)
    await pusher.handleEvent(runEvent({ status: 'interrupted' }))
    await pusher.handleEvent(runEvent({ status: 'missed' }))
    expect(ch.sendMarkdown).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not pushable'))
  })

  it('无通道或属主未绑定时安静放弃', async () => {
    const log = vi.fn()
    const ch = channel()
    const unbound = new RunPusher({ log }) // 一个通道都没注册
    await unbound.handleEvent(runEvent())
    expect(ch.sendMarkdown).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no robot with a bound owner'))

    const ch2 = channel({ ownerStaffId: () => undefined })
    const noOwner = new RunPusher({ log: vi.fn() })
    noOwner.addChannel(ch2)
    await noOwner.handleEvent(runEvent())
    expect(ch2.sendMarkdown).not.toHaveBeenCalled()
  })

  it('removeChannel 后不再推；载荷残缺安静返回', async () => {
    const ch = channel()
    const pusher = new RunPusher({ log: vi.fn() })
    pusher.addChannel(ch)
    pusher.removeChannel('acc_other')
    await pusher.handleEvent(runEvent())
    expect(ch.sendMarkdown).toHaveBeenCalledTimes(1)
    pusher.removeChannel('acc_default')
    await pusher.handleEvent(runEvent({ id: 'run_2' }))
    expect(ch.sendMarkdown).toHaveBeenCalledTimes(1)

    await pusher.handleEvent({ run: { status: 'success' } as never }) // 无 id
    await pusher.handleEvent(undefined as never)
    expect(ch.sendMarkdown).toHaveBeenCalledTimes(1)
  })
})
