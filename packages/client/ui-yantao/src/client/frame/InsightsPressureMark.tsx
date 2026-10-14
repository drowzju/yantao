/**
 * The 洞察 tab's pressure dot (ADR-0057): the retired footer button's
 * context-pressure signal, relocated to the tab label. Amber past 80%, red
 * past 95% — the same thresholds the status bar paints (ADR-0039). Rendered
 * inside the `center.insights.pressure` slot (`session-maybe` scope): the
 * slot machinery threads the current session's projection seat through.
 * With no session selected (nothing to measure) it renders nothing.
 */

import type { ReactElement } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the `contextPressure` projection key merge.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { occupancyStroke, resolveOccupancy } from '../insights.ts'

export interface InsightsPressureMarkProps {
  useProjection: UseProjection
  /** Current session identity, absent while no session is selected. */
  readonly sessionId: string | undefined
}

export function InsightsPressureMark({ useProjection }: InsightsPressureMarkProps): ReactElement | null {
  const pressure = useProjection('contextPressure')
  // Same resolution order the status bar uses (ADR-0039).
  const occupancy = resolveOccupancy(pressure)
  if (occupancy === null) return null
  const stroke = occupancyStroke(occupancy.percent)
  return (
    <span
      data-insights-pressure={occupancy.percent}
      // 读屏通道（2026-10-14 impeccable P2 修复）：点渲染在洞察页签按钮内，
      // img 角色 + 可读名会让页签的可访问名自动带上压力读数（名字由内容
      // 计算），无需 CenterPane 回传——与任务蓝点同一解法。文案对齐
      // locales.ts 的 context.aria（本组件不经 slot 拿 t，沿用 title 的直写）。
      role="img"
      aria-label={`上下文已用 ${Math.round(occupancy.percent)}%`}
      title={`上下文占用 ${Math.round(occupancy.percent)}%`}
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        background: stroke,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}
