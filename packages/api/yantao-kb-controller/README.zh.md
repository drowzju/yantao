---
description: "yantaoKb Typert Remote 控制器：工作台 UI 直连知识库的通道（限制在 kbRoot 内的 tree/read/write），面向 yantao-web 表层的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-yantao-kb-controller

[English](README.md) | 中文

## 概述

`dsh-api-yantao-kb-controller` 是 yantao 工作台 UI 背后的 Typert Remote 控制器：`yantaoKb` 命名空间下的十六个一元方法——`intakeTree`、`workspaceTree`、`read`、`write`、`deleteFile`、`setRelation`、`root`、`setRoot`、`createEntity`、`links`、`revision`、`openExternal`、`todos`、`writeTodos`、`mailFetch`、`mailMarkRead`——让浏览器直接列出、编辑与扩充知识库。所有路径都是知识库相对路径，并被限制在 `yantao-kb` 插件以 `yantaoKb` 服务发布的 kbRoot 之内，因此控制器共享插件的唯一配置点，绝不重复配置；`setRoot` 则重新指向这个唯一的根目录。UI 是人类通道，所以 `write` 是整文件写入；ADR-0004 信任边界只约束 agent 的 `kb_` 工具，从不约束本表面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`yantao-web` profile 会自动挂载本控制器；工作台 UI 通过 [`dsh-api-remotes`](../remotes/README.zh.md) 组装消费它。

### 命名空间

| 方法 | 签名 | 结果 |
|---|---|---|
| `yantaoKb.intakeTree` | `()` | 收集侧的小节（`resources`、`meetings`、`todos`）；资源行配对影子笔记，旁边没有原件的 `.md` 自己就是一行；每个资源行都保留文件名的后缀，因此 `周报.eml` 与 `周报.eml.md` 不会被看成同一个东西 |
| `yantaoKb.workspaceTree` | `()` | 工作侧的小节（`projects`、`areas`、`people`）；行结构与上面相同 |
| `yantaoKb.read` | `(path)` | `{ path, content }`——文件完整 UTF-8 内容 |
| `yantaoKb.write` | `(path, content)` | `{ path }`——整文件写入，自动创建缺失的父目录 |
| `yantaoKb.deleteFile` | `(path)` | `{ path }`——删除知识库内的一个文件；路径同样受根目录约束，文件不存在是 `not-found` |
| `yantaoKb.setRelation` | `({ path, relation })` | `{ path, relation }`——改写人物实体 frontmatter 里的 `relation`，文件其余部分逐字节保持原样 |
| `yantaoKb.root` | `()` | `{ root, configured }`——当前生效的知识库根目录，以及人类是否已经选过 |
| `yantaoKb.setRoot` | `(path)` | `{ root, configured, created, existing }`——把 `path` 初始化为知识库、设为当前根目录并记住它 |
| `yantaoKb.createEntity` | `({ type, name, date?, relation? })` | `{ path }`——按 canonical 模板创建一个实体笔记 |
| `yantaoKb.links` | `(path)` | `{ outgoing, incoming }`——该文件的 `[[双链]]` 图，在宿主侧解析，且绝不指向 `resources/`（ADR-0015） |
| `yantaoKb.revision` | `()` | `{ root, revision }`——知识库根目录下任何文件变动就自增的计数器，随 `setRoot` 重建（ADR-0017） |
| `yantaoKb.openExternal` | `(target)` | `{ ok }`——把知识库内路径或白名单协议的 URL 交给系统打开，拒绝 shell 元字符（ADR-0017） |
| `yantaoKb.todos` | `()` | `{ path, text, items }`——`entities/todos.md` 单例解析出的结构化条目，外加文件原文（ADR-0018） |
| `yantaoKb.writeTodos` | `({ items, expectedText })` | `{ path, text }`——替换单例的条目，保留 preamble（ADR-0018） |
| `yantaoKb.mailFetch` | `({ since?, until?, limit? })` | `{ since, until?, lastReadAt?, stale, messages, hasMore }`——`[since, until)` 区间内的最新邮件，由 Python/COM 子进程读出（ADR-0019） |
| `yantaoKb.mailMarkRead` | `({ lastReadAt? })` | `{ lastReadAt }`——把断点往前推；缺省为当前时刻（ADR-0019） |

`setRelation` 只对人物文件作答：其它文件一律 `yantao-kb/rejected` 且不被改写，五种关系之外的取值同样拒绝。它是对 frontmatter 的一行拼接，绝不重排 YAML——重新生成映射会丢掉人类写的注释与顺序。

`setRoot` 只接受绝对路径（相对或空路径会被拒绝），并把它交给 `yantaoKb` 服务——服务负责把选择持久化到 `~/.dsh` 之下。`createEntity` 接受 `project`、`area`、`person`、`meeting`；会议文件名会冠以它自己的日期。人物实体会写入调用方给出的 `relation`——`self` / `subordinate` / `superior` / `peer` / `external`，即 kb 领域自己的五种关系；调用方不指定时，沿用领域自己的缺省值。

`todos` / `writeTodos`（ADR-0018）是编辑 `entities/todos.md` 单例的结构化方式——这一对方法存在的原因是 Client **不能** import kb 包的解析器（bundle purity）。`todos` 把缺失的文件报成 `text: ''` 与空条目，而不是报错；`writeTodos` 拿 `expectedText` 与磁盘上的当前文本比对，不一致就是 `yantao-kb/rejected`——于是工作台之外的修改会被刷新，绝不会被覆盖。文件的 preamble（清单上方人类写的标题）原样保留，只替换条目。

`mailFetch` / `mailMarkRead`（ADR-0019）是第一个连接器。`mailFetch` 只读收件箱，单次最多 50 封，并用 `~/.dsh/yantao-kb.json` 里的断点作下界——从没跑过时用「30 天前」，这样首次读取不会去 COM 上把整个收件箱走一遍；`until` 是配对的上界，没有它每次读取都落在最新那一页，工作台就永远没法「往前」读更早的邮件。断点缺失或早于 30 天时它回答 `stale`（由界面问是否补读更早那段：既不静默跳过，也不静默补齐），页面被填满时回答 `hasMore`——要想知道精确还剩多少封，就得把文件夹里每一项都摸一遍。两者都要求先选过知识库目录，因为断点就记在它旁边。

失败是 `RemoteError`：路径没有对应文件时为 `yantao-kb/not-found`；路径逃逸、目标不是文件、I/O 拒绝或知识库领域拒绝（实体已存在、`todo` 单例）时为 `yantao-kb/rejected`——两者的 `details` 都携带出问题的 `path`；连接器失败时为 `yantao-kb/mail`，`details` 带失败种类 `kind` 与告诉人该装什么、该启动什么的 `hint`。

### Client 消费

调用方插件在 `inject` 中同时声明 `remote` 与 `remote.yantaoKb`，然后直接写 `ctx.remote.yantaoKb.tree()`；结果是 `RemoteResult<T>`，就地用 `if (!result.ok)` 分支。见 [Remote API 手册](../../../docs/cookbook/adding-a-remote-api.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

控制器是一个 `TypertRemoteService`，`static inject = ['yantaoKb']`：只有当 `yantao-kb` 插件发布了解析后的 KB 根目录它才激活，并在每次调用时读取该根目录。路径限制复用 kb 包的 `resolveWithinKb`（逃逸尝试在边界被归类为 `yantao-kb/rejected`），`tree` 的实体节复用 `listEntities`，因此 wire 视图与 agent 的工具以同样方式读同样的文件。`resources/` 与 `sessions/` 节是每次调用都重新读取的目录——UI 永远看到人类刚写入的内容。`write` 不做 frontmatter 校验：人类拥有文件结构，agent 的工具会在下次读取时重新校验。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 控制器：服务声明、路径限制与三个方法 |
| [`src/types.ts`](src/types.ts) | wire 载荷词汇（树节、文件行、读写结果） |
| — | 不发布运行时不变量伴生包；控制器是无状态适配器，其限制与树形契约由包内单元测试覆盖。 |
| [`tests/controller.spec.ts`](tests/controller.spec.ts) | 基于真实临时目录的树形、读写往返、root/setRoot/createEntity、not-found 归类与逃逸拒绝覆盖 |

### 不变量归属

不发布不变量伴生包，因为控制器不持有进程内的可变关系：每次调用都重新读取文件系统，其限制与树形契约由单元测试直接检验。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解拥有知识库的插件或挂载本控制器的表层时，阅读这些页面。

- [dsh-yantao-kb](../../yantao/kb/README.zh.md)——本控制器共享其根目录与操作的 KB 领域插件。
- [dsh-yantao-web-app](../../bundle/yantao-web-app/README.zh.md)——挂载本控制器的 bundle。
- [dsh-client-ui-yantao-kb](../../client/ui-yantao-kb/README.zh.md)——消费本命名空间的工作台 UI。
- [Remote API 手册](../../../docs/cookbook/adding-a-remote-api.zh.md)——本包遵循的五步契约。
- [dsh-api-remotes](../remotes/README.zh.md)——挂载本贡献的 Client 组装。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本控制器是面向 UI 的 API 与传输拥有者，不注册任何提示、工具或会话事件；kb_ 工具与聊天 agent 拥有所有面向模型的效果。

#### KV Cache 影响

本控制器不向任何请求前缀添加内容；它从不参与模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本控制器刻意不做的事。它们是本包当前的约束，不是任务清单。

- **变更检测是轮询,不是推送**——`revision()` 公开一个计数器供 UI 轮询(ADR-0017);两条侧栏本身仍在操作手势与自身写入后刷新,因此人类的外部修改在下一次轮询时可见,而非实时。
- **写入不做 frontmatter 校验**——人类通道拥有文件结构；实体文件不合法时由 agent 的工具在下次读取报告，而非本表面。
- **只有整文件写入**——没有小节级编辑；人类编辑完整文本（agent 的只追加通道在 kb_ 工具侧，不在本表面）。
- **二进制资源按 UTF-8 文本提供**——对非文本原件调用 `read` 会得到替换字符内容；编辑器把原件标记为只读而不是解码它们。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
