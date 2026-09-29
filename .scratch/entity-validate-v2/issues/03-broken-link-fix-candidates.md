# 03 失链修复候选（确定性代码修复）

Type: task
Status: resolved
Blocked by: 01

## 问题

失链今天只有「发现」没有「修复」——模型在 prompt 里被问「失效双链原本想指向什么」，但它给出的改写混在模型区块里，与语义发现同等可疑。ADR-0036 决定 4：失链修复候选应由**确定性代码**生成（花名册相似度匹配），人勾选、代码执行；代码给不出高置信候选时该行退化为纯展示。

## 要做什么

1. **相似度匹配纯函数**（新模块，如 `broken-link-suggest.ts`）：
   - 输入：失链 target 字符串 + 花名册（名字+类型）。
   - 打分参照 llm_wiki `lint-structural-core.ts:29-35` 的做法：Levenshtein 相似度 + 片段（bigram）重合，CJK 场景单字权重适当调高；阈值常量显式命名（如 `HIGH_CONFIDENCE`），不散落魔法数。
   - 输出：排序后的候选列表（至多 3 个），每个带分数；无过阈候选时为空。
2. **确定性动作行**：
   - 高置信候选 → 确定性区块的可勾选行：「将 `[[坏名]]`（位于宿主 X）改写为 `[[候选名]]`」。
   - 低置信/无候选 → 该失链保持纯展示行，附「无可信修复候选」。
3. **执行路径**：改写宿主实体正文中的 `[[坏名]]` → `[[候选名]]`。建议复用既有 `edit-section` 动作机制：代码定位失链所在小节，生成「改写后的小节全文」作为 `after`，走既有 applier 落盘（流水拒绝/frontmatter 不碰的保证原样继承）。若评估后发现 edit-section 粒度不合用（如失链横跨小节或位于流水），在票内 Comments 记录实测结论再议最小替代（必要时新动作类型），**不得**为此放开 write-state。
   - 改写函数本身幂等可测（参照 llm_wiki `lint-fixes.ts:34` `rewriteWikilinkTarget`：精确匹配 target 才替换，别名保留）。

## 不要做什么

- 不让模型参与失链修复候选的生成（模型仍可在缺链机会维度建议**新增**链，那是 targets.links，与此票无关）。
- 不做「建占位页」修复（llm_wiki 的 `ensureBrokenLinkStub`）——建页归提炼手势，ADR-0036 决定 1。

## 验收

- 相似度函数用例：精确同名、大小写/全半角差异、CJK 近名（如「张三丰」vs「张叁丰」）、完全无关名低于阈值、候选至多 3 个。
- 改写函数用例：多链接正文只改命中的、别名语法 `[[target|alias]]` 保留别名、无匹配时原样返回。
- 端到端：构造含失链的临时 KB fixture，跑修复动作行，落盘后失链消失、其余正文逐字节不变。

## Answer

**2026-09-29 完成**。

- **相似度纯函数**：新文件 `packages/client/ui-yantao/src/client/broken-link-suggest.ts`。`nameSimilarity` = max(加权 Levenshtein 比, bigram Dice)，输入先经 `normalizeEntityName` 折叠（复用工票 02 的 NFKC 折叠）；阈值显式命名：`HIGH_CONFIDENCE = 0.74`（对齐 llm_wiki）、containment 0.82、CJK↔CJK 替代代价 0.5（CJK 手误的主流是错一个字，「张三丰→张叁丰」= 0.833 稳过阈，无关名远低于阈）。`suggestLinkFixes` 输出至多 `MAX_CANDIDATES = 3` 个候选、最优在前、平分按名排序；`类型:` 定位符打分前剥离。
- **改写函数**：`rewriteWikilinkTarget` 幂等——折叠后精确等于坏 target 才整体替换为裸候选名，`|别名` 原样保留，围栏内的链不动（与 KB 自己的 links.ts 扫描器同一套围栏语义，预扫看到的链就是它改写的链）。
- **edit-section 粒度实测结论**（票内要求记录）：合用。`brokenLinkSectionFixes` 按 applier `replaceSection` 同款 `#{1,2} ` 边界切节，逐节产出 before/after，走既有 `edit-section` 动作落盘，无需新动作类型。两处已知边界如实继承：
  1. **流水**：失链落在流水节时该处降级为纯展示行（「流水只增不改……请手工处理」）——用户拍板（决定记录：流水失链降级为纯展示行）。applier 层的流水拒绝照旧兜底。
  2. **小节边界空白**：applier 的 `replaceSection` 会 trim 节体并重建「前后各一空行」，故改动节与下一节之间的原有空行会被吃掉——这是 edit-section 既有行为，非本票引入；节外的正文（frontmatter、围栏、其它节）逐字节不变（e2e 断言验证）。
- **接入点**：`validate.ts` 新增导出 `brokenLinkFixesOf(preScan, views, roster)`（去重 (host, target)、宿主缺失跳过、无候选/链不在任何节内 → 「无可信修复候选」「失链不在任何小节正文里」展示行）与 `BrokenLinkFixes`；`verdictToValidateProposal` 增加可选第 4 参，把确定性动作行接在模型动作之后、展示行缀在模型 findings 之后；`runValidate` 在 finish 前一次性算好（预扫直出，不过模型）。
- **决定记录**（均经用户确认）：① 流水失链 → 纯展示行；② 类型定位符 target → 整体替换为裸候选名（定位符既已失效，重挂回去纯属猜测）。
- **测试**：`tests/broken-link-suggest.client.spec.ts` 24 例——相似度（精确/折叠/一字之差过阈/无关低于阈/containment 双向/至多 3 个）、改写（只改命中/别名保留/围栏不动/定位符整体替换/无匹配原样/幂等/空 target 拒绝）、分节修复（含流水上报、节内围栏、首节前忽略）、`brokenLinkFixesOf` 五分支、`verdictToValidateProposal` 合并、端到端经 `applyProposal` 落盘（内存 KB fixture：状态节改写、围栏与流水逐字节不变）。
- **实现期抓到的虫**：初版 wikilink 正则以单个 `\]` 收尾，替换后残留 `]]` 的第二个 `]`（产出 `[[新名]]]`），且多数 `toContain` 断言察觉不到——靠端到端的整文比对暴露。已改为 `\]\]` 收尾。
