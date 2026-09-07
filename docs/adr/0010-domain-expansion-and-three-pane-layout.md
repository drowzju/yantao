---
status: accepted
---

# 领域模型扩张与三栏布局

决定：

1. **修订 ADR-0004 的信任边界。** `状态` 区段不再对 agent 不可写——agent 现在可以编辑 `状态`。信任边界仍由工具集保证：agent 只能通过 `kb_*` 工具写文件，不能绕过工具直接 `fs.writeFile`。区段级限制取消，工具级限制保留。
2. **领域模型扩张。** 在 PARA+P（project / area / people）基础上增加：
   - **meeting 实体** —— 一个 markdown 文件，frontmatter 仅含 `type: meeting` + `date` + `title`（后续按需扩展）；有 `状态`/`流水` 区段，与其他实体同构。
   - **todo 单例实体** —— 一个 markdown 文件（`entities/todos.md`），无区段结构，body 为 obsidian 语法的 checkbox 列表（`- [ ]` / `- [x]`）。frontmatter 仅含 `type: todo` + `created`。
   - **connector 抽象** —— 连接是一种资源接口，具体实现可能是 python 脚本或命令行。connector 不落盘、不进 tree，未来通过 `yantaoKb.connectors()` 方法暴露。现在只在 ADR 中描述，不实现。
3. **三栏 UI 布局。** 左栏 = 信息输入侧，4 个独立面板（resource / todo / meeting / connector）；中栏 = agent 主交互区；右栏 = 协作加工侧，3 个可切换 tab（area / people / project）。
4. **两棵树。** `yantaoKb.tree()` 拆为 `yantaoKb.intakeTree()` + `yantaoKb.workspaceTree()`：
   - `intakeTree()` 返回 `resources` + `meetings` + `todos` 三个 section。
   - `workspaceTree()` 返回 `projects` + `areas` + `people` 三个 section。
   - connector 不进 tree，未来有独立方法 `yantaoKb.connectors()`（仅 ADR 描述，不实现）。
5. **KB 目录调整。** `entities/` 下新增 `meetings/` 目录（每个 meeting 一个 `.md`）和 `todos.md` 单例文件。`sessions/` 目录保留但当前不使用（会话功能移除，未来重新设计）。

原因：

- `状态` 不可写是旧 yantao 时代的防御性设计，但实际使用中 agent 需要直接更新实体状态（如标记任务完成、更新项目进度），逐条人批准成本过高。工具集仍是边界——agent 无法绕过 `kb_*` 工具写文件——所以安全性不依赖区段级限制。
- meeting 和 todo 是个人工作台的核心操作单元，不纳入领域模型则 UI 无处安放。
- connector 预留是为了未来从外部系统（邮箱等）拉取资源，但实现形态未定，先不进 tree。
- 两棵树对应"输入"与"加工"的语义分区，比一棵扁平的 5-section 树更贴合 UI 布局。
- 会话（Conversation）功能移除是因为数据源（dsh session API）尚未明确，强行实现会引入返工。

后果：

- ADR-0004 正文修订：`状态` 从"人类专属"改为"agent 可写"，`流水` 仍只追加。`kb_append_log` 的描述需更新（不再声称"状态不可改"）。
- `kb_*` 工具需新增写 `状态` 区段的能力（新工具或扩展现有工具）。
- `yantaoKb.tree()` 改为 `intakeTree()` + `workspaceTree()`，`KbTreeSectionId` 枚举调整，controller 和 UI 需同步。
- `initKb` 需创建 `entities/meetings/` 目录和 `entities/todos.md` 单例文件。
- 33 个测试中验证"状态不可写"的用例需更新（`kb_append_log` 测试中验证 State section byte-for-byte 保留的用例仍成立——appendLog 仍只追加流水，不改状态；但任何显式断言"agent 不能写状态"的用例需移除或反转）。
- `ui-yantao-kb` 的去向前置：三栏 UI 不用槽位，`ui-yantao-kb` 的 KB 树/编辑器逻辑可移植进 `ui-yantao` 或 `apps/yantao/src/`。
- `packages/yantao/CONTEXT.md` 词汇表需更新：增加 meeting、todo、connector 条目；`状态` 定义改为"agent 可编辑"。
