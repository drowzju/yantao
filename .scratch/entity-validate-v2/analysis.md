# 实体校验 v2：llm_wiki 对照分析

本文是 [ADR-0036](../../docs/adr/0036-entity-validation-v2-pure-diagnosis.md) 的设计背景：把 llm_wiki（`D:\code\llm_wiki`）的 lint 实现逐项拆开，对照 yantao 现行 validate 管线（ADR-0035 L1），说明每项借鉴与否、为什么。

## 一、对照总表

| 维度 | llm_wiki | yantao validate（ADR-0035 L1） | v2 裁定 |
|---|---|---|---|
| 结构检查 | 纯代码，Web Worker，不过 LLM（`lint.ts:157`） | 纯代码预扫，但结果送进 prompt 让模型包装 | **代码直出**（0036 决定 2） |
| 语义检查喂料 | 每页 frontmatter + 前 500 字符压缩预览（`lint.ts:244`） | 花名册（名字+类型）+ 点名实体全文（8k 截断） | **保留全文**（决定 8 / 台账 #5） |
| 语义规则宽度 | 一次只查 4 种类型，判据硬编码进 prompt（`lint.ts:265-280`） | 一句「研判这些问题该怎么处置」+ 5 种 kind 混出 | **窄化为 3 维度**（决定 3） |
| 输出协议 | `---LINT: type \| severity \| title---` 文本协议（`lint.ts:202`） | JSON verdict + reask + v2 解析器 | **JSON 不变**（决定 7） |
| 防御核验 | 模型报的 missing-page 对规范化标题集合（NFKC）二次核验，不符即弃（`lint.ts:241-247`，issue `#537`） | 无——prompt 恳求「名单里没有的不要猜」，但不执法 | **代码侧核验**（决定 5） |
| 修复归属 | LLM 只定位；修复是确定性代码函数（`lint-fixes.ts`）；人审批 | 模型在提议卡里直接产出 creates（新页全文） | **按类型分工，模型不产内容**（决定 1/4） |
| 发现与修复的关系 | 发现进 review 队列，人裁决后才触发代码修复 | findings 纯展示，动作行另列 | 分区块呈现（决定 6） |
| 增量清理 | sweep：批量判定积压 review 是否已被新内容解决，只喂清单+摘要，批 40、最多 5 批（`sweep-reviews.ts:182-233`） | 无对应物 | 远期参考，本轮不做 |

## 二、llm_wiki 值得抄的四个思想

### 1. 分层：便宜的证据链不过模型

llm_wiki 的 lint 是两层。结构层（孤页、断链、无出链）在 `runStructuralLint`（`src/lib/lint.ts:157`）里收集每页标题/出链/token，postMessage 给 Web Worker 跑 `computeStructuralLint`（`lint-structural-core.ts:102`）——零 token、零幻觉、可中断、还能跑得起 Levenshtein + bigram 相似度给断链建议（阈值常量 `SAME_BASENAME_SCORE = 0.96` 等，`lint-structural-core.ts:29-35`，CJK 单字有权重）。语义层才动用 LLM。

yantao 的 `preScanOf`（`validate.ts:158`）在「算」这一步与它完全同构，差别在**下游**：llm_wiki 把结构层结果直接呈现给用户，yantao 却把清单塞回 `validatePrompt`（:202-208）充当模型的研判素材，让模型把确定性事实再「产出」一遍——多花 token、多一层幻觉，还模糊了证据等级。

### 2. 窄职责：一次调用只干一件事

llm_wiki 的语义 lint prompt 开宗明义「You are a wiki quality analyst」，规则清单逐条列死（contradiction / stale / missing-page / suggestion，各配一句判据，`lint.ts:277-280`）。模型的任务是**分类判断**，不是开放式创作。

yantao L1 的 prompt（`validate.ts:185-237`）让模型在一次调用里同时：解释孤儿该怎么处置、猜失链想指向什么、发明该建的新实体并把新页各区段的正文写出来、产出补链动作、还想问用户问题。五件事抢一份注意力，每件都做得平庸——这就是批准率低的病灶。

### 3. 防御核验：模型的话不当证据

llm_wiki 在 issue `#537` 里被咬过：模型言之凿凿地报「缺页」，实际页面存在。对策是代码侧二次核验——收集所有已存在页面的 basename 与 frontmatter 标题，NFKC 规范化后进集合（`lint.ts:241-247`），模型报的 missing-page 凡是集合里查得到的直接丢弃。**prompt 里的禁令挡不住幻觉，集合查询可以。**

yantao 现状：prompt 里写了「名单里没有的不要猜，宁可漏掉」（:230），但解析层不核验——模型编一个花名册外的实体名，照样变成卡上的一行。这是 v2 最划算的补强点。

### 4. 修复与发现彻底分离

llm_wiki 的铁三角：**LLM 定位问题 → 人裁决 → 确定性代码执行修复**。`lint-fixes.ts` 的修复函数个个幂等且可测：`appendWikilink`（:22，已存在该链则原样返回）、`rewriteWikilinkTarget`（:34，精确匹配断链 target 改写）、`ensureBrokenLinkStub`（:68，已存在则不建）。模型从头到尾不产出「修复后的内容」。

yantao 反过来：`creates[]` 让模型在校验现场写新页全文（虽然 L1 把 targets 的 edits 钉空，creates 自身的创建性 edits 放行）。这与提炼手势（看着完整资源写新页）正面撞车，且校验场景下模型只见过 8k 截断的碎片——同样的活，两处入口，质量必然是差的那个拉低整体信任。

## 三、不抄的两项及理由

### 压缩预览（500 字符）

llm_wiki 敢把每页砍到 500 字符，是因为它的 wiki 页本来就是 LLM 从原始文档生成的**短文**，frontmatter + 开头足以代表全页。yantao 的实体是长期沉淀的大文本（`## 状态` 逐次追加），语义判断（尤其「过期」「矛盾」）恰恰依赖较新的尾部内容——砍头部反而砍错了地方。v2 保留点名实体全文 + 8k 截断（台账 #5）。

### 文本协议（`---LINT---` 块）

llm_wiki 的输出协议是正则解析的自定义文本块（`LINT_BLOCK_REGEX`，`lint.ts:202`），因为它走的 OpenAI 兼容流式接口、没有可靠的结构化输出。yantao 已有 `jsonRound` + v2 解析器 + reask 重试 + `verdictToProposal` 整条管道，换协议是纯倒退。

## 四、远期参考：sweep 的增量清理

`src/lib/sweep-reviews.ts:182` 用 LLM 批量判定「积压的 review 是否已被新内容解决」：只喂页面清单（封顶 300 行标题）+ review 摘要，要求返回 `{"resolved": ["id1"]}`（:231-233），批大小 40、最多 5 批，出错保守返回空集。这个「只喂清单让模型做廉价归类判定」的模式，与 v2 的诊断调用气质一致——将来若做「上次体检的发现是否已被后续编辑解决」的增量复查，可直接参照。

## 五、v2 目标管线（一屏图）

```
yantaoKb.graph() 全库双链图
        │
        ▼
  preScanOf（纯代码，零 token）
        │
        ├──────────────────────────────┐
        ▼                              ▼
  【确定性区块】直接上卡          诊断调用（窄职责）
  · 孤儿条目（全信）              输入：预扫清单（附送，声明「勿复述」）
  · 失效双链 + 代码改写候选       + 全库花名册 + 点名实体全文（8k）
        │                       规则：过期 / 矛盾 / 缺链机会（硬编码）
        │                              │
        │                              ▼
        │                     JSON verdict（findings + targets.links + questions）
        │                              │
        │                              ▼
        │                     防御核验（代码）：subject/entity/to 对花名册与图，
        │                     解析不到 → 丢弃
        │                              │
        ▼                              ▼
  【模型区块】（逐条审）◄──── 提议卡（两区块，不混排）
        │
        ▼
  人批准 → 代码执行（补链/改写）；缺实体 → 人去提炼手势
```
