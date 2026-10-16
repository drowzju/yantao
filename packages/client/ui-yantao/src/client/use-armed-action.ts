/**
 * 两击武装的危险动作（P1-1 一致性收敛，2026-10-12 评审）：首击只武装——
 * 按钮换成「确认删除？」并穿上危险装，再击才执行；换行、折叠、关菜单时
 * 调 disarm() 解除。此前 MemoryPanel / SchedulePane / Workbench 行菜单各养
 * 一份状态机（一个 id 键、一个布尔键、一个布尔键），TodoBoard 的 × 与
 * 快捷方式的删除则干脆即时执行——四面归一到这一个 hook。
 *
 * Escape 也解除（2026-10-16：工作空间 tab 的武装态曾只能靠再击执行或
 * 武装他钮才能脱身，与菜单/对话框的 Escape 消散惯例相悖）。只在有武装行
 * 时挂 window 监听，解除即摘。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ArmedAction {
  /** 当前被武装的行动 id；null 表示没有武装中的行。 */
  readonly armedId: string | null
  /** 两击闸门：首次调用武装该 id，再次调用同一 id 执行并解除。 */
  readonly attempt: (id: string, run: () => void) => void
  /** 不执行、只解除（换行 / 折叠 / 关闭容器时调）。 */
  readonly disarm: () => void
}

export function useArmedAction(): ArmedAction {
  const [armedId, setArmedId] = useState<string | null>(null)
  // 镜像 ref：attempt 是稳定引用（inject 面的新鲜闭包经它转发），读现值
  // 不依赖渲染快照，也不会把 run() 塞进 setState 更新器里跑两遍。
  const armedRef = useRef<string | null>(null)
  const attempt = useCallback((id: string, run: () => void): void => {
    if (armedRef.current === id) {
      armedRef.current = null
      setArmedId(null)
      run()
      return
    }
    armedRef.current = id
    setArmedId(id)
  }, [])
  const disarm = useCallback((): void => {
    armedRef.current = null
    setArmedId(null)
  }, [])
  useEffect(() => {
    if (armedId === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') disarm()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [armedId, disarm])
  return { armedId, attempt, disarm }
}
