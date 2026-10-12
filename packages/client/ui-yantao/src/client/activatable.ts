/**
 * role="button" 行的键盘激活（P2-2 收敛，2026-10-12 评审）：Enter 与 Space
 * 都触发，并 preventDefault 挡掉 Space 的滚动与 Enter 的隐式提交；输入法
 * 组合期间的按键不算手势。此前 SchedulePane 的行只认 Enter，InboxPane 自养
 * 一份正确版本——现在共用这一份工厂（普通函数而非 hook：行在 map 里渲染，
 * 逐行调用不得违反 hooks 规则）。
 */
import type { KeyboardEvent } from 'react'

export function activatable(onActivate: () => void): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.nativeEvent.isComposing) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onActivate()
  }
}
