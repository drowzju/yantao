/**
 * The yantao model-window plugin (2026-10-24): default-exports the
 * `YantaoModelWindowService` for the cordis plugin loader to mount.
 *
 * Why this exists: the agent-loop resolves the adapter-owned context window
 * per request and logs it as the `request/context` event, but nothing ever
 * discloses that value to the model — so asked «how long is your context»,
 * the model recites its training-data self-description (128K) however the
 * deployment config actually reads (768K). This plugin mirrors the resolved
 * value back as one dynamic system-prompt context section, so the agent's
 * self-report tracks the platform configuration across model swaps.
 * @module @deepseek-ai/dsh-yantao-model-window
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The model-window disclosure, provided by the mounted yantao-model-window plugin. */
    yantaoModelWindow: YantaoModelWindowService
  }
}

/**
 * Registers one dynamic context section (`yantao:model-window`) rendering the
 * session's resolved `requestContext()` — the same value the loop logs as
 * `request/context`. Empty until the first request forms (no snapshot yet),
 * refreshed automatically when the value changes; a route that reports no
 * window stays silent. The order is a literal between the centrally allocated
 * sandbox (110) / approval (115) placements — a yantao-side number that does
 * not spend an upstream slot.
 */
export class YantaoModelWindowService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'yantaoModelWindow')
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'yantao:model-window',
        order: 116,
        text: (context) => {
          const session = context.agent?.session
          const resolved = session?.requestContext()
          if (resolved?.contextWindow === undefined) return ''
          const k = Math.round(resolved.contextWindow / 1024)
          return `当前模型 ${resolved.model} 的平台配置：上下文窗口 ${String(resolved.contextWindow)} tokens（约 ${String(k)}K）。这是工作台注入的真实配置值；你无法自省当前已用量，回答窗口相关问题时以此为准，不要引用训练记忆里的数字。`
        },
      })
    })
  }
}

export default YantaoModelWindowService
