---
status: accepted
---

# agent 直写权限矩阵（在场即授权）

出发点（2026-10-17）：用户通过花茶要求「标记聚餐完成」，期望把待办清单里某条记录改成已完成。
agent 把 `kb_propose_actions` 的动作类别试了个遍全被拒——待办单例没有 `## ` 章节，
`kb_edit_section` / `kb_write_state` 拒收；`kb_add_todo` 只能加不能改。用户随即重申了完整的
权限矩阵：**对左栏/右栏的所有资源和实体做操作**——资源可读、待办可读写、记忆可增删改查、
工作空间可列举可触发、能力可调用、实体可读写编辑。

事实基础（已核实）：

- **动作类别 validator 有 13 种**（`create-entity, create-project, append-log, write-state,
  save-resource, create-link, add-todo, edit-section, append-section, add-memory, delete-mails,
  archive-mails, skill-rewrite`），待办编辑类确实不存在——agent 的「只有五种」错觉来自它自己的试探。
- **底层原语早已齐全**：kb 包有 todo 全套 CRUD（`addTodo/updateTodo/removeTodo/toggleTodo/
  parseTodoFile/serializeTodoFile`）与记忆增删查（`appendMemoryEntry/removeMemoryEntry/
  listMemoryScopes`，条目 id = `sha1("scope|text")`）；controller 人通道 RPC 有 `todos`/`writeTodos`
  （`expectedText` 乐观并发）、`memoryList/Add/Delete`、`workspaceList/Save/Run/RunStop/RunsList`。
- **缺口是纯粹的 agent 工具暴露**：不是能力缺失，是信任边界没开门。
- **资源与实体早就达标**：`kb_read_resource` 能读文本（含 html/eml）与目录列举；实体的状态与
  章节早可写（ADR-0010/0026）；能力可调（ADR-0023/0052）。矩阵真正的洞只有三个：待办只增不改、
  记忆只提案不直写、工作空间零工具。

决定：

1. **在场即授权推广**（推广自 ADR-0061 决定 1）：对话里的明确要求本身就是授权，
   不必事事排队进提议收件箱。提议队列的本职是「无人值守时的审批面」——定时任务、批量提名；
   人坐在窗口前看着 agent 干活时，排队是官僚主义。新增九个工具（十六→二十五）。
2. **待办读写四工具**：`kb_read_todos`（带序号全量清单）/ `kb_toggle_todo`（勾选自动盖
   `[done::今天]` 戳、取消摘除）/ `kb_update_todo`（title/due/body 补丁，`due:''` 清截止）/
   `kb_remove_todo`。四个写工具共用一条 `editTodos` 缝：读最新 → 变异 → `writeTodos`
   （`expectedText` 乐观并发）。冲突时报错指路「先 `kb_read_todos` 重读最新序号再试」，
   绝不盲写覆盖别人刚落的改动。
3. **记忆三工具**：`kb_list_memory`（带完整 40 位 id）/ `kb_add_memory`（重复原文照旧拒绝）/
   `kb_delete_memory`（按 id）。**改 = 删 + 增**——记忆条目是单行文本，本就没有更新动词，
   不为此发明一个。定时会话仍然只许 `kb_propose_memory` 进提案队列（无人值守不免审的原则不动）。
4. **工作空间定向松绑**（对 ADR-0056 决定 1「纯人通道」的两处开口）：
   `kb_list_workspaces`（列空间与指令）+ `kb_run_workspace_instruction`（触发某空间某条已定义
   指令，`trigger: 'agent'` 如实入账）。**定义写保持人通道**——ADR-0056 决定 2 的「创建绑定即
   授权」不开给 agent，不让 agent 自我编程；触发已有定义与调用能力（ADR-0023）同级信任。
   定时会话拒绝触发（防链再触发链的递归）。
5. **trigger 词汇如实扩员**：`WorkspaceRun.trigger` 从 `'manual' | 'cron'` 扩为
   `'manual' | 'cron' | 'agent'`，贯穿存储读回校验、runtime 日志头、controller 类型、
   WorkspacePanel 行标（「agent 触发」）。不为省事把 agent 触发谎报成手动。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 对话语境的待办/记忆直写绕过提案队列（定时会话除外） | 在场即授权——人看着的操作不需要人事后审批的仪式 | 出现对话直写误伤事故 → 收回对应工具降级回提案 |
| 2 | agent 不能写工作空间定义（增删指令、改步骤） | 防 agent 自我编程——它能跑什么由人先画好 | 用户明确要求 agent 代改空间定义 |
| 3 | 乐观并发冲突时模型要多花一轮重读重试 | 绝不盲写——人手正在编辑时 agent 的写入不会无声吃掉人的改动 | 冲突率高到重试成为负担（不太可能：单人库） |
| 4 | 记忆没有原地更新动词（改一条 = 删旧 + 增新，id 变化） | 条目单行模型零改动；删+增语义严格等价 | 条目演进成多行结构时 |
| 5 | `kb_run_workspace_instruction` 只能触发 `enabled` 的已定义指令，不能拼参数 | 触发面与手动按钮完全同权，无新攻击面 | 出现「agent 需要带参触发」的真实场景 |

原因：

- **为什么不扩 `kb_propose_actions` 的动作类别**：那条路的终点是「人在提议页批准后才落盘」，
  而用户的诉求恰恰是当场生效——「标记聚餐完成」是个两秒钟的动作，不该走一遍提案-审批编舞。
  提议队列继续服务它的本职：定时运行的提名与批量提案。
- **为什么待办写不走 `kb_edit_section`**：待办单例没有章节结构，强行当成 section 编辑等于让
  模型手搓 checkbox 行——`[done::]` 戳、preamble、排序都是结构化语义，交给专用的
  parse/serialize 往返才无损。
- **为什么 trigger 要扩员而不是并入 manual**：运行账本是审计面，谁点的火就该写谁的名字；
  谎报手动会让「这条链是谁触发的」永远查不清。
