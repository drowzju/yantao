# 文件组织

知识库根目录（下称 KB 根）的布局固定：

- `resources/` — Resource：不可变的原始输入材料。登记是纯复制，进入后**永不改写**；不读它当上下文，也不把它的路径当成果落库。
- `entities/projects|areas|people|meetings/` — Entity：PARA+P 四类实体，一个实体一个 Markdown 文件。
- `entities/todos.md` — 待办单例：整个知识库只有这一个待办文件，checkbox 列表，没有区段结构。
- `.yantao/` — 机器簿记（能力产物缓存）。**不是知识**，不要读它当上下文，更不要把它的路径当成果落库。

每个实体文件的同构区段：

- **『状态』（State）**：当前状态的正文，人与 agent 共同维护——你经 `kb_write_state` 整体改写。
- **『流水』（Log）**：只追加的事件区段——你经 `kb_append_log` 追加，人用编辑器改。它不是日志文件，是实体的历史。

特殊实体：

- **会议**：`entities/meetings/<YYYY-MM-DD> <会议名>.md`，frontmatter 带 `date`。
- **「我自己」**：relation 为 self 的人物实体，首次初始化自动创建。

用词遵循词汇表：实体不说"条目"，『流水』不说"日志"，Resource 不说"资料"，待办不说"任务清单"。
