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
import type {} from '@deepseek-ai/dsh-settings'
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
 * `request/context`. Until the first request forms (no snapshot yet) the
 * section falls back to the DECLARED capacity read from the settings
 * namespace `llm-pi-ai`, so turn one already answers truthfully; refreshed
 * automatically when the value changes; a route that reports no window stays
 * silent. The order is a literal between the centrally allocated sandbox (110)
 * / approval (115) placements — a yantao-side number that does not spend an
 * upstream slot.
 */
export class YantaoModelWindowService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'yantaoModelWindow')
    ctx.inject(['systemPrompt', 'settings'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'yantao:model-window',
        order: 116,
        text: (context) => {
          const session = context.agent?.session
          const resolved = session?.requestContext()
          if (resolved !== undefined) {
            if (resolved.contextWindow === undefined) return ''
            const k = Math.round(resolved.contextWindow / 1024)
            return `当前模型 ${resolved.model} 的平台配置：上下文窗口 ${String(resolved.contextWindow)} tokens（约 ${String(k)}K）。这是工作台注入的真实配置值；你无法自省当前已用量，回答窗口相关问题时以此为准，不要引用训练记忆里的数字。`
          }
          // 首轮：requestContext 尚未形成，回落到 settings 的声明值。
          const declared = declaredWindow(scope, undefined)
          if (declared === undefined) return ''
          const k = Math.round(declared.contextWindow / 1024)
          return `当前模型 ${declared.id} 的平台配置：上下文窗口 ${String(declared.contextWindow)} tokens（约 ${String(k)}K）。这是工作台注入的真实配置值；你无法自省当前已用量，回答窗口相关问题时以此为准，不要引用训练记忆里的数字。`
        },
      })
    })
  }
}

/**
 * First-turn fallback: read the declared `contextWindow` for the agent's model
 * (or the gateway's first row when the route has not resolved) from the
 * `llm-pi-ai` settings namespace — the same live values the 配置 dialog shows.
 * Returns `undefined` when the namespace is not mounted or carries no rows.
 */
function declaredWindow(scope: Context, modelId: string | undefined): { id: string; contextWindow: number } | undefined {
  try {
    const described = scope.settings.describe().find(row => row.ns === 'llm-pi-ai')
    const value = described?.value as { providers?: Record<string, { models?: { id: string; contextWindow?: number }[] }> } | undefined
    const models = value?.providers?.['model-gateway']?.models ?? []
    const rows = models.filter(row => typeof row.contextWindow === 'number')
    if (rows.length === 0) return undefined
    const picked = (modelId !== undefined ? rows.find(row => row.id === modelId) : undefined) ?? rows[0]
    return picked?.contextWindow === undefined ? undefined : { id: picked.id, contextWindow: picked.contextWindow }
  } catch {
    return undefined
  }
}

export default YantaoModelWindowService
