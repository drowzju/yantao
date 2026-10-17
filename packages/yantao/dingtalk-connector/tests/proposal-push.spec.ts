import { describe, expect, it, vi } from 'vitest'
import {
  PROPOSAL_TRACK_PREFIX,
  ProposalPusher,
  digestProposalPayload,
  type ProposalInboxControllerFace,
  type ProposalPushChannel,
} from '../src/proposal-push.ts'
import type { InteractionCardSender } from '../src/interaction-card.ts'

function safePayload(): unknown {
  return {
    title: '晨检发现',
    actions: [
      { kind: 'append-log', entityPath: 'project:x', text: '有进展', reason: '晨检' },
      { kind: 'write-state', entityPath: 'project:x', text: '进行中', reason: '晨检' },
    ],
  }
}

function channel(overrides: Partial<ProposalPushChannel> = {}): ProposalPushChannel & {
  cards: InteractionCardSender
  sendMarkdown: ReturnType<typeof vi.fn>
} {
  return {
    accountId: 'acc_default',
    ownerStaffId: () => 'staff_owner',
    cards: { create: vi.fn(async () => true) },
    sendMarkdown: vi.fn(async () => true),
    ...overrides,
  } as never
}

function controller(overrides: {
  apply?: ReturnType<typeof vi.fn>
  resolve?: ReturnType<typeof vi.fn>
} = {}): ProposalInboxControllerFace {
  return {
    proposalInboxApply: overrides.apply ?? vi.fn(async () => ({ kind: 'applied', status: 'approved' })),
    proposalInboxResolve: overrides.resolve ?? vi.fn(async () => ({})),
  }
}

function enqueueEvent(id = 'prp_1', proposal: unknown = safePayload()): {
  action: string
  entry: { id: string; status: string; title: string; sourceName: string; proposal: unknown }
} {
  return { action: 'enqueue', entry: { id, status: 'pending', title: '晨检发现', sourceName: '晨检', proposal } }
}

describe('digestProposalPayload', () => {
  it('安全载荷分类：逐动作可读明细，不判危险', () => {
    const digest = digestProposalPayload(safePayload())
    expect(digest).toEqual({
      dangerous: false,
      lines: ['给「project:x」追加动态：有进展', '改写「project:x」状态：进行中'],
    })
  })

  it('邮件刀具或技能改写判危险', () => {
    expect(digestProposalPayload({
      actions: [{ kind: 'delete-mails', entryId: 'm-1', sender: 's@x', subject: 'x' }],
    })?.dangerous).toBe(true)
    expect(digestProposalPayload({
      actions: [{ kind: 'skill-rewrite', name: 'n', file: 'f', original: 'o', new: 'n', why: 'w' }],
    })?.dangerous).toBe(true)
    expect(digestProposalPayload({ actions: [{ kind: 'add-memory', scope: 'self', text: 't' }] })?.dangerous)
      .toBe(false)
  })

  it('载荷残缺返回 null（宁可沉默不推死卡）', () => {
    expect(digestProposalPayload(null)).toBeNull()
    expect(digestProposalPayload({})).toBeNull()
    expect(digestProposalPayload({ actions: [] })).toBeNull()
    expect(digestProposalPayload({ actions: [{ noKind: true }] })).toBeNull()
  })

  it('明细行带内容：邮件给主题与发件人，待办给标题与正文，超长截断', () => {
    const digest = digestProposalPayload({
      actions: [
        { kind: 'delete-mails', entryId: 'm-1', sender: 'boss@corp', subject: '季度报告' },
        { kind: 'add-todo', title: '跟进合同', body: '本周内回复法务' },
        { kind: 'append-log', entityPath: 'project:x', text: '很长的动态'.repeat(30) },
      ],
    })
    expect(digest?.lines).toEqual([
      '删除邮件「季度报告」（boss@corp）',
      '新增待办「跟进合同」：本周内回复法务',
      `给「project:x」追加动态：${'很长的动态'.repeat(12)}…`,
    ])
  })
})

describe('ProposalPusher.handleEvent（ADR-0060 决定 7 ⑥）', () => {
  it('安全提议推交互卡：轨道内嵌条目 id，按钮文案到位', async () => {
    const ch = channel()
    const pusher = new ProposalPusher({ resolveController: () => controller(), log: vi.fn() })
    pusher.addChannel(ch)
    await pusher.handleEvent(enqueueEvent())
    expect(ch.cards.create).toHaveBeenCalledWith(expect.objectContaining({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_1`,
      kind: 'proposal',
      target: { type: 'user', userId: 'staff_owner' },
      title: '提议待决：晨检发现',
      detail: '来源：晨检\n给「project:x」追加动态：有进展\n改写「project:x」状态：进行中',
      approveLabel: '✅ 批准',
      rejectLabel: '🗑️ 丢弃',
    }))
    expect(ch.sendMarkdown).not.toHaveBeenCalled()
  })

  it('危险提议上武装卡：明细带警示行，卡片而非 markdown', async () => {
    const ch = channel()
    const pusher = new ProposalPusher({ resolveController: () => controller(), log: vi.fn() })
    pusher.addChannel(ch)
    await pusher.handleEvent(enqueueEvent('prp_2', {
      actions: [{ kind: 'delete-mails', entryId: 'm-1', sender: 's@x', subject: 'x' }],
    }))
    expect(ch.cards.create).toHaveBeenCalledWith(expect.objectContaining({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_2`,
      kind: 'proposal',
      detail: expect.stringContaining('批准需两次点击确认'),
    }))
    expect(ch.sendMarkdown).not.toHaveBeenCalled()
  })

  it('未配置卡片模板：提议走纯知会 markdown（富明细+工作台指路）', async () => {
    const ch = channel({ cards: undefined })
    const pusher = new ProposalPusher({ resolveController: () => controller(), log: vi.fn() })
    pusher.addChannel(ch)
    await pusher.handleEvent(enqueueEvent())
    const text = (ch.sendMarkdown.mock.calls[0]?.[2] ?? '') as string
    expect(text).toContain('给「project:x」追加动态：有进展')
    expect(text).toContain('改写「project:x」状态：进行中')
    expect(text).toContain('请在工作台的提议页决策')
    expect(text).not.toContain('批准')

    const ch2 = channel({ cards: undefined })
    const pusher2 = new ProposalPusher({ resolveController: () => controller(), log: vi.fn() })
    pusher2.addChannel(ch2)
    await pusher2.handleEvent(enqueueEvent('prp_2', {
      actions: [{ kind: 'delete-mails', entryId: 'm-1', sender: 's@x', subject: 'x' }],
    }))
    expect(ch2.sendMarkdown).toHaveBeenCalledWith('staff_owner', expect.anything(),
      expect.stringContaining('危险动作'))
  })

  it('无已绑定通道或控制器缺席时安静放弃；resolve 回声不推', async () => {
    const log = vi.fn()
    const ch = channel()
    const unbound = new ProposalPusher({ resolveController: () => undefined, log })
    unbound.addChannel(ch)
    await unbound.handleEvent(enqueueEvent())
    expect(ch.cards.create).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('KB controller unavailable'))

    const ch2 = channel({ ownerStaffId: () => undefined })
    const noOwner = new ProposalPusher({ resolveController: () => controller(), log: vi.fn() })
    noOwner.addChannel(ch2)
    await noOwner.handleEvent(enqueueEvent())
    expect(ch2.cards.create).not.toHaveBeenCalled()

    const ch3 = channel()
    const echo = new ProposalPusher({ resolveController: () => controller(), log: vi.fn() })
    echo.addChannel(ch3)
    await echo.handleEvent({ action: 'resolve', entry: { id: 'prp_1', status: 'approved' } })
    expect(ch3.cards.create).not.toHaveBeenCalled()
  })
})

describe('ProposalPusher.handleCardCallback（ADR-0060 决定 7 ⑦）', () => {
  it('批准 → 服务端 apply，卡片点亮 approved', async () => {
    const apply = vi.fn(async () => ({ kind: 'applied', status: 'approved' }))
    const pusher = new ProposalPusher({ resolveController: () => controller({ apply }), log: vi.fn() })
    pusher.addChannel(channel())
    const patch = await pusher.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_1`,
      userId: 'staff_owner',
      actionIds: ['approve'],
      params: {},
    })
    expect(apply).toHaveBeenCalledWith({ id: 'prp_1' })
    expect(patch).toMatchObject({ cardData: { cardParamMap: { status: 'approved' } } })
  })

  it('重复批准幂等：already-decided 映射既有决策', async () => {
    const apply = vi.fn(async () => ({ kind: 'already-decided', status: 'approved' }))
    const pusher = new ProposalPusher({ resolveController: () => controller({ apply }), log: vi.fn() })
    pusher.addChannel(channel())
    const patch = await pusher.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_1`, userId: 'staff_owner', actionIds: ['approve'], params: {},
    })
    expect(patch).toMatchObject({ cardData: { cardParamMap: { status: 'approved' } } })
  })

  it('preflight-blocked 保持待决；零写入失败如实点灭', async () => {
    const pusher = new ProposalPusher({
      resolveController: () => controller({
        apply: vi.fn(async () => ({ kind: 'preflight-blocked', message: '请重启', unreachable: [] })),
      }),
      log: vi.fn(),
    })
    pusher.addChannel(channel())
    const blocked = await pusher.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_1`, userId: 'staff_owner', actionIds: ['approve'], params: {},
    })
    expect(blocked).toMatchObject({ cardData: { cardParamMap: { status: 'pending' } } })

    const pusher2 = new ProposalPusher({
      resolveController: () => controller({ apply: vi.fn(async () => ({ kind: 'applied', status: 'failed' })) }),
      log: vi.fn(),
    })
    pusher2.addChannel(channel())
    const failed = await pusher2.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_2`, userId: 'staff_owner', actionIds: ['approve'], params: {},
    })
    expect(failed).toMatchObject({ cardData: { cardParamMap: { status: 'rejected' } } })
  })

  it('丢弃 → 服务端记 discarded；重复丢弃撞已决行幂等回报', async () => {
    const resolve = vi.fn(async () => ({}))
    const pusher = new ProposalPusher({ resolveController: () => controller({ resolve }), log: vi.fn() })
    pusher.addChannel(channel())
    const patch = await pusher.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_1`, userId: 'staff_owner', actionIds: ['reject'], params: {},
    })
    expect(resolve).toHaveBeenCalledWith({ id: 'prp_1', status: 'discarded' })
    expect(patch).toMatchObject({ cardData: { cardParamMap: { status: 'rejected' } } })

    const rejectingResolve = vi.fn(async () => { throw new Error('该条目已经决策过') })
    const pusher2 = new ProposalPusher({
      resolveController: () => controller({ resolve: rejectingResolve }), log: vi.fn(),
    })
    pusher2.addChannel(channel())
    const idempotent = await pusher2.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_1`, userId: 'staff_owner', actionIds: ['reject'], params: {},
    })
    expect(idempotent).toMatchObject({ cardData: { cardParamMap: { status: 'rejected' } } })

    const flakyResolve = vi.fn(async () => { throw new Error('disk full') })
    const pusher3 = new ProposalPusher({
      resolveController: () => controller({ resolve: flakyResolve }), log: vi.fn(),
    })
    pusher3.addChannel(channel())
    const stuck = await pusher3.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_3`, userId: 'staff_owner', actionIds: ['reject'], params: {},
    })
    expect(stuck).toMatchObject({ cardData: { cardParamMap: { status: 'pending' } } })
  })

  it('非属主按键被拒；他人轨道交还外层链', async () => {
    const apply = vi.fn(async () => ({ kind: 'applied', status: 'approved' }))
    const log = vi.fn()
    const pusher = new ProposalPusher({ resolveController: () => controller({ apply }), log })
    pusher.addChannel(channel())
    const stranger = await pusher.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_1`, userId: 'staff_intruder', actionIds: ['approve'], params: {},
    })
    expect(apply).not.toHaveBeenCalled()
    expect(stranger).toMatchObject({ cardData: { cardParamMap: { status: 'pending' } } })

    const foreign = await pusher.handleCardCallback({
      outTrackId: 'busy_123', userId: 'staff_owner', actionIds: ['approve'], params: {},
    })
    expect(foreign).toBeUndefined()
  })

  it('武装两击（决定 8 修订）：危险卡首击只翻按钮，再击才落库', async () => {
    const apply = vi.fn(async () => ({ kind: 'applied', status: 'approved' }))
    const log = vi.fn()
    const pusher = new ProposalPusher({ resolveController: () => controller({ apply }), log })
    const ch = channel()
    pusher.addChannel(ch)
    // 入队一张危险卡（登记 dangerousTracks）。
    await pusher.handleEvent(enqueueEvent('prp_d', {
      actions: [{ kind: 'archive-mails', entryId: 'm-9', sender: 's@x', subject: 'x' }],
    }))
    const track = `${PROPOSAL_TRACK_PREFIX}prp_d`
    // 首击：武装，不落库。
    const first = await pusher.handleCardCallback({ outTrackId: track, userId: 'staff_owner', actionIds: ['approve'], params: {} })
    expect(apply).not.toHaveBeenCalled()
    expect(first).toMatchObject({
      cardData: { cardParamMap: { status: 'pending', approveLabel: '⚠️ 确认执行？' } },
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('armed (first tap)'))
    // 再击：落库。
    const second = await pusher.handleCardCallback({ outTrackId: track, userId: 'staff_owner', actionIds: ['approve'], params: {} })
    expect(apply).toHaveBeenCalledWith({ id: 'prp_d' })
    expect(second).toMatchObject({ cardData: { cardParamMap: { status: 'approved' } } })
    // 结算后武装簿清空：再来一发同轨道（异常情形）从首击重新起步。
    await pusher.handleEvent(enqueueEvent('prp_d', {
      actions: [{ kind: 'archive-mails', entryId: 'm-9', sender: 's@x', subject: 'x' }],
    }))
    const rearmed = await pusher.handleCardCallback({ outTrackId: track, userId: 'staff_owner', actionIds: ['approve'], params: {} })
    expect(rearmed).toMatchObject({ cardData: { cardParamMap: { approveLabel: '⚠️ 确认执行？' } } })
  })

  it('安全卡不受武装影响：单击即落库', async () => {
    const apply = vi.fn(async () => ({ kind: 'applied', status: 'approved' }))
    const pusher = new ProposalPusher({ resolveController: () => controller({ apply }), log: vi.fn() })
    pusher.addChannel(channel())
    await pusher.handleEvent(enqueueEvent('prp_safe'))
    const patch = await pusher.handleCardCallback({
      outTrackId: `${PROPOSAL_TRACK_PREFIX}prp_safe`, userId: 'staff_owner', actionIds: ['approve'], params: {},
    })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(patch).toMatchObject({ cardData: { cardParamMap: { status: 'approved' } } })
  })

  it('武装后丢弃：单击结算并解除武装', async () => {
    const resolve = vi.fn(async () => ({}))
    const pusher = new ProposalPusher({ resolveController: () => controller({ resolve }), log: vi.fn() })
    pusher.addChannel(channel())
    await pusher.handleEvent(enqueueEvent('prp_e', {
      actions: [{ kind: 'delete-mails', entryId: 'm-1', sender: 's@x', subject: 'x' }],
    }))
    const track = `${PROPOSAL_TRACK_PREFIX}prp_e`
    await pusher.handleCardCallback({ outTrackId: track, userId: 'staff_owner', actionIds: ['approve'], params: {} })
    const patch = await pusher.handleCardCallback({ outTrackId: track, userId: 'staff_owner', actionIds: ['reject'], params: {} })
    expect(resolve).toHaveBeenCalledWith({ id: 'prp_e', status: 'discarded' })
    expect(patch).toMatchObject({ cardData: { cardParamMap: { status: 'rejected' } } })
  })

  it('武装后批准遇真故障：解除武装，下次从首击重新起步', async () => {
    const apply = vi.fn(async () => { throw new Error('network down') })
    const pusher = new ProposalPusher({ resolveController: () => controller({ apply }), log: vi.fn() })
    pusher.addChannel(channel())
    await pusher.handleEvent(enqueueEvent('prp_f', {
      actions: [{ kind: 'delete-mails', entryId: 'm-1', sender: 's@x', subject: 'x' }],
    }))
    const track = `${PROPOSAL_TRACK_PREFIX}prp_f`
    await pusher.handleCardCallback({ outTrackId: track, userId: 'staff_owner', actionIds: ['approve'], params: {} })
    const failed = await pusher.handleCardCallback({ outTrackId: track, userId: 'staff_owner', actionIds: ['approve'], params: {} })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(failed).toMatchObject({ cardData: { cardParamMap: { status: 'pending' } } })
    // 故障后武装已清：再击又是首击（武装），不落库。
    const rearmed = await pusher.handleCardCallback({ outTrackId: track, userId: 'staff_owner', actionIds: ['approve'], params: {} })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(rearmed).toMatchObject({ cardData: { cardParamMap: { approveLabel: '⚠️ 确认执行？' } } })
  })
})
