# Domain 文档

工程类技能在探索代码库时应如何消费本仓库的领域文档。

## 动手前先读这些

- 根目录的 **`CONTEXT-MAP.md`**：本仓库是多上下文布局，它指向每个上下文的词汇表
  - **`docs/glossary.md`** — dsh 平台词汇（plugin / profile / bundle / session / agent loop 等，上游文档）
  - **`packages/yantao/CONTEXT.md`** — yantao 工作台词汇（知识库 / Resource / Entity / 能力 等）
  - 按当前主题读相关的那一份（或两份都读）
- **`docs/adr/`**：本仓库全部 ADR 集中在此（无 per-context adr 子目录），动手前先读触及该区域的条目

若上述文件不存在，**静默继续**。不要提示缺失，也不要主动建议创建；`/domain-modeling` 技能（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 进入）会在术语或决策真正落定时惰性创建它们。

## 使用词汇表的用语

当你的输出命名某个领域概念（issue 标题、重构提案、假设、测试名）时，使用 `CONTEXT.md` 定义的原词，不要漂移到词汇表明确标注 _Avoid:_ 的同义词。这也是 AGENTS.md 的硬规则：用 `packages/yantao/CONTEXT.md` 的词，不造同义词。

如果你需要的概念还不在词汇表里，这是一个信号：要么你在发明项目不用的语言（请重新考虑），要么存在真实的缺口（记下来交给 `/domain-modeling`）。

## 标记 ADR 冲突

如果你的输出与既有 ADR 相矛盾，显式指出而不是默默推翻：

> _与 ADR-0004（工具即边界）冲突，但值得重开讨论，因为……_

注意 ADR 可能被后续 ADR 推翻（如 ADR-0010 推翻了 ADR-0004 的人工独占编辑规则），引用前确认最新状态。
