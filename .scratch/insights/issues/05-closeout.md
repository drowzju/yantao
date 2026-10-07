# 05：删旧状态条 + 收尾门禁

Type: task
Status: ready-for-agent
Blocked by: 03, 04

## 内容

1. 删 `ContextStatusBar.tsx` 与 `index.ts` 的 `footer.status` 注入及 slot 定义（`formatTokens` 等复用件迁往洞察组件）；ADR-0039 头部加被 ADR-0050 取代标注。
2. 全量门禁：`pnpm vitest run packages/yantao packages/client/ui-yantao`（PowerShell、大写 `D:\code\yantao`）、lint、ui-yantao bundle 重建、前端构建。
3. 台账收尾：各票 Answer 填齐，spec 验收标准逐条核对。

## 验收

- 无 ContextStatusBar 悬挂引用；门禁全绿；spec 验收标准 1–6 逐条打勾。

## Answer

（待填）
