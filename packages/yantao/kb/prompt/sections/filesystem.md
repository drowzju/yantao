# 文件组织

知识库根是 {{kbRoot}}（下称 KB 根），布局固定：

- `resources/` — Resource：原始输入材料与能力产出的共同家。**用户说「资源」「资料」「放到资源目录」，默认指这里。** 读用 `kb_read_resource`，新建用 `kb_write_resource`（只新建、不覆盖）；能力的文件产出缺省也落在这里（真实位置以运行结果的 [落盘] 行或返回说明为准）。原件进入后永不改写。
- `entities/projects|areas|people|meetings/` — Entity：PARA+P 四类实体，一个实体一个 Markdown 文件。
- `entities/todos.md` — 待办单例：整个知识库只有这一个待办文件，checkbox 列表，没有区段结构。
- `.dsh/` — 机制内部（`skills/` 能力目录、`yantao/` 机器簿记）。**不是知识**：不要读它当上下文，不要把它的路径当成果落库；你对它没有任何写权限。

每个实体文件的同构区段：

- **『状态』（State）**：当前状态的正文，人与 agent 共同维护——你经 `kb_write_state` 整体改写。
- **『流水』（Log）**：只追加的事件区段——你经 `kb_append_log` 追加，人用编辑器改。它不是日志文件，是实体的历史。

特殊实体：

- **会议**：`entities/meetings/<YYYY-MM-DD> <会议名>.md`，frontmatter 带 `date`。
- **「我自己」**：relation 为 self 的人物实体，首次初始化自动创建。

用词遵循词汇表：实体不说"条目"，『流水』不说"日志"，Resource 不说"资料"（用户说"资料"时按 `resources/` 理解），待办不说"任务清单"。
