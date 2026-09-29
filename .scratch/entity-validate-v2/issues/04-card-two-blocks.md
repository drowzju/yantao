# 04 提议卡双区块渲染

Type: task
Status: resolved
Blocked by: 01

## 问题

`ProposalCard.tsx:184-190` 现在把 validate findings 渲染为单一「发现」分组——预扫的确定性结果和模型的语义发现混在一起，用户无法区分「机器算的」和「模型猜的」，不信任会传染（ADR-0036 决定 6）。

## 回答

### 交付物

| 文件 | 变更 |
| --- | --- |
| `packages/client/ui-yantao/src/client/proposal.ts` | 新增 `ProposalOrphan { name, type, incoming }` 与 `ProposalPrescan { orphans, findings, actions }`；`Proposal` 增加 `prescan?: ProposalPrescan` 子对象；`findings`/`actions` 注释改为「模型区块」 |
| `packages/client/ui-yantao/src/client/ProposalCard.tsx` | 重写渲染：上部确定性区块（`data-proposal-prescan="true"`，平静样式 groupTitleStyle，无警告色），下部模型区块（`data-proposal-findings="true"`）；共享 `renderGroups(actions, base, keyPrefix)` 渲染器，key 带 `prescan-`/`model-` 前缀避免冲突 |
| `packages/client/ui-yantao/src/client/proposal-apply.ts` | `applyProposal` 将勾选索引解析到 `[...(proposal.prescan?.actions ?? []), ...proposal.actions]` 拼接序列 |
| `packages/client/ui-yantao/src/client/validate.ts` | `verdictToValidateProposal` 增加可选 `blocks: ValidateCardBlocks { orphans, fixes }` 参数：修复动作置于 `actions` 前部，`prescan` 打包 orphans + 失链展示行 + 修复动作行，`findings` 只装模型语义发现 |
| `packages/client/ui-yantao/src/client/locales.ts` | 新增 `proposal.prescanFindings`（系统预扫（确定性）/ System prescan (deterministic)）与 `proposal.modelFindings`（模型发现 / Model findings）；删除失去引用的 `proposal.findings` 词条 |

### 数据形状决策（工票给了两个方案，实际取第三条路）

采用 **`prescan` 子对象**而非「两个平级字段」或「行级 `source` 甄别字段」：

- 孤儿条目（`ProposalOrphan`）既不是 finding 也不是 action，平级字段方案装不下它；
- 行级 `source` 字段仍是同一数组里的运行时标签，达不到「类型系统上不可能混排」的原则要求；
- 子对象让 `prescan.findings`/`prescan.actions` 与模型块的 `findings`/`actions` 在类型上是两个互斥的容器，混排在编译期即不可能。

提炼/邮件分析的 proposal 不设 `prescan`（可选字段），完全不受影响——无需迁移。

### 索引拼接机制

**（2026-09-29 review 修订）**修复动作行**只住在 `prescan.actions`**，绝不重复进 `proposal.actions`：卡片按 `[...prescan.actions, ...proposal.actions]` 拼接序渲染扁平索引，`applyProposal` 用同一拼接序解析勾选索引——修复行的执行序前位由这条拼接本身给出。（初版曾把 fixActions 同时前置进 `proposal.actions`，review 抓出：卡片与 applier 都按两数组不相交处理，真实运行时每条修复行渲染两次、勾满双重写入；生产端修正 + 两处钉死重复的断言改写，见票 05。）这样：

- `Frame`/`applyProposal` 对外签名零改动，部分批准语义原样继承；
- 卡片渲染与 applier 各自独立推导拼接序，两侧公式一致（`prescan.actions.length` 作为模型行的偏移基数）；
- 测试覆盖：勾 [0] 命中预扫修复行、勾 [1] 命中模型动作（`proposal-apply.client.spec.ts` 新 describe）；`verdictToValidateProposal` 断言 `actions` 不含修复行且拼接序首位是它。

### 视觉决策

确定性区块标题用既有平静样式的 `groupTitleStyle`（同普通分组标题），不用 findings 行的警告色调——符合工票「无需逐行审的暗示」。DOM 顺序测试用 `compareDocumentPosition(DOCUMENT_POSITION_PRECEDING)` 断言确定性区块恒在前。

### 隐藏规则

三个数组（orphans/findings/actions）全空的 `prescan` 整块隐藏；模型侧同理；两块全空时卡上只剩 reason 与统计。`全部接受` 计数覆盖两侧动作。

### 测试

- `proposal-card.client.spec.tsx` 新 describe「ProposalCard 双区块 (ADR-0036 决定 6)」5 例：仅预扫 / 仅模型 / 空预扫隐藏 / DOM 顺序 / 全部接受勾满两侧。
- `proposal-apply.client.spec.ts` 新 describe 2 例：拼接索引分别命中预扫行与模型行。
- `broken-link-suggest.client.spec.ts` 的 `verdictToValidateProposal` describe 按 `blocks` 参数重写 3 例（打包与隔离 / 修复动作前置 / 无 blocks 直通）。
- 全套 22 文件 / 428 例绿（此前 420，净增 8）。

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
