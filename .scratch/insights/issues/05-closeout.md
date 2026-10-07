# 05：删旧状态条 + 收尾门禁

Type: task
Status: resolved
Blocked by: 03, 04

## 内容

1. 删 `ContextStatusBar.tsx` 与 `index.ts` 的 `footer.status` 注入及 slot 定义（`formatTokens` 等复用件迁往洞察组件）；ADR-0039 头部加被 ADR-0050 取代标注。
2. 全量门禁：`pnpm vitest run packages/yantao packages/client/ui-yantao`（PowerShell、大写 `D:\code\yantao`）、lint、ui-yantao bundle 重建、前端构建。
3. 台账收尾：各票 Answer 填齐，spec 验收标准逐条核对。

## 验收

- 无 ContextStatusBar 悬挂引用；门禁全绿；spec 验收标准 1–6 逐条打勾。

## Answer

已完工（2026-10-07）。要点：

- **退役五处**：`ContextStatusBar.tsx` + `.module.css` 删除；`index.ts` 的 SlotMap `footer.status` 声明、root children 声明、`slots.inject('footer.status', …)` 注册块三处摘除（`loadPromptInjection` 仍被 insights.session 用，导入保留）；`Frame.tsx` 的 `PropsRenderSlots` 联合成员与 `renderSlot('footer.status')` 调用移除。
- **词条清扫**：`context.*` 十键仅 `context.aria` 被洞察组成卡的占用条沿用，其余九键（zh+en）删除，注释改指 ADR-0050。
- **ADR-0039 标注**：frontmatter `status: superseded` + 题下括注（沿用 ADR-0008 先例），注明旁路会话详情抽屉的用量读数保留。TODO.md 的 ADR-0039 行是历史台账，不改。
- **catalog 重生成**：`footer.status` 条目连occupants一并消失（-58 行），零悬挂引用（packages 下 grep `ContextStatusBar|footer.status|yantao-context` 为空）。
- **门禁全绿**：窄 tsc 自有文件零错（9 处上游 SessionStore 预存噪音不变）；vitest 932/932；staged lint 0/0；bundle + 前端构建成功。
- **spec 验收 1–6 核对**：①六步注册齐备（票 03）✅；②仪表盘四卡、`sessionId` 参数化（票 03，总览复用）✅；③总览四件套+卡片跳转（票 04）✅；④`dailyUsage` 数字与事件日志一致——聚合器 fold 与 token-meter 投影共享测试语义（票 02 单测锁定同构规则）✅；⑤ContextStatusBar 彻底移除 ✅（本票）；⑥门禁全绿 ✅（本票）。
