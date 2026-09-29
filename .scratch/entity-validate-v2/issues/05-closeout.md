# 05 收尾：测试、台账、bundle

Type: task
Status: resolved
Blocked by: 01, 02, 03, 04

## 问题

01–04 各票自带局部测试，但 ADR-0036 落地还有横向收尾：跨票回归、文档台账同步、client bundle 重建。散在各票里容易漏。

## 回答

### 回归

- `pnpm vitest run packages/client/ui-yantao packages/yantao/kb packages/api/yantao-kb-controller`：41 文件 / 801 例全绿。
- `git grep creates`（validate.ts）：仅存注释说明与防御性的 `creates: []` 归零桩（防陈旧模型输出），无行为残留；refine 侧不动。
- 手动冒烟（启动工作台走完预扫→诊断→卡→批准补链）留待人验收——代码侧到此完整，同 ADR-0032 批次④的先例。

### 完成汇总口径

`ValidateStats` 增必填 `prescan` 计数（= 卡片确定性区块的全部行：orphans + 失链展示行 + 修复动作行，`runValidate` 在 blocks 算好后一次得出）；`Frame.showValidateRun` 通报补传 `prescan` 与既有未上屏的 `filtered`。词条改为：

- 中文：`体检完成：{entities} 个实体 · 预扫 {prescan} · 模型 {findings} · 滤除 {filtered} · {tokens} tokens · 耗时 {elapsed}`
- 英文对应。workbench spec 三处 stats 夹具补齐 `prescan`/`filtered`（顺带修正夹具原本就缺 `filtered` 的隐患）。

### 文档台账

- `docs/yantao/TODO.md`：实体校验条目改写为「v2 纯体检已于 2026-09-29 落地（五票施工完毕）」，补失链修复候选与双区块两点。
- `packages/yantao/CONTEXT.md`：「实体校验 (Validate)」词条按纯体检语义重写（预扫直出确定性区块、修复候选代码相似度、防御核验、`Proposal.prescan` 类型互斥、L1 无建页、L2 另立 ADR）。
- `docs/adr/0036-…md`：追加落地注记（2026-09-29，五票对照决定 1–6 逐一记录落点与验证数据）。
- controller 无新 RPC、零 validate 引用，README 不动；`docs/yantao/README.md` ADR 索引已含 0036（随设计提交入库）。

### bundle

- 单跑 `pnpm --filter … run bundle` 曾失败：入口 `lib/types/index.js` 是 tsc 产物，本机 `lib/` 缺失（且 api 包缺 typert 生成的 `typert.remote-client.js`，`/remote` 模块解析不到）。
- 恢复路径：`npm run build:lib:host`（1m15s，补齐 typert 生成物）→ 窄构建 `tsc -b packages/client/ui-yantao` → 插件 `bundle` 成功（lib/client.js 399.7 kB）。
- **顺带抓到一个 vitest 漏网的真实类型错误**：`ProposalCard.renderGroups` 的 `keyPrefix` 参数是字符串，两处调用却传了箭头函数、模板里还当函数调——vitest 不查类型故 428 例全绿照样跑。教训入账：**改 tsx 后除了 vitest 还要跑 `tsc -b packages/client/ui-yantao`**（或 `pnpm run yantao:refresh`，但其全量 client tsc 目前会被上游包测试文件的陈年类型错误绊住，见下）。
- `pnpm run yantao:refresh`（全量 `build:lib:client`）在本机不可用：上游 ui-settings-models/ui-settings/ui-workspace/experimental 的测试文件存在与我们无关的类型错误（`RemoteErrorDetailsMap` 键型、`directoryPicker` 等），`tsc -b tsconfig.client.json` 全量构建被绊。窄构建绕行之；上游侧修复不属本票。

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
