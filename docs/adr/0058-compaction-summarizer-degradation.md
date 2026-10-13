---
status: accepted
---

# 压缩摘要调用写不下窗口时的降级阶梯

出发点（2026-10-13 15:05 调度任务死亡螺旋事故）：一次调度任务的长会话触发压力压缩后，摘要
辅助调用反复失败、压缩整体失败，此后每个 step 都重试一模一样的注定失败的调用——烧 token、
拖慢节奏、永远恢复不了。病根在 `compaction-basic` 的默认摘要器 `summarizeWithLlm`：它把
被压缩区（shadow）整个重放给模型、又保留全额输出预留 `maxTokens`（默认取 `headroomTokens`
= 65,536），两者相加可以轻易超过同一个上下文窗口——会话一旦在两步之间冲高（大工具结果），
这个辅助调用就结构性写不下，且没有任何降级路径：失败原样上抛 → 压缩失败 → 下一步同样的
测量 → 同样的注定失败的调用，无限往复。

事实基础（已核实）：

- **辅助调用与主对话共享同一个窗口**：摘要调用为了复用 provider 的 KV cache，刻意重放
  「system head + 工具 schema + shadow 区全部消息」（`buildSummarizationInput`），再追加
  压缩指令。输入本身就接近阈值水位，再叠加默认 65k 的输出预留，超出窗口只需一次冲高。
- **失败即螺旋**：`agent/pre-step` 的压力压缩失败只 warn（"continuing the turn"），下一步
  测量仍超阈值 → 再调一次一模一样的辅助调用；`compactionRetries` 只约束单次
  `compactIfNeeded` 内的重试，跨步没有退避。
- **summarize() 是上游刻意留下的唯一子类钩子**，但钩子只收到 `(input, agent, signal)`——
  预算钳制与截断发生在 `summarizeWithLlm` 内部的 replay 组装与调用参数里，子类换不掉。
- **工具 schema 也占窗口**：重放携带请求头的全部工具 schema，估算输入时不能忽略。

决定：

1. **修在上游 summarizer 内部，不开子类**：缺陷是上游通用的（任何部署配上默认
   `headroomTokens` 都可能踩中），不属于 yantao 特有行为；改动收敛在一个文件
   （`packages/compaction/compaction-basic/src/summarizer.ts`），据此在
   `docs/yantao/README.md` 合并面表格登记一行。本 ADR 即合并面扩条的依据。
2. **两级降级阶梯**（都在 `summarizeWithLlm` 内）：
   - **预检钳制**：调用前用 token meter 估算重放输入（消息逐条 `estimateMessage` +
     工具 schema 按字符数/4 粗估），`maxTokens = min(config.maxTokens, window − 输入估算 −
     安全边际)`。健康会话照旧全量重放（缓存友好路径零变化），只是输出预留不再虚高。
   - **头部截断**：钳制后仍不足最小输出预留（1,024 tokens）时，判定输入本身挤爆窗口——
   保住 system head 与工具调用/结果配对边界，从最旧一端截掉重放消息、只留装得下的最新
   部分，并在压缩指令前注入省略注记（告知模型头部若干条已被省略）。窗口未声明的
   adapter 跳过预检，靠反应式路径兜底。
   - **反应式半减**：provider 仍以 `CONTEXT_WINDOW_EXCEEDED` 拒绝（估算失准、gateway
     有效窗口小于声明值）时，从最旧一端再砍一半重放并重试，至多 4 次降级；无可再砍或
     次数耗尽则原样上抛——fail-closed 语义不变，只是不再原样重试注定的大调用。
3. **持久化协议零变化**：`compaction/start|summary|end` 事件与替换消息的形状不动；降级
   事实只进日志与指令注记，不进事件 schema（避免动上游 session 事件契约）。
4. **不动的部分**：阈值/保留水位（C 方案的纯配置下调只是缓解，已另行答复）；跨步退避
   （本次不做，见台账）；`compactionRetries`/`maxOverflowRetries` 语义。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 截断重放丢掉 span 头部细节，摘要质量降级 | 摘要调用必然可行，死亡螺旋解除 | 实现 map-reduce 分段摘要后整体替代截断 |
| 2 | 输入估算用启发式（逐条估算 + 工具按字符/4） | 不必为预估发起额外 LLM 调用 | 估算系统性失准时换成精确计价 |
| 3 | 窗口未声明的 adapter 无预检，首个大调用仍会白打一次 | 不强迫所有 adapter 声明容量 | 反应式降级不够用时强制声明 |
| 4 | 跨步无退避：降级也失败时每步仍各试一次 | 改动面最小，不引入新的状态机 | 出现真实的长时段连续失败刷屏 |
