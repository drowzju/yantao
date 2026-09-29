# 05 收尾：测试、台账、bundle

Type: task
Status: ready-for-agent
Blocked by: 01, 02, 03, 04

## 问题

01–04 各票自带局部测试，但 ADR-0036 落地还有横向收尾：跨票回归、文档台账同步、client bundle 重建。散在各票里容易漏。

## 要做什么

1. **回归**：`pnpm vitest run packages/client/ui-yantao`（及受波及的 `packages/yantao/kb`、`packages/api/yantao-kb-controller`）全绿；手动冒烟——启动工作台（`pnpm --filter @deepseek-ai/dsh-yantao-desktop start`），人物 tab 点「校验」，走完预扫→诊断→卡→批准补链一条龙。
2. **完成汇总口径**：`validate.notice` 词条（`locales.ts:65`）与 `ValidateStats` 核对——实体数、模型发现数、**滤除条数**（02 的核验统计）、token、耗时；两区块数量分开报（如「预扫 X · 模型 Y · 滤除 Z」）。
3. **文档台账**：
   - `docs/yantao/TODO.md` 实体校验条目：勾掉 v2 重构，标注落地日期；
   - `packages/yantao/CONTEXT.md`：「实体校验 (Validate)」词条按纯体检语义改写（若已有该词条——落地时核对）；
   - ADR-0036 加落地注记（参照 ADR-0032/0034 的「落地注记」先例）；
   - controller 无新 RPC，README 不动（确认即可）。
4. **bundle**：client 插件改动后 `pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle`（pre-commit 也会拦，别等拦）。

## 验收

- 上述命令全绿 + 冒烟通过；TODO/CONTEXT/ADR 注记三处已改；bundle 产物已更新。
- `git grep creates` 在 `validate.ts` 中无残留（提炼侧 `refine.ts` 的 creates 不算）。
