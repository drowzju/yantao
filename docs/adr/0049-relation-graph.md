---
status: accepted
---

# 关系图谱（图谱 tab）

出发点（2026-10-06 裁决）：知识库的关系载体有两种——wiki-link `[[双链]]`（ADR-0015）与
frontmatter 字段（project 的 `areas: []`），但两者都只以「文本」形态存在：`links(path)`
RPC 是单文件的出入链面板，`graph()` RPC（ADR-0035）虽给全库图却无类型、无过滤，人想
一眼看清「谁在做哪个项目、哪些人和领域围着项目转」没有任何面。本轮要的是中栏第五个
常驻 tab「图谱」：力导向图可视化三类关系——人-项目、领域-项目、人-人——排除 meeting/todo
边、归档实体与悬空边。

事实基础（已核实）：`linkGraphOf`（ADR-0035 落地的 `packages/yantao/kb/src/links.ts`）
已产出全库 wiki 边并过滤归档节点连同其边，但边无类型（`{from, target, to}`）、不含
frontmatter 关系；`resolveWikiLink` 的 locator 正则接受 `area:` 前缀（links.ts:186），
frontmatter 里的领域名可走同一解析通路定位到 `entities/areas/` 文件；工作台无任何图
可视化依赖，个人库规模（数十节点）使 O(n²) 斥力循环足够便宜。

决定：

1. **新 RPC `relationGraph`，不扩展 `graph()`**：`graph()` 的消费者是校验预扫
   （ADR-0035/0036），其 wire 形状（无类型边）已被那侧依赖；关系图谱需要的是类型化
   边（`person-project` / `area-project` / `person-person`），塞进同一形状会让两个
   消费方互相迁就。`yantaoKb.relationGraph()` 返回 `{nodes: string[], edges:
   {from, to, kind}[]}`，委托 kb 包新模块 `relations.ts`。
2. **wiki 边单一事实源**：`relationGraphOf` 先调 `linkGraphOf` 拿全部 wiki 边（归档
   过滤、悬空剔除免费继承），再按边两端路径推导类型并归一化方向——person-project 统一
   `from=person`（wiki-link 无语义方向，任一方向均收）；person-person 按路径字典序定
   端去重；meeting/todo 端点的边整条丢弃。
3. **frontmatter areas 并入同图**：遍历活跃 project 读 frontmatter `areas: []`，经
   `resolveWikiLink(kbRoot, 'area:'+name)` 定位领域文件（歧义/解析失败/非字符串项丢
   弃，`areas` 非数组容忍），与 wiki 推导的 area-project 边按 `kind|from|to` 去重合并
   ——同一关系无论载体是 `[[领域]]` 还是 frontmatter 都只出现一条。
4. **自绘力模拟，零新依赖**：`graphLayout.ts` 纯函数模拟（成对斥力 + 边弹簧 + 弱中心
   引力 + 阻尼积分，alpha 衰减收敛），`GraphPane.tsx` 用 rAF 喂帧、SVG 渲染（viewBox
   1000×700 缩放适配）。节点形状区分类型（project=圆 / person=圆角矩形 / area=菱形），
   边色随关系种类，person-person 虚线；孤立节点弱化保留（沉默也是信息）；节点可拖拽
   钉死（拖后局部重热），短位移判点击打开实体。
5. **中栏第五常驻 tab**：沿 ADR-0047 提议 tab 的全套先例（tabs 常量、CenterPane 页签、
   Frame 装配、locales 键），无徽标。缩放/平移刻意不做（个人库一屏放得下，二期再议）。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | O(n²) 斥力在大库线性劣化 | 零依赖、纯函数可单测 | 节点数上几百时换 Barnes-Hut 或 quadtree |
| 2 | 每次进 tab 全量重算（无增量） | 实现极简，正确性直觉 | 图计算被实测卡顿时缓存 |
| 3 | 边类型由端点路径推导，不进 wire 之外的第二事实源 | `linkGraphOf` 单一事实源，无漂移 | 出现既非人也非领域/项目的新边语义 |
| 4 | 无缩放/平移 | 一屏全景，交互面最小 | 个人库大到看不清时 |

原因：

- **为什么新 RPC 而不是给 `graph()` 加类型**：校验预扫是 `graph()` 的既有消费者，
  它只需要连通性不需要语义；往同一形状里塞 `kind` 会让两边都背着对方的演进。两个
  消费意图，两个 RPC，各自窄。
- **为什么复用 `linkGraphOf` 而不是自己扫一遍实体**：wiki 边的解析、归档过滤、悬空
  剔除在 links.ts 已经服役并有测试，抄一份就是第二个会漂移的实现。areas 是 wiki 图
  真实的缺口（frontmatter 不产生 wiki-link），单独补这一支即可。
- **为什么自绘模拟而不是引 d3-force**：工作台至今零图依赖，个人库规模下五十行纯函数
  就够，还换来布局行为的单元可测性（模拟不含 React/DOM）。
- **为什么孤立节点保留**：图谱的用途之一是发现「这个人/领域还没挂到任何项目上」，
  把孤点藏起来等于藏掉了洞察。

后果：

- `packages/yantao/kb`：新增 `relations.ts`（`relationGraphOf`）与 9 例测试。
- `packages/api/yantao-kb-controller`：第 43 个 `@Remote` 方法 `relationGraph` +
  wire 类型；README 方法表同步；`gen-cordis-catalog` 类型归属豁免两行。
- `packages/client/ui-yantao`：`graph/graphLayout.ts`（纯函数模拟）、
  `frame/GraphPane.tsx`（渲染+交互）、第五常驻 tab 全套接线、`remote.ts` 的
  `loadRelationGraph` 缝。
- 项目笔记「构建关系图谱」待办勾销。

落地注记（2026-10-06 完工）：

- 三包测试全绿：kb 新 9 例（双向归一化/去重/字典序/areas union/歧义丢弃/非数组容忍/
  归档剔除/meeting-todo-悬空剔除/骨架库），controller 新 2 例（委派+空库），
  ui-yantao 619 例全绿（Frame 测试装配补 `relationGraph` stub）。
- 边类型在渲染侧由端点 id 推导（`edgeKindOf`），不经布局层的索引对齐——布局可能
  丢弃未知端点，索引会错位。
- alpha 常量（INITIAL_ALPHA/ALPHA_DECAY/ALPHA_FLOOR）属动画循环关切，放 GraphPane
  本地；graphLayout 只管单步数学。
- `pnpm vitest run packages/client/ui-yantao`、client bundle 重建通过。
