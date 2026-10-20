/**
 * ADR-0065 决定 3：工作空间运行完结 → 属主私聊知会。成功/失败/停止三种
 * 终态各推一张 markdown 结果卡（ADR-0060 补记四「纯知会富明细」的 P2
 * 落地——消息只做知会，日志与重跑在工作台）；missed 是簿记噪音、
 * interrupted 意味着控制器自己死了，两者都不推。
 *
 * 订阅点是控制器广播的 `yantao-kb/workspace-run` 事件（runtime 的
 * onFinalized 回调触发，每次终态恰好一发）；通道注册与提议推送同一姿势
 * ——机器人栈启动时 addChannel，属主未绑定则自查放弃。
 */
import { excerpt } from './proposal-push.js'
import type { ProposalPushChannel } from './proposal-push.js'

/** `KbWorkspaceRunEvent` 的结构影子（控制器 types.ts 的广播载荷）。 */
export interface WorkspaceRunEvent {
  run: {
    id: string
    workspaceId?: string
    instructionName?: string
    trigger?: string
    status: string
    startedAt?: string
    finishedAt?: string
    failedStep?: number
    finalResult?: string
    steps?: readonly { index?: number; error?: string; resultExcerpt?: string }[]
  }
}

/** 与提议推送同构的推送面（属主私聊 markdown）。 */
export type RunPushChannel = ProposalPushChannel

/** 终态 → 中文状态字（其余状态一律不推）。 */
const PUSHABLE_STATUS: Record<string, string> = {
  success: '✔ 成功',
  failed: '✘ 失败',
  stopped: '■ 已停止',
}

const TRIGGER_TEXT: Record<string, string> = {
  manual: '手动',
  cron: '定时',
  agent: '会话触发',
}

/** 起止时刻都齐时算一段墙钟时长；解析不动就放弃（宁缺毋假）。 */
function durationLine(startedAt: string | undefined, finishedAt: string | undefined): string | undefined {
  if (startedAt === undefined || finishedAt === undefined) return undefined
  const start = Date.parse(startedAt)
  const end = Date.parse(finishedAt)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined
  const seconds = Math.round((end - start) / 1000)
  return `耗时：${seconds < 90 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`}`
}

export class RunPusher {
  private readonly channels: RunPushChannel[] = []

  constructor(private readonly deps: { log: (line: string) => void }) {}

  addChannel(channel: RunPushChannel): void {
    this.channels.push(channel)
  }

  removeChannel(accountId: string): void {
    const at = this.channels.findIndex(channel => channel.accountId === accountId)
    if (at >= 0) this.channels.splice(at, 1)
  }

  /** `yantao-kb/workspace-run` 的消费者：三终态各推一张结果卡给属主。 */
  async handleEvent(update: WorkspaceRunEvent): Promise<void> {
    const run = update?.run
    if (run?.id === undefined) return
    const statusText = PUSHABLE_STATUS[run.status]
    if (statusText === undefined) {
      this.deps.log(`workspace run ${run.id}: status ${run.status} is not pushable — skipped`)
      return
    }
    const channel = this.channels.find(candidate => candidate.ownerStaffId() !== undefined)
    if (channel === undefined) {
      this.deps.log(`workspace run ${run.id}: no robot with a bound owner — not pushed`)
      return
    }
    const userId = channel.ownerStaffId() as string
    const failedStep = run.failedStep !== undefined
      ? run.steps?.find(step => step?.index === run.failedStep)
      : undefined
    const text = [
      `指令：${run.instructionName ?? run.id}`,
      run.trigger !== undefined ? `触发：${TRIGGER_TEXT[run.trigger] ?? run.trigger}` : '',
      durationLine(run.startedAt, run.finishedAt),
      run.finalResult !== undefined && run.finalResult !== ''
        ? `结果摘要：${excerpt(run.finalResult, 300)}`
        : undefined,
      run.status === 'failed' && failedStep?.error !== undefined
        ? `失败原因：${excerpt(failedStep.error, 300)}`
        : undefined,
      '完整日志见工作台 · 工作空间 · 运行历史。',
    ]
      .filter(Boolean)
      .join('\n')
    const ok = await channel.sendMarkdown(userId, `工作空间运行${statusText}`, text)
    this.deps.log(`workspace run ${run.id} (${run.status}): proactive markdown to ${userId} → ${ok ? 'sent' : 'FAILED'}`)
  }
}
