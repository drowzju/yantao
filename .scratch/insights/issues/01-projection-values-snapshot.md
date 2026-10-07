# 01：projectionValues 真实快照验证

Type: research
Status: resolved
Blocked by: —

## 问题

批次 3 的会话卡片计划从 `SessionSummary.projectionValues`（`packages/api/session-controller/src/client/sessions/service.ts:26-51`）直接读每会话累计 token。该字段的真实形态未经实测：

1. `projectionValues` 里到底有哪些投影键？`tokenUsage` 在不在？
2. 若在，值的形状是什么（`usage-projection.ts` 的 `{ totals: { uncachedInput, output, cacheRead, cacheWrite }, last }` 还是别的投影序列化形态）？
3. 会不会太大/太杂，不适合直接进会话卡片？

## 方法

- 读 host 侧 `src/list.ts` 如何填充 `projectionValues`；
- 拿一份真实快照（运行中的工作台或 headless 脚本打一次 sessions list RPC）核对。

## Answer

2026-10-07 实测（`~/.dsh/storages/session_projcache/sessions/*.json`，100 份持久化记录）：

1. **`tokenUsage` 在**，且 100/100 会话都有该行（空会话也播种零值）。
2. **wire 形态 = 四桶 totals**：`tokenUsageProjectionDefinition.wire.view = state => state.totals`（`packages/llm/token-meter/src/usage-projection.ts:149`），即 `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`。持久化行存的是完整 state（含 `last`），但 list 的 `projectionValues` 走 wire view，只有 totals。`contextPressure` 同理（`{ contextWindow?, pressureTokens?, projectedTokens? }`）。
3. **适合直接上卡**：四个整数，体积可忽略。

注意事项：冷行（从未 checkpoint 的会话）`hintsOf` 会回落到 `cachedPredecessorTitle`，`projectionValues` 可能整列缺席（list.ts:289-310）——批次 3 卡片需容忍缺列，必要时 `sessionUsage` RPC 兜底。
