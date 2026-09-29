# 04 提议卡双区块渲染

Type: task
Status: ready-for-agent
Blocked by: 01

## 问题

`ProposalCard.tsx:184-190` 现在把 validate findings 渲染为单一「发现」分组——预扫的确定性结果和模型的语义发现混在一起，用户无法区分「机器算的」和「模型猜的」，不信任会传染（ADR-0036 决定 6）。

## 要做什么

1. **数据形状**（`proposal.ts:212-215` 附近）：`Proposal.findings` 拆为两类来源——建议改为两个字段（如 `verifiedFindings`（确定性）与 `modelFindings`），或在 finding 行上加 `source: 'prescan' | 'model'` 甄别字段。二选一在实现时定，原则：**类型系统上不可能混排**，而不是渲染时靠运行时判断。
2. **渲染**（`ProposalCard.tsx`）：
   - **确定性区块**：孤儿条目、失效双链（+ 03 的修复候选勾选行）。置于卡的上部，视觉上标注「系统预扫」（无需逐行审的暗示——如更平静的样式/不打警告色）。
   - **模型区块**：语义 findings（stale/contradiction/missing）+ targets.links 补链动作行。维持现有 findings 行样式。
   - 两区块各自为空时整块隐藏；都为空时卡上只留 reason 与统计。
3. **locales**（`locales.ts`）：新增/调整词条（如 `proposal.prescanFindings` / `proposal.modelFindings`，中英双语，风格对齐 `proposal.findings` 现有措辞）。
4. **数据流**：`verdictToValidateProposal`（01 改后的签名）负责把预扫 + 核验后 verdict 组装成带两区块的 proposal；`Frame.tsx` 的 validate 手势调用点（:712 附近的 stats 通报）核对口径。

## 不要做什么

- 不动非 validate 手势的卡（提炼/邮件分析的 proposal 不受影响——它们的 findings 字段若与 validate 共用类型，拆分时保持向后兼容或一并迁移，以编译通过为准）。
- 不做区块内排序的花哨交互（折叠/筛选留到真实使用反馈）。

## 验收

- 用例/快照：仅有预扫结果（模型 findings 空）时只见确定性区块；反之亦然；两区块并存时顺序稳定（确定性在上）。
- 03 的修复候选行在确定性区块内可勾选、部分批准语义与既有动作行一致。
