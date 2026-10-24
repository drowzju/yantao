/**
 * 设置面的改动摘要（2026-10-23 评审裁决 ②：设置面收回产品指纹的第一步）。
 *
 * 三个设置对话框（配置 / 工作空间 CLI / 钉钉）此前把「这次要改什么」整个藏在
 * 保存按钮后面：改了几处、哪一处会覆盖线上、测的是不是刚填的那份，界面上一个
 * 字都没有。这里补上裁决卡早就有的那层证据——落盘之前把将要改变的字段逐项报
 * 出来；无改动时**不渲染**（静为默认，不拿「无改动」占一行）。
 *
 * 只报「落盘才生效」的字段：钉钉的「并入工作台会话」勾选即时提交（见
 * DingTalkDialog.toggleMergeFollow），不属于草稿，故不进摘要。
 */
import type { ReactElement } from 'react'
import type { WorkbenchT } from './locales.ts'

// 脏状态条：与 SchedulePane 的未保存确认条同一套语义（--yt-warning-bg 底 +
// --yt-warning-text 墨），DESIGN.md §2.5「警告态底（未保存提示条）」。
const summaryStyle = {
  margin: 0,
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderRadius: 6,
  background: 'var(--yt-warning-bg)',
  color: 'var(--yt-warning-text)',
  fontSize: 'var(--yt-type-label)',
} as const

/**
 * The API key field's label, telling the two states apart: replacing a stored
 * key is a different act from setting the first one, and the summary must say
 * which one the save performs.
 * @param t - the bound dictionary.
 * @param configured - whether a key is already stored.
 * @returns the label to list in the summary.
 */
export function apiKeyFieldLabel(t: WorkbenchT, configured: boolean): string {
  return configured ? t('settings.field.apiKeyReplace') : t('settings.field.apiKey')
}

/**
 * Drop the fields that did not change, keeping the form's order.
 * @param candidates - one label per field, `null` when that field is untouched.
 * @returns the labels of the fields the draft would change.
 */
export function diffLabels(candidates: readonly (string | null)[]): string[] {
  return candidates.filter((label): label is string => label !== null)
}

export interface SettingsSummaryProps {
  /** The bound dictionary, threaded from the dialog. */
  readonly t: WorkbenchT
  /** The changed fields' labels, in form order. */
  readonly fields: readonly string[]
}

/**
 * The line above a settings dialog's footer: what the pending save would change.
 * Renders nothing when the draft matches what is stored.
 */
export function SettingsSummary({ t, fields }: SettingsSummaryProps): ReactElement | null {
  if (fields.length === 0) return null
  return (
    <p style={summaryStyle} data-settings-summary="true">
      {t('settings.summary', { count: fields.length, fields: fields.join(' · ') })}
    </p>
  )
}
