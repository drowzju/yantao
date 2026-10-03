# 能力整编手册

> 把一个新 skill 整编为 yantao 工作台能力的全部契约与步骤。单一权威：本文；ADR-0043（能力契约与通道一致化）是决策依据。
> 本文件有一份资源副本（`resources/能力整编手册.md`）供工作台 agent 经 `kb_read_resource` 读取——docs 版为权威，副本同步更新。

## 三层心智模型

| 层 | 内容 | 谁可以改 |
|---|---|---|
| 触发面 | 会话 agent、后台、工作台 UI（右键/能力 tab） | 允许不同 |
| 调用适配层 | sidecar、中央路由、信封、（必要时）适配脚本 | 只在 `.dsh/`，我方所有 |
| 核心能力层 | SKILL.md 语义 + 脚本本体 | **三方 skill 一个字符不动** |

技能永远面向标准运行时写作；环境差异永远由宿主吸收（环境前置说明 + 信封）。

## 目录与两个 JSON 契约

一个能力是 `.dsh/skills/<名字>/` 目录：SKILL.md（指令）+ 脚本 + `yantao.json` sidecar。

**sidecar（`yantao.json`）**：

```json
{
  "version": 1,
  "runtime": "python",
  "entry": "scripts/entry.py",
  "appliesTo": { "external": ["dingtalk"], "resource": [".pdf"], "entity": ["projects"] },
  "invocation": ["human", "agent"]
}
```

- 无 `entry` = **指令型**：运行即把 SKILL.md 正文返回给 agent 照做；有 `entry` = **脚本型**：宿主执行入口脚本。
- `entry` 也可指 skill 目录之外、`.dsh/` 之内（如 `yantao/capability-adapters/<名字>/entry.py`）——三方目录零新增时，我方适配脚本住 `.dsh/yantao/capability-adapters/`。
- `appliesTo` 三个键按需省略；`invocation` 决定人/agent 谁能调。

**中央路由（`.dsh/skills/yantao.json`）**——sidecar 之外必须再注册一次，否则 agent 以「不在本轮注入的能力目录」拒调：

```json
{ "<名字>": { "path": "<名字>", "invocation": ["human", "agent"], "appliesTo": { "external": ["dingtalk"] } } }
```

**纯路由采纳（archify 先例，2026-10-02）**：三方 skill 不带自己的 `yantao.json` 时可以**不写 sidecar**，只在中央路由登记一条——此时按指令型对待（运行即返回 SKILL.md 正文），`invocation`/`appliesTo` 以路由条目为准。声明读取的优先序是：**有效 sidecar 胜出，路由兜底**（`resolveCapability` 的双闸裁决，ADR-0043）——两边都写时字段不一致会静默偏向 sidecar，所以**二选一**，别两头维护。

**拷贝净化**：三方目录原样拷入，但有两样东西必须删——skill 自带的 `yantao.json`（防止与本方路由形成歧义双声明）和 `package-lock.json`（本机不用 npm 安装它的依赖，留着只会误导）。

## 信封契约（冻结）

宿主 → 脚本：

- 环境变量：`KB_ROOT`（知识库根绝对路径）、`CAPABILITY_NAME`、`CAPABILITY_CHANNEL`（`agent`/`human`，脚本不可伪造）、`PYTHONIOENCODING=utf-8`
- stdin：一行 JSON `{name, kbRoot, input, state, channel}`

脚本 → 宿主（stdout）：`{ok, result?, state?, artifacts?}`；artifacts 是 `{文件名, base64}`，由宿主写入 `.dsh/yantao/capabilities/<名字>/`（机器簿记，不是成果）。

## 两种调用方式

| 方式 | 工具 | 用途 |
|---|---|---|
| 声明式 | `kb_run_capability` | sidecar 声明的 entry；UI/后台/提议流共用此通道 |
| 执行桥 | `kb_exec_capability_script` | agent 在**已安装能力目录内**直接执行脚本（cwd 锁该目录，信封同上）——SKILL.md 里「执行 `python xxx`」这类中途步骤用它 |

安装即授权（ADR-0021/0043）：人已安装的技能即可信代码，执行桥不做动词白名单；通用 shell 与编辑器仍然对 agent 禁止。

## 环境前置说明与行为记忆

- 指令型返回正文、脚本型 `/名字` 提示，都会带一段【环境说明】（无通用 shell、执行桥用法、资源默认指 `resources/`、落盘是脚本自己的事）——SKILL.md 不需要也不应该写这些。
- 运行返回末尾的【行为记忆·宿主转交】块是**人批规则**，可信且须遵守；能力域记忆由人批准沉淀（`.dsh/yantao/memory/capabilities/<名字>.md`），批准的入口见下节。

## 记忆回流（ADR-0044）

能力运行学到的坑与经验，经**提案-批准制**沉淀为能力域记忆——agent 有提名权，决定权在人：

- **agent 侧**：会话内调用能力后，学到非显然的东西（坑/绕过/环境怪癖/用户纠正）应在任务收尾经 `kb_propose_memory(scope, text)` 提名。提案只进队列、**永不注入**；与现有记忆或在途提案重复时就地拒绝。scope 用 `global` 或能力名。
- **人侧**：会话内的批准卡片当场批；漏批的落记忆视图「待批准」区兜底。UI 面的手动运行没有 agent 在场——能力 tab 运行记录旁的「提炼经验」按钮拉起一次性 headless 提炼者，把该次运行的信封（命令/退出码/时长/输出尾）提炼成 0~3 条候选提案。
- **批准即转正**：批准时可改判目标作用域（默认来源 scope），转正复用记忆写入（去重、软帽整套继承）；丢弃即移除。提案队列挂起软帽 20 条，满员拒新案——先清队列。

## 落盘约定（ADR-0042）

「资源」默认指 `<kbRoot>/resources/`：脚本产出缺省落这里（相对 out 按 kbRoot 解析），结果尾附 `[落盘]` 行给真实位置；agent 事后用 `kb_read_resource` 读取。原件进入后永不改写（kb_write_resource 只新建不覆盖）。

**迭代产物命名**：因为只新建不覆盖，同一能力的每一轮产出要用**新文件名**（带轮次/日期后缀，如 `xxx-v2.html`），想覆盖就先让人在 UI 里删旧文件。这是刻意的：成果平面不可被 agent 静默改写。

## 菜单与手势

`/名字` 三入口（`/` 菜单点选、能力 tab、手打）只把文本填进输入框；脚本型在菜单带 ⚙ 标记。惯用提示词（别名）存 `.dsh/yantao/prompt-shortcuts.json`，UI 唯一写者。

**选区右键**（ADR-0025/0026）：选中文字后右键发给声明了 `appliesTo.selection` 的能力，合成的是 `/名字 <选中文字>` slash 消息，走 pre-step 双消息注入（用户原文 + skill-invocation）。**首轮陷阱**：会话第一轮系统提示词沙箱快照会落在手势之后——2026-10-02 已修（pre-step 从尾部跳过 plugin 消息找用户消息），细节与排障见 [development.md](development.md) 排障一节。

## 常见坑

1. **漏注册中央路由** → agent 拒调「不在能力目录」。能力 tab 详情的「声明」区可一眼看出路由状态。
2. **信封 kbRoot 缺失** → 落盘退回脚本自带目录（agent 读不到）。独立调试时务必构造信封或设 `KB_ROOT`。
3. **落盘越界**：产出写 `.dsh/` 或实体目录 = 违反约定；产出只落 `resources/`。
4. **输出封顶**：执行桥 stdout/stderr 各 64KB 截断；超时缺省 120s 可传 `timeoutMs`。
5. **改控制器 Remote 面后**必须窄重建 `packages/api/remotes` 客户端产物，否则页面报 `is not a function`。
6. **`/名字` 手势首轮无效** → 见 [development.md](development.md) 排障一节（2026-10-02 已修的首轮沙箱快照问题）。
7. **执行桥里塞 `python -c` 多行载荷** → 第一换行处被 cmd.exe 静默截断（exit 0、首行照跑）。已裁决不动底层：要程序逻辑就让能力自带 `.py` 脚本。

## 升级与源头

能力来自某个源头仓库时（如 archify 在 `D:\code\archify`），**升级 = 从源头重新拷贝内核层**，再对照本手册检查清单走一遍（净化、路由核对、试跑）。适配脚本住在我方的 `.dsh/yantao/capability-adapters/`，不受源头升级影响；源头 skill 自身漂移的新能力，按需补适配。

## 整编检查清单

1. 拷 skill 目录到 `.dsh/skills/<名字>/`（原样，不改；删掉自带的 `yantao.json` 与 `package-lock.json`）
2. 写 sidecar，**或**走纯路由（见上文 archify 先例）；需要适配脚本时放 `.dsh/yantao/capability-adapters/<名字>/`，sidecar `entry` 指过去
3. 注册中央路由 `.dsh/skills/yantao.json`（无论如何都要；sidecar 只管声明，路由管开关）
4. 试跑一个只读动词（list 类）验证信封链路
5. 能力 tab → 详情 → 「声明」区确认 sidecar/路由/开放状态全部正常
