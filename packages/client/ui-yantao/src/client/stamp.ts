/**
 * 时间戳的唯一格式（P3-1 收敛，2026-10-12 评审）：`M-D HH:mm`，24 小时制。
 * 此前 SchedulePane / InboxPane 用 `M-D HH:mm`，CapabilityPanel 用
 * `YYYY-MM-DD HH:mm`——同屏两种口径。裁决：工作台的证据行都是近况，年份
 * 不参与判读，统一短格式；要考古的原始 ISO 全文仍在数据里。
 */

/** 把一个 ISO 时间戳格式化为 `M-D HH:mm`（本地时区）。 */
export function formatStamp(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getMonth() + 1}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
