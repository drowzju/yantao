---
status: accepted
---

# 资源读取工具与目录提及（`kb_read_resource`、`@` 目录展开、资源栏树状展示）

资源子目录递归展示（`resourceSection` 遍历）落地后暴露出一组同源缺口：agent 能往
`resources/` 的任意子目录**写**文件（ADR-0026 决定 3），却没有任何工具能**读回**任何
资源——`kb_read_entity` 只认实体（type+name 参数），资源内容唯一的进会话通道是
ADR-0013 的 `@` 提及 pre-step 注入，而那是**人驱动的**：人不在消息里 `@`，模型对
资源内容一无所知。目标（ADR-0026 之后协作边界的自然延伸）：**只给文件名或目录名，
agent 也能完成它的工作**。同时，`@` 提及管线自身带着两个潜伏缺陷：`readCitedFiles`
读 utf8 不查 NUL——今天 `@` 一个二进制文件就会把乱码灌进上下文；`codec.serialize`
从不加引号——含空格的路径（`entities/projects/dsh 学习.md`）序列化后在正则的空格处
静默截断，提及无声失败（宿主正则的引号形态一直在，客户端从未产出过）。

事实基础（已核实）：`kb_write_resource` 已支持子目录路径（ADR-0026），`resourceSection`
已递归（2026-09-16，嵌套文件显示名带目录前缀）；上游 `@` 菜单的类型本就允许文件夹
（`InputTriggerCandidateIcon = 'file' | 'folder' | 'session'` 之 'folder'、chip
`appearance: 'folder'`），客户端只是从未合成过目录候选；`kbMentions` 的裸形态字符类
含 `/`，`@resources/报告/` 无需改正则即可解析，宿主 `stat` 对带尾斜杠的目录路径照常作答。

决定：

1. **`kb_read_resource`（第十一个 `kb_*` 工具）**。参数一个 `path`，知识库相对路径，
   必须以 `resources/` 开头（与 `kb_write_resource` 同一前缀门，禁 `.`/`..` 段）：
   - **文件** → 返回 UTF-8 全文；字节含 NUL 判为二进制，**拒绝**并报大小
     （`「resources/照片.png」是二进制文件（N 字节）`）——不注乱码、不猜测编码。
   - **目录** → 返回递归清单（每项 `path` + `size`），条目封顶
     100（`truncated: true` 标注截断）。清单只报路径与大小，不带内容也不探二进制——
     探二进制得把每个文件读一遍，清单不值得；agent 看到清单后按需逐文件再读，
     二进制在读取时被拒绝。
   语义与 `kb_write_resource` 对称：写是"只新建"，读是"只读"——资源永不改写的
   语义不破，本工具不提供任何写路径。
2. **`@` 目录提及展开为"清单 + 内容"**。pre-step 对每个提及路径先 `stat` 分流：
   文件照旧（读全文、32k 截断）；目录展开为递归清单——文本文件直接带内容（每文件
   32k 截断不变），二进制文件降为占位行（路径 + 大小，「二进制未注入」），每目录
   内容总预算 96k 字符（超预算的文本文件同样降为占位行）、条目封顶 100。人给目录名，
   agent 一次拿到全貌；更深的跟进由 agent 自己调 `kb_read_resource`。直接 `@` 一个
   二进制文件同样改为占位行（修掉 utf8 乱码洞），不再静默注入坏内容。
3. **资源栏树状展示**。客户端按 `file.path` 的目录前缀分组渲染可折叠目录树
   （默认全折叠，目录行点击展开/再点收起）——零 wire 变更，`resourceSection` 已递归
   产出的平铺列表就是树的数据源。其余 section（实体、会议）不树状化：它们是
   单层目录，平铺即真相。
4. **`@` 菜单合成目录候选 + serialize 引号**。`@` 菜单从资源文件的路径中间段合成
   目录候选（`icon: 'folder'`、ref 带尾斜杠如 `resources/报告/`）；手敲形态
   （`@resources/报告` 或 `@resources/报告/`）由宿主 `stat` 自然接住，不需要菜单
   也可用。`codec.serialize` 对含空格的 ref 输出引号形态 `@"entities/projects/dsh
   学习.md"`——宿主正则的引号分支从今天起真正被走到。
5. **chip 退格逐级展开**。Backspace 打在引用 chip 的后缘且 chip 的 ref 含父目录时，
   chip 原地展开为父目录的**活提及文本**（`@resources/报告/`，含空格目录用引号形态
   `@"…/"`）而不是整删——`1.json` 一退回到目录，再退回到上一级，与手敲路径的编辑
   心智一致。展开后的文本走普通 re-track，`@` 菜单自动在父目录上重开。无父目录的
   chip（session 引用、`resources/` 根）不展开，落回原生的整删语义。实现收在
   `ui-conversation` 的 input facade：`KEY_BACKSPACE_COMMAND` 以 CRITICAL 优先级
   注册（先于 plain-text 的整删 handler），纯函数 `chipBackspaceMention` 给出
   逐级目标文本，`$trimChipAtCaret` 只在"折叠光标紧贴 chip 且可展开"时替换该
   detect span，其余几何一律返回 false 落回原生路径。

## 取舍台账——为控制牺牲的便利性

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 工具读二进制一律拒绝（不转码不摘要） | 上下文永不被乱码污染；大小先行为人做判断 | 出现真实的"读图片/读 pdf"需求时走能力（脚本抽取），不扩本工具 |
| 2 | 目录提及的内容预算 96k、清单封顶 100 | 一次失控的目录引用拖不垮一轮上下文 | 预算频繁触顶成为日常（说明该分目录了） |
| 3 | 目录清单不带内容、要 agent 二次调用 | 会话只装它真正要读的文件 | 无——这是特性不是缺陷 |
| 4 | `resources/` 根本身不进 `@` 菜单候选 | 菜单是选择器不是浏览器；全库引用太容易失控 | 手敲 `@resources/` 一直可用 |
| 5 | 资源树默认全折叠、展开状态不持久化 | 首屏只有目录行，零状态管理 | 找新文件成为日常操作时再默认展开或持久化 |

原因：

- **为什么恢复 `kb_read_resource` 而不是让 agent 一直靠人 `@`**：ADR-0020 曾带一个
  `kb_read_resource`，但它是抽取缓存（`.yantao/extracts/`）的分页读取器，随读书项目
  一起退役（7407ee1f08）。本次恢复的是**同名不同物**：直读 KB 内文件/目录，无抽取、
  无缓存、无分页。写读不对称（能 `kb_write_resource` 却读不回自己刚写的东西）在
  "agent 只给目录名也要能干活"的目标下站不住；信任边界的精神是"无通用写能力"，
  一个前缀锁死在 `resources/` 的只读工具不破坏它。
- **为什么目录提及带内容而不只带清单**：人 `@` 一个目录时的意图通常是"这批东西你
  看一下"——只给清单等于把人的一半意图退回给 agent 的猜测。内容预算与占位降级
  保证最坏情形（全二进制目录）也只是几十行占位，不是几千行乱码。
- **为什么树状展示在客户端做**：wire 已带全路径（`file.path`），分组是纯展示决策；
  服务端再出一棵树是第二份真相，两处同步是纯负债。

后果：

- `AGENTS.md` 硬规则 2：「十个 `kb_*` 工具」→「十一」，并补资源读取从句。
- `packages/yantao/kb`：`core.ts` 增 `readResource`（工具与提及共用的路径门校验）；
  新增 `cited.ts`（提及读取：stat 分流 + 目录预算遍历，从 `index.ts` 移出使可测）；
  `mentions.ts` 增 `CitedEntry` 联合与 `<kb-dir>` 渲染、`MAX_DIR_ENTRIES`/`MAX_DIR_CHARS`。
- `packages/client/ui-yantao`：`Workbench.tsx` 资源 tab 换 `ResourceTree`（抽共享
  `FileRow`）；`kb-reference.ts` 合成目录候选 + serialize 引号。
- `packages/client/ui-conversation`（上游合并面）：`input/facade.ts` 注册
  `KEY_BACKSPACE_COMMAND`（决定 5）。
- 文档同步：`docs/yantao/README.md`（工具数与 ADR 索引）、`packages/yantao/kb/README.md`、
  `packages/bundle/yantao-web-app/README.md`（工具数）、`docs/yantao/TODO.md`。
- 未做：二进制资源的转码/摘要读取、`entities/` 目录提及（实体有自己的清单工具）、
  资源树折叠状态持久化、`registerResource` 拖入保留子路径（仍登记到根，另议）。

落地注记（2026-09-16）：四条决定全部落地。决定 1：`kb_read_resource` 注册为第十一个
工具，文件/目录双形态，二进制拒绝带大小，目录清单封顶 100 带截断标注；决定 2：pre-step
改走 `readCitedEntries`（stat 分流），目录展开带 96k 内容预算与二进制/超预算占位，
直接 `@` 二进制文件从"灌乱码"改为占位行；决定 3：资源 tab 渲染 `ResourceTree`
（`groupResourceFiles` 分组、可折叠，行菜单/选中/打开行为与原平铺一致）；
决定 4：`@` 菜单目录候选（icon folder、ref 尾斜杠），serialize 含空格加引号。
验证:kb 167 + controller 156 + ui-yantao 215 测试全绿,scoped oxlint 通过,`gen-cordis-catalog --check` 98 个生成物 up to date。
2026-09-17 修订：决定 3 的默认态按使用者反馈从"全展开"改为"全折叠、点击展开"
（`expanded` 空集语义，新目录天然折叠）；取舍台账第 5 行随之改写。

落地注记（2026-09-17）：决定 5 落地。`input/facade.ts` 以 CRITICAL 优先级注册
`KEY_BACKSPACE_COMMAND`：`chipBackspaceMention`（纯函数，ref → 父目录提及文本，含
空格目录出引号形态）+ `$trimChipAtCaret`（折叠光标紧贴 chip 且可展开时以
`$replaceDetectSpanWithText` 原地展开，其余几何返回 false）+ 命令注册（IME 组合中
的 Backspace 直接放行）。无父目录 chip 的整删由 plain-text 既有 handler 接住，
行为不变。验证：ui-conversation 全套（lexical-editor-core 28 用例含纯函数与
`$trimChipAtCaret` 三几何、input-scenarios 两个集成场景——展开为活父目录提及 /
无父目录整删）全绿。测试注记：命令 dispatch 的编辑器 commit 落在 microtask（仅
`discrete` update 同步 commit），集成断言前须以 async act 冲刷。
