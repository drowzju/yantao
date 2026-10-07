---
description: "yantaoUsage Typert Remote 控制器：工作台 UI 读取会话用量台账的通道（日账与单会话总量），面向 yantao-web 表层的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-yantao-usage-controller

## 概述

`dsh-api-yantao-usage-controller` 是 yantao 工作台「洞察」页签背后的 Typert Remote 控制器：`yantaoUsage` 命名空间下的两个一元方法——`dailyUsage`、`sessionUsage`——让浏览器读取宿主侧聚合出的会话用量台账（ADR-0050）。台账本体由 `dsh-yantao-usage` 插件持有（`yantao_usage` KV 域），控制器是无状态的只读适配器：每次调用先把台账增量刷新到当前，再作答。数值来自 token-meter 的四桶口径（未缓存输入、输出、缓存读、缓存写），不含任何费用估算。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)

-----

<a id="use-this-package"></a>
## 使用本包

`yantao-web` profile 会自动挂载本控制器；工作台 UI 通过 [`dsh-api-remotes`](../remotes/README.zh.md) 组装消费它。

### 命名空间

| 方法 | 签名 | 结果 |
|---|---|---|
| `yantaoUsage.dailyUsage` | `({ sinceDay?, untilDay? })` | `{ days, totals }`——闭区间本地日（`YYYY-MM-DD`）范围内的日账行（每行四桶 + 当日贡献会话 id 列表），旧日在前；无用量之日缺席；`totals` 为范围内四桶求和 |
| `yantaoUsage.sessionUsage` | `({ sessionId })` | 四桶形式的该会话终身用量总量；引用了存储中不存在的会话时报 `yantao-usage/not-found` |

### Client 消费

调用方插件在 `inject` 中同时声明 `remote` 与 `remote.yantaoUsage`，然后写 `ctx.remote.yantaoUsage.dailyUsage()`；结果是 `RemoteResult<T>`，就地用 `if (!result.ok)` 分支。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

控制器是一个 `TypertRemoteService`，`static inject = ['yantaoUsage']`：只有当 `yantao-usage` 插件发布了用量台账服务它才激活。两个方法都直接委托给服务；`dailyUsage` 的刷新是全量惰性扫描（单飞），`sessionUsage` 只推进那一个会话的游标。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 控制器：命名空间声明与两个 RPC 方法 |
| [`src/types.ts`](src/types.ts) | wire 载荷词汇（日账行、四桶、请求/结果）；形状单一来源于 usage 包的类型再出口 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-yantao-usage](../../yantao/usage/README.md)——持有台账与本控制器共享其读取面的聚合器插件。
- [dsh-yantao-web-app](../../bundle/yantao-web-app/README.md)——挂载本控制器的 bundle。
- [dsh-client-ui-yantao](../../client/ui-yantao/README.md)——消费本命名空间的「洞察」页签。
- [Remote API 手册](../../../docs/cookbook/adding-a-remote-api.zh.md)——本包遵循的五步契约。
