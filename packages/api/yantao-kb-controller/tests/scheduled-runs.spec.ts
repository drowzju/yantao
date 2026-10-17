import { describe, expect, it } from 'vitest'
import { SCHEDULED_RUN_TTL_MS, ScheduledRunRegistry } from '../src/scheduled-runs.ts'

describe('ScheduledRunRegistry（ADR-0061 决定 1：谁在对工具说话）', () => {
  it('登记后命中，注销后回落为交互', () => {
    const registry = new ScheduledRunRegistry()
    expect(registry.isScheduled('sess_a')).toBe(false)
    registry.mark('sess_a')
    expect(registry.isScheduled('sess_a')).toBe(true)
    registry.forget('sess_a')
    expect(registry.isScheduled('sess_a')).toBe(false)
  })

  it('TTL 过期后惰性逐出：过期登记读作交互，且不再复活', () => {
    const registry = new ScheduledRunRegistry()
    registry.mark('sess_b', -1) // 立即过期
    expect(registry.isScheduled('sess_b')).toBe(false)
    // 逐出后 forget 也只是无害的空操作（返回 false 表示本来就没有活登记）
    expect(registry.forget('sess_b')).toBe(false)
    expect(registry.isScheduled('sess_b')).toBe(false)
  })

  it('负 TTL 被钳到 0（立即过期），缺省 TTL 是 30 分钟', () => {
    const registry = new ScheduledRunRegistry()
    registry.mark('sess_c', -1000)
    expect(registry.isScheduled('sess_c')).toBe(false)
    expect(SCHEDULED_RUN_TTL_MS).toBe(30 * 60_000)
  })

  it('重复登记以后一次为准；互不串扰', () => {
    const registry = new ScheduledRunRegistry()
    registry.mark('sess_d', 60_000)
    registry.mark('sess_d', -1)
    expect(registry.isScheduled('sess_d')).toBe(false)
    registry.mark('sess_e')
    expect(registry.isScheduled('sess_d')).toBe(false)
    expect(registry.isScheduled('sess_e')).toBe(true)
  })
})
