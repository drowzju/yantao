/**
 * The `yantaoUsage` Remote controller: the 洞察 tab's cross-session usage
 * channel (ADR-0050). Two reads over the `yantao-usage` ledger service —
 * the day ledger (7 天柱状图与 8 周热力图的数据面) and one session's
 * lifetime totals (会话卡片兜底). Read-only: the ledger is telemetry the
 * host computes; no write path crosses this namespace.
 * @module @deepseek-ai/dsh-api-yantao-usage-controller
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import { UsageSessionUnknownError } from '@deepseek-ai/dsh-yantao-usage'
import type {
  UsageDailyArgs, UsageDailyResult, UsageSessionArgs, UsageSessionResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    yantaoUsageController: YantaoUsageController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No stored session carries that id. */
    'yantao-usage/not-found': { readonly sessionId: string }
  }
}

/** UI-direct usage reads over the `yantaoUsage` Remote namespace. */
export class YantaoUsageController extends TypertRemoteService {
  /** The ledger service, provided by the mounted yantao-usage plugin. */
  static inject = ['yantaoUsage']

  constructor(ctx: Context) {
    super(ctx, 'yantaoUsageController', { namespace: 'yantaoUsage' })
  }

  /**
   * The day ledger over an inclusive local-day range, brought up to date
   * first (the scan is lazy and single-flight inside the service).
   * @param args - optional `sinceDay`/`untilDay` bounds.
   * @returns the day rows oldest first plus their sum.
   */
  @Remote('dailyUsage')
  dailyUsage(args: UsageDailyArgs): Promise<UsageDailyResult> {
    return this.ctx.yantaoUsage.dailyUsage(args)
  }

  /**
   * One session's lifetime token totals, that session's cursor brought up to
   * date first.
   * @param args - the session to read.
   * @returns the session's lifetime token totals, all four buckets.
   * @throws {RemoteError} code `yantao-usage/not-found` for an unknown session.
   */
  @Remote('sessionUsage')
  async sessionUsage(args: UsageSessionArgs): Promise<UsageSessionResult> {
    try {
      const totals = await this.ctx.yantaoUsage.sessionUsage(SessionId(args.sessionId))
      return { sessionId: args.sessionId, totals }
    } catch (error: unknown) {
      if (error instanceof UsageSessionUnknownError) {
        throw new RemoteError(
          'yantao-usage/not-found',
          `no stored session "${args.sessionId}"`,
          { sessionId: args.sessionId },
          { cause: error },
        )
      }
      throw error
    }
  }
}
