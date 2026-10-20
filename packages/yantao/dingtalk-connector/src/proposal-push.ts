/**
 * ADR-0060 决定 7 ⑥⑦：提议入队 → 属主私聊卡片推送；卡片批准/丢弃 →
 * 服务端 `proposalInboxApply` / `proposalInboxResolve` 落库。
 *
 * - 订阅点是控制器广播的 `yantao-kb/proposal-inbox` 事件（决定 5），只在
 *   `enqueue` 且行待决时出手；resolve 是工作台自己的回声，不推。
 * - 目标地址不需要新存储：属主 staffId 已由 OwnerBinding 持久化，卡片按
 *   `IM_ROBOT.{staffId}` 私发；无卡片模板时退化为主动 markdown 通知
 *   （`Outbound.sendProactiveMarkdown`）。
 * - 推送定位（2026-10-17 用户裁决，两改之后定稿）：钉钉消息**只做知会**，
 *   不做手机端决策——决策回归工作台提议页。但知会必须给足信息：逐动作的
 *   可读明细（邮件带主题与发件人、待办带标题与正文、动态带目标与正文），
 *   让用户在手机上也能了解发生了什么、即将发生什么。
 * - 危险动作（决定 8，2026-10-17 修订）：邮件删除/归档与技能改写也上卡，
 *   但「批准」是武装两击——首击只把按钮翻成「确认执行？」，再击才落库。
 *   信任锚从「不许上卡」改为「刻意的第二次点击」；武装态在内存，重启即
 *   清空（fail-safe：重启后首击回到武装步）。卡片路径属可选增强——需要
 *   卡片平台模板，本部署暂不可用；markdown 知会是常态形态。
 * - 幂等（决定 7）：outTrackId 直接内嵌条目 id（`proposal_prp_xxx`），
 *   重启后按钮回调仍能解析；重复批准由服务端的 already-decided 判别吸收，
 *   重复丢弃撞上已决行走「已经决策」容错，卡片状态不会被误改回待决。
 */
import type { InteractionCardCallback, InteractionCardSender } from './interaction-card.js'

/** 卡片 outTrackId 的前缀；后面直接拼收件箱条目 id。 */
export const PROPOSAL_TRACK_PREFIX = 'proposal_'

/** 控制器收件箱面的鸭子类型——不引包依赖，结构相容即可（进程内直调）。 */
export interface ProposalInboxControllerFace {
  proposalInboxApply(args: { id: string }): Promise<ProposalApplyOutcome>
  proposalInboxResolve(args: { id: string; status: 'discarded' }): Promise<unknown>
}

/** `KbProposalInboxApplyResult` 的结构影子（只取连接器要看的字段）。 */
export interface ProposalApplyOutcome {
  kind: 'applied' | 'preflight-blocked' | 'already-decided' | string
  status?: string
  message?: string
  apply?: { written?: readonly string[]; skipped?: readonly string[] }
}

/** `KbProposalInboxEvent` 的结构影子（ADR-0060 决定 5 的广播载荷）。 */
export interface ProposalInboxEvent {
  action: string
  entry: {
    id: string
    status: string
    title?: string
    sourceName?: string
    note?: string
    proposal?: unknown
    /** 裁决行的逐动作落库结果（ADR-0059 决定 5）；resolve 事件携带。 */
    applyResults?: readonly { ok?: boolean; error?: string }[]
  }
}

/** 危险动作（ADR-0060 决定 8，2026-10-17 修订）：邮件刀具与技能改写可以
 * 上卡，但批准走武装两击——首击只翻按钮文案，再击才落库。 */
const DANGEROUS_KINDS: ReadonlySet<string> = new Set(['delete-mails', 'archive-mails', 'skill-rewrite'])

/** 武装态下批准按钮的翻转文案。 */
const ARMED_APPROVE_LABEL = '⚠️ 确认执行？'

/** 危险卡明细尾行的固定警示。 */
const DANGER_NOTICE = '⚠️ 含危险动作（邮件删除/归档或技能改写），批准需两次点击确认。'

export interface ProposalDigest {
  dangerous: boolean
  /** 逐动作的一行人话描述（决策依据；卡片与 markdown 推送共用）。 */
  lines: readonly string[]
}

/** 折叠空白并截断到 maxLen（超长以 … 收尾）——明细行保持一行一条。 */
export function excerpt(text: string, maxLen: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > maxLen ? `${flat.slice(0, maxLen)}…` : flat
}

/** 单条动作的一行人话描述（2026-10-17 裁决：计数行不足以决策，必须给足
 * 内容——邮件带主题与发件人、待办带标题与正文、动态带目标与正文）。 */
export function describeAction(raw: unknown, maxLen = 60): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const bag = raw as Record<string, unknown>
  const kind = typeof bag.kind === 'string' ? bag.kind : undefined
  if (kind === undefined) return null
  const clip = (key: string): string =>
    typeof bag[key] === 'string' ? excerpt(bag[key] as string, maxLen) : ''
  const target = (): string => clip('entityName') || clip('entityPath')
  switch (kind) {
    case 'create-entity': return `新建${clip('entityType') || '实体'}「${clip('name')}」`
    case 'create-project': return `新建项目「${clip('name')}」`
    case 'append-log': return `给「${target()}」追加动态：${clip('text')}`
    case 'write-state': return `改写「${target()}」状态：${clip('text')}`
    case 'save-resource': return `保存资源 ${clip('path')}`
    case 'create-link': return `给「${target()}」添加链接：${clip('link')}`
    case 'add-todo': {
      const body = clip('body')
      return `新增待办「${clip('title')}」${body !== '' ? `：${body}` : ''}`
    }
    case 'edit-section': return `编辑 ${clip('path')} 的「${clip('section')}」节：${clip('why')}`
    case 'append-section': return `给 ${clip('path')} 的「${clip('section')}」节追加：${clip('text')}`
    case 'add-memory': return `写入记忆（${clip('scope')}）：${clip('text')}`
    case 'delete-mails': return `删除邮件「${clip('subject')}」（${clip('sender')}）`
    case 'archive-mails': return `归档邮件「${clip('subject')}」（${clip('sender')}）`
    case 'skill-rewrite': return `改写技能 ${clip('name')}/${clip('file')}：${clip('why')}`
    default: return kind
  }
}

/** 防御性解析存储载荷：判危险、渲染逐动作明细。解析不动就放弃推送（宁可
 * 沉默，不推一张点了没反应的卡）。 */
export function digestProposalPayload(payload: unknown): ProposalDigest | null {
  if (typeof payload !== 'object' || payload === null) return null
  const actions = (payload as { actions?: unknown }).actions
  if (!Array.isArray(actions) || actions.length === 0) return null
  const lines: string[] = []
  for (const raw of actions) {
    const kind = typeof raw === 'object' && raw !== null ? (raw as { kind?: unknown }).kind : undefined
    if (typeof kind !== 'string') return null
    const line = describeAction(raw)
    if (line === null) return null
    lines.push(line)
  }
  const dangerous = actions.some(
    raw => DANGEROUS_KINDS.has((raw as { kind: string }).kind),
  )
  return { dangerous, lines }
}

/** 一个已启动机器人栈的推送面：属主私聊的两种载体。 */
export interface ProposalPushChannel {
  readonly accountId: string
  /** 已绑定属主的 staffId；未绑定返回 undefined（此时不推）。 */
  ownerStaffId(): string | undefined
  /** 模板卡片发送器；未配置模板时缺席，退化为主动 markdown 通知。 */
  readonly cards: InteractionCardSender | undefined
  /** 主动私聊 markdown（Outbound.sendProactiveMarkdown 的转发）。 */
  sendMarkdown(userId: string, title: string, text: string): Promise<boolean>
}

const CARD_UPDATE_OPTIONS = { cardUpdateOptions: { updateCardDataByKey: true } }

/** 服务端判别 → 卡片状态字。 */
function cardStatusFor(outcome: ProposalApplyOutcome): string {
  if (outcome.kind === 'preflight-blocked') return 'pending'
  if (outcome.kind === 'already-decided') {
    return outcome.status === 'approved' || outcome.status === 'approved-with-errors' ? 'approved' : 'rejected'
  }
  switch (outcome.status) {
    case 'approved':
    case 'approved-with-errors':
      return 'approved'
    case 'failed':
      return 'rejected'
    default:
      return 'pending'
  }
}

export class ProposalPusher {
  private readonly channels: ProposalPushChannel[] = []
  /** 发过危险卡的轨道：批准回调据此判断要不要先武装。 */
  private readonly dangerousTracks = new Set<string>()
  /** 已武装（首击过）的轨道：再击才真正落库。内存态，重启即清（fail-safe）。 */
  private readonly armedApprovals = new Set<string>()
  /**
   * 卡片回调自己发起落库的条目 id（ADR-0065 决定 3）：这些 id 的 resolve
   * 事件是本类自己触发的回声，handleResolved 见到即跳过——回调路径已经
   * 就地推过结果，同一裁决不能推两遍。RPC 失败时撤销登记，不留幽灵。
   */
  private readonly selfResolvedIds = new Set<string>()

  constructor(
    private readonly deps: {
      resolveController: () => ProposalInboxControllerFace | undefined
      log: (line: string) => void
    },
  ) {}

  addChannel(channel: ProposalPushChannel): void {
    this.channels.push(channel)
  }

  removeChannel(accountId: string): void {
    const at = this.channels.findIndex(channel => channel.accountId === accountId)
    if (at >= 0) this.channels.splice(at, 1)
  }

  /** `yantao-kb/proposal-inbox` 的消费者：enqueue 推待决卡；resolve（ADR-0065
   * 决定 3）推裁决结果知会——卡片回调自己发起的落库除外（回声抑制）。 */
  async handleEvent(update: ProposalInboxEvent): Promise<void> {
    if (update?.action === 'resolve') {
      await this.handleResolved(update)
      return
    }
    if (update?.action !== 'enqueue' || update.entry?.status !== 'pending') return
    if (!this.deps.resolveController()) {
      this.deps.log('proposal enqueue: KB controller unavailable — card not pushed')
      return
    }
    const digest = digestProposalPayload(update.entry.proposal)
    if (digest === null) {
      this.deps.log(`proposal enqueue ${update.entry.id}: payload not parseable as actions — push abandoned`)
      return
    }
    const channel = this.channels.find(candidate => candidate.ownerStaffId() !== undefined)
    if (channel === undefined) {
      this.deps.log('proposal enqueue: no robot with a bound owner — card not pushed')
      return
    }
    const userId = channel.ownerStaffId() as string
    const title = `提议待决：${update.entry.title ?? update.entry.id}`
    const sourceLine = update.entry.sourceName ? `来源：${update.entry.sourceName}` : ''
    const noteLine = update.entry.note ? `备注：${update.entry.note}` : ''
    const trackId = `${PROPOSAL_TRACK_PREFIX}${update.entry.id}`
    if (channel.cards === undefined) {
      // 纯知会推送（2026-10-17 裁决定稿）：只总结内容、给足信息，决策在
      // 工作台提议页完成——不做手机端操作。
      const text = [
        sourceLine,
        noteLine,
        ...digest.lines.map((line, at) => `${at + 1}. ${line}`),
        digest.dangerous ? '⚠️ 含危险动作（邮件删除/归档或技能改写）。' : undefined,
        '请在工作台的提议页决策。',
      ]
        .filter(Boolean)
        .join('\n')
      const ok = await channel.sendMarkdown(userId, title, text)
      this.deps.log(`proposal enqueue ${update.entry.id}: proactive markdown to ${userId} (${digest.dangerous ? 'dangerous' : 'safe'}) → ${ok ? 'sent' : 'FAILED'}`)
      return
    }
    if (digest.dangerous) this.dangerousTracks.add(trackId)
    this.deps.log(`proposal enqueue ${update.entry.id}: creating ${digest.dangerous ? 'ARMED' : 'regular'} interaction card for ${userId}`)
    await channel.cards.create({
      outTrackId: trackId,
      kind: 'proposal',
      target: { type: 'user', userId },
      title,
      detail: [sourceLine, noteLine, ...digest.lines, digest.dangerous ? DANGER_NOTICE : undefined]
        .filter(Boolean)
        .join('\n'),
      approveLabel: '✅ 批准',
      rejectLabel: '🗑️ 丢弃',
    })
  }

  /**
   * resolve 分支（ADR-0065 决定 3）：人裁决完一条提议后，属主收到结果知会
   * ——四态各一词（已批准/部分批准/零写入/已丢弃），带逐动作失败计数。
   * 决策本身永远在工作台提议页（或卡片），这里只做知会。
   */
  private async handleResolved(update: ProposalInboxEvent): Promise<void> {
    const entry = update.entry
    if (entry?.id === undefined) return
    if (this.selfResolvedIds.delete(entry.id)) {
      this.deps.log(`proposal resolve ${entry.id}: self-originated (card callback) — echo suppressed`)
      return
    }
    const channel = this.channels.find(candidate => candidate.ownerStaffId() !== undefined)
    if (channel === undefined) {
      this.deps.log(`proposal resolve ${entry.id}: no robot with a bound owner — not pushed`)
      return
    }
    const userId = channel.ownerStaffId() as string
    const verdicts: Record<string, string> = {
      approved: '✅ 已批准，全部动作落库',
      'approved-with-errors': '🟡 部分批准，部分动作落库失败',
      failed: '🔴 批准执行，但全部动作落库失败',
      discarded: '⚪ 已丢弃，未做任何写入',
    }
    const verdict = verdicts[entry.status] ?? `裁决结果：${entry.status}`
    const failedCount = (entry.applyResults ?? []).filter(record => record?.ok === false).length
    const text = [
      entry.title ?? entry.id,
      entry.sourceName ? `来源：${entry.sourceName}` : '',
      verdict,
      failedCount > 0 ? `其中 ${failedCount} 个动作落库失败，明细见工作台提议页。` : undefined,
      '明细见工作台的提议页。',
    ]
      .filter(Boolean)
      .join('\n')
    const ok = await channel.sendMarkdown(userId, `提议已裁决：${entry.title ?? entry.id}`, text)
    this.deps.log(`proposal resolve ${entry.id} (${entry.status}): proactive markdown to ${userId} → ${ok ? 'sent' : 'FAILED'}`)
  }

  /**
   * 卡片按钮回调（#14）：approve → 服务端 apply（与工作台同一 RPC，重复
   * 点击幂等）；reject → 服务端记丢弃。返回值是卡片状态补丁；undefined 表示
   * 不是本类的卡，交还外层链。
   *
   * 武装两击（决定 8 修订）：危险卡的首击不落库，只把批准按钮翻成
   * 「⚠️ 确认执行？」并记入 armedApprovals；再击才 apply。武装态在内存，
   * 重启即清——届时首击重新武装，方向永远偏保守。
   */
  async handleCardCallback(callback: InteractionCardCallback): Promise<Record<string, unknown> | undefined> {
    if (!callback.outTrackId.startsWith(PROPOSAL_TRACK_PREFIX)) return undefined
    const id = callback.outTrackId.slice(PROPOSAL_TRACK_PREFIX.length)
    // 纵深防御：卡片虽私发属主，按键者的身份仍要对上某个栈的属主。
    const authorized = this.channels.some(channel => channel.ownerStaffId() === callback.userId)
    if (!authorized) {
      this.deps.log(`proposal card callback from non-owner ${callback.userId} — ignored`)
      return { cardData: { cardParamMap: { status: 'pending' } }, ...CARD_UPDATE_OPTIONS }
    }
    const controller = this.deps.resolveController()
    if (controller === undefined) return { cardData: { cardParamMap: { status: 'pending' } }, ...CARD_UPDATE_OPTIONS }
    if (callback.actionIds[0] === 'approve') {
      if (this.dangerousTracks.has(callback.outTrackId) && !this.armedApprovals.has(callback.outTrackId)) {
        this.armedApprovals.add(callback.outTrackId)
        this.deps.log(`proposal card ${id}: dangerous approve armed (first tap) — awaiting confirmation`)
        return {
          cardData: { cardParamMap: { status: 'pending', approveLabel: ARMED_APPROVE_LABEL } },
          ...CARD_UPDATE_OPTIONS,
        }
      }
      try {
        this.selfResolvedIds.add(id)
        const outcome = await controller.proposalInboxApply({ id })
        this.disarm(callback.outTrackId)
        return { cardData: { cardParamMap: { status: cardStatusFor(outcome) } }, ...CARD_UPDATE_OPTIONS }
      } catch (error) {
        this.selfResolvedIds.delete(id)
        const message = error instanceof Error ? error.message : String(error)
        this.deps.log(`proposal card approve failed: ${message}`)
        // 行不存在（已被清理）如实点灭；其余故障保持待决，工作台仍是真相。
        const status = message.includes('不存在') ? 'rejected' : 'pending'
        // 真故障只解除武装、保留危险标记：下一次批准重新从首击起步，
        // 不让故障撕开两击防线（单击直达落库）的口子。
        this.armedApprovals.delete(callback.outTrackId)
        return { cardData: { cardParamMap: { status } }, ...CARD_UPDATE_OPTIONS }
      }
    }
    try {
      this.selfResolvedIds.add(id)
      await controller.proposalInboxResolve({ id, status: 'discarded' })
      this.disarm(callback.outTrackId)
      return { cardData: { cardParamMap: { status: 'rejected' } }, ...CARD_UPDATE_OPTIONS }
    } catch (error) {
      this.selfResolvedIds.delete(id)
      const message = error instanceof Error ? error.message : String(error)
      this.deps.log(`proposal card discard failed: ${message}`)
      // 已决行的重复丢弃是幂等事件，如实回报；真故障保持待决。
      const status = message.includes('已经决策') ? 'rejected' : 'pending'
      if (status === 'rejected') this.disarm(callback.outTrackId)
      return { cardData: { cardParamMap: { status } }, ...CARD_UPDATE_OPTIONS }
    }
  }

  /** 轨道结算（落库成功/失败终态/丢弃）后清掉两张内存簿，防长期累积。 */
  private disarm(trackId: string): void {
    this.armedApprovals.delete(trackId)
    this.dangerousTracks.delete(trackId)
  }
}
