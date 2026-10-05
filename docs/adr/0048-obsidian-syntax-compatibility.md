---
status: accepted
---

# Obsidian 语法兼容承诺（阅读视图分期清偿）

出发点（2026-10-05 裁决，grill 多轮回合）：工作台的定位是 KB 与 Obsidian 打通——ADR-0017 已把
编辑器定为 Obsidian（KB root 即 vault），意味着创作面永远会用全量 Obsidian 语法写作，
yantao 阅读视图作为消费面欠的是**全量语法债务**。本轮盘点发现阅读视图当前的兼容现状是：
wikilink（ADR-0015）、数学、GFM 全集、任务列表、frontmatter 已支持；`[[页#节]]` 标题引用
整体匹配后解析失败显示字面量；脚注解析了但锚点 URL 过不了协议白名单、跳转半残；
`![[嵌入]]`、`#tag`、`==高亮==`、callout、`%%注释%%`、上下标、mermaid、本地图片全部不支持。

一个方法论教训必须先立此存照：**语料普查显示七类 Obsidian 语法零使用，不能据此论证
"不必支持"**——使用率是被供给侧压制的果（语法不被支持 → 使用者自我审查回避 → 统计上
显得没人用），不是无需求的因。循环论证。需求判断的依据是定位承诺（ADR-0017），不是
被压制的数据。

语料普查（KB root 999 个 md，2026-10-05）给出的只是**今日破损清单**：381 个文件
2554 处 `![](/core/api/resources/img/<hash>)` 死链（钉钉 alidocs 域名相对路径，离开
钉钉即死，dingtalk-docs 的 SKILL.md 自己写明"导出的 /core/api 相对地址离开钉钉域名
全是死链"）；42 张已本地化图片（`_assets/` 相对引用）同样渲染不出——`render.tsx`
的 `sanitizeUrl`/`remoteImageUrl` 对一切相对 URL 返回空串，**图片在阅读视图里是
0% 渲染**；mermaid 14 个文件不渲染（TODO v4 的"等知识库里真出现一个"条件事实上
已满足）。

事实基础（已核实）：渲染进程无 fs（`nodeIntegration:false` + preload 只暴露通知通道，
apps/yantao-desktop/src/main.ts:288-335）；服务端无 HTTP 静态路由（controller 全是
`@Remote` RPC）；ADR-0046 已验证 base64-over-RPC + 客户端 Blob URL 链路
（`readResourceView` index.ts:688-703 ↔ `ReadOnlyFile.tsx:106-172`）；`ui-primitives`
的 markdown 渲染器 DOM 有 byte-for-byte 夹具钉着，`sanitizeUrl` 的协议白名单是
有意为之的安全政策（render.tsx:7-12 注释）。

决定：

1. **兼容承诺正式化**：阅读视图以 Obsidian 语法为兼容目标，按下表矩阵分期清偿，
   推翻 TODO v4"等知识库里真出现一个再开工"的等待策略（压制效应下"出现"永远滞后）。
   分期依据是"基础设施依赖 + 性价比"，不是当前使用率：

   | 期 | 内容 | 依据 |
   |---|---|---|
   | 一 | 本地图片通路 + 脚注锚点 + mermaid 懒加载 | 已发生的破损，量最大 |
   | 二 | callout + `==高亮==` + `#tag`（标签点击筛选可后置） | 便宜、解除自我审查收益最大 |
   | 三 | `![[嵌入]]`（复用一期资源通路）+ `[[页#节]]` 标题引用 | 依赖一期基建 |
   | 四 | 上下标 `^x^`/`~x~`、`%%注释%%` | 冷门兜底，凑齐矩阵 |

2. **实施层混合原则**：能预处理则预处理（沿用 ADR-0015 wiki 链接在 `markdown.ts`
   改写的先例），必须动渲染器才下沉 `ui-primitives`（如高亮节点、mermaid 拦截）；
   **`sanitizeUrl` 协议白名单一字不动**——上游政策文件与 byte-for-byte 夹具不碰，
   图片供数走数据通道而不是放宽 URL 政策。
3. **一期图片通路 = ADR-0046 同构复用**：`YantaoKbController` 新增 `@Remote` 二进制
   读取方法（复用 `confine` 围栏 + `readResource`，返回 `{ base64, mime }`）；客户端
   按既有套路 `atob → Blob → URL.createObjectURL`；`ui-yantao` 预处理层把 md 里的
   本地相对图片路径改写为预取的 Blob URL。零新 HTTP 面、零 sanitizer 改动、信任边界
   与合并面不动。Blob URL 在 tab 切换/关闭时 revoke（同 ADR-0046 纪律）。
4. **mermaid 懒加载**：mermaid 打成独立 chunk（动态 import，仅文档真含 mermaid 块时
   才拉取），化解"单文件 CJS 内联 ~3.5MB"的当年推迟理由；渲染走 ADR-0046 的
   sandbox iframe 架构（opaque origin，特权为零）。
5. **脚注锚点纳入一期**：`sanitizeUrl` 白名单增加内部锚点（`#…` fragment）放行，
   脚注引用与回引从纯文本恢复为页内跳转——这是兼容承诺下唯一一处动白名单的地方，
   fragment URL 无协议面，安全上无害。
6. **数据面配套（非代码）**：2554 个钉钉死链的修复在导出管线——重跑 dingtalk-docs
   导出补附件下载（`download_doc_attachment` 落 `_assets/` 并改写相对引用，能力既有
   功能），渲染通路就绪后重导即自动受益。
7. **明确不做**：Obsidian 编辑能力（ADR-0017"先借 Obsidian"不变，阅读视图不做
   所见即所得）；`.obsidian/` 目录的读写（ADR-0017 禁令不变）；Obsidian 插件生态
   的私有语法；全量兼容矩阵之外的语法变体（出现再议，但按决定 1 不得以"语料
   没出现"为由拒绝）。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 图片 base64 整文件过 RPC | 零新增 HTTP/协议面（同 ADR-0046 台账 #3） | 平均图片体积大到 RPC 序列化成为瓶颈 |
| 2 | mermaid 独立 chunk 首次遇到块时有加载延迟 | 单文件 CJS 客户端包不膨胀 3.5MB | 首帧延迟被抱怨时预取 |
| 3 | 兼容承诺是持续债务：冷门语法（上下标、注释）也得给交代 | 使用者在 Obsidian 里放心用全量语法，正循环 | 无——这是承诺的本义 |
| 4 | 预处理改写让"源码 → 渲染"之间多一层映射 | sanitizer/夹具/上游合并面零改动 | 映射 bug 难排查时考虑下沉渲染器 |
| 5 | 2554 个死链在重导前依旧死着 | 先通瓶颈工序，不空转 | 无——数据面随时可跑 |

原因：

- **为什么正式承诺而不是按需修补**：语料统计只能暴露现状破损，不能否决潜在需求
  （压制效应，见出发点）；且 ADR-0017 已把编辑外包给 Obsidian，兼容是定位的应有
  之义而非新功能。正式矩阵让"要不要支持 X"从此有章可循。
- **为什么不放宽 sanitizer 让相对 URL 直接进 `<img src>`**：白名单是渲染器头注里
  明文记载的安全政策，byte-for-byte 夹具钉着 DOM；且渲染进程无 fs、宿主无静态路由，
  放宽了 URL 也取不到数——数据通道无论如何都得建，那就让 URL 政策保持纯粹，
  改写在预处理层完成。
- **为什么复用 ADR-0046 链路而不是新发明**：base64-over-RPC + Blob URL 已在 PDF 上
  服役并验证（含"不走新 HTTP 端点"的同等推理，ADR-0046 决定 4），信任边界、
  合并面、攻击面分析全部现成。
- **为什么 mermaid 用独立 chunk 而不是继续等**：TODO v4 的等待条件已被 14 个真实
  文件满足，继续等等于承认 TODO 形同虚设；懒加载已化解当年推迟的唯一理由（体积）。

后果：

- `packages/api/yantao-kb-controller`：新增二进制资源读取 RPC（`{ base64, mime }`，
  `confine` 围栏不变）；`packages/api/remotes/lib/client.js` 重建。
- `packages/client/ui-yantao`：`markdown.ts` 预处理增本地图片路径改写；`MarkdownView`
  装配图片预取与 Blob URL 生命周期；脚注锚点放行后页内跳转生效。
- `packages/client/ui-primitives`（仅 mermaid/高亮等下沉项，逐特性评估）：mermaid
  块拦截 + 独立 chunk；`sanitizeUrl` 仅按决定 5 增加 fragment 放行。
- 数据面：重跑 dingtalk-docs 导出（运营动作，记 development.md）。
- TODO.md：「阅读视图 v4」条目由本 ADR 分期取代。
- 测试：图片通路 RPC/预处理改写/Blob 生命周期、脚注跳转、mermaid 懒加载与 sandbox，
  随施工补齐。

落地注记（一期，2026-10-05 完工）：

- **图片供数从"预处理改写"变为"owner 钩子"**：原计划在 `markdown.ts` 把相对路径
  改写成预取的 Blob URL——实施时发现 `blob:` 协议不在 `sanitizeUrl` 白名单内，
  而决定 2 承诺白名单一字不动。改为 fileMentions 同构的 `imageSources` 钩子
  （`MarkdownRenderContext` 新增可选成员，settled-only，流式传 undefined）：
  渲染器在 http(s) 门拒绝后咨询钩子，`ui-yantao` 以 `resolve(url) → Blob URL`
  应答。sanitizer、夹具、URL 政策三者原样，与决定 2 的精神一致。
- **Blob 生命周期从"逐 tab revoke"变为"模块级共享缓存"**：缓存挂在
  `MarkdownView.tsx` 模块作用域（KB 路径 → object URL，FIFO 上限 128，淘汰即
  revoke），tab 重开不重取、跨 tab 共享；另设失败集合避免坏引用反复打 RPC。
  逐 tab revoke 的原始设想会让同文件双开互相吊销 URL。
- **mermaid 下沉形态**：`ui-primitives` 只加了一个通用 `diagrams` 钩子（语言 →
  组件的映射，settled-only），mermaid 依赖与渲染组件（`MermaidView.tsx`）都在
  `ui-yantao`——渲染器不携带任何 mermaid 词汇。懒加载实测：主包 client.js
  约 0.65 MB，mermaid 核心 chunk 约 1.2 MB 另带按图型的子 chunk，仅文档真含
  ```mermaid 块时动态 import。sandbox 用 `allow-scripts allow-popups
  allow-forms`（opaque origin 特权为零，同 ADR-0046 决定 3）：allow-scripts
  换来了 iframe 内测量脚本的高度回报（postMessage 校验来源 + 类型 + 数值后
  夹在 60–4000px）。
- **脚注锚点**：`sanitizeUrl` 增加 fragment 放行（决定 5 的唯一白名单改动），
  引用/回引恢复页内跳转，byte-for-byte 夹具按预期再生并人工复核。
- **controller RPC**：`readResourceBinary`（扩展名门控 png/jpe?g/gif/webp/bmp/
  svg/avif/ico + `confine` 围栏），`packages/api/remotes/lib/client.js` 已重建。
- **已知遗留**：`readResourceBinary` 目前不限 `resources/` 平面而是
  全 KB 围栏（图片可能躺在实体目录旁的 `_assets/`），与 confine 边界一致故
  不算放宽。~~mermaid 主题暂固定 default~~（已清偿，见落地注记二）。
- 测试：夹具再生 2 份、`markdown.client.spec` 新 13 例（引用收集/路径规格化）、
  `mermaid-view.client.spec` 新 4 例（懒加载/沙箱/错误回退/高度协商）、
  `markdown-view.client.spec` 新 2 例（图片装配/无 path 不取数）、
  `markdown-render-units` 新 4 例（diagrams 钩子分流）。三包 vitest 全绿
  （1457 例）、tsc 窄构建干净、oxlint 0 警告、ui-yantao bundle 重建完成。
- 数据面重跑 dingtalk-docs 导出仍未执行（运营动作，另行安排）。

落地注记二（mermaid 主题适配，2026-10-05 补）：`MermaidBlock` 以 theme-presenter
写下的 `body[data-ds-dark-theme]`（`DARK_ATTRIBUTE`，同包常量）为明暗信号，
MutationObserver 监听属性翻转；`loadMermaid(dark)` 每次 render 前
`initialize({ theme: dark ? 'dark' : 'default' })`（幂等且廉价，模块级只缓存
import 本身），渲染 effect 依赖 `(code, dark)`——切换主题时全体挂载中的图重渲，
旧 SVG 保持上屏直到新图就绪（不闪回源码）。未做的部分：不定制 `themeVariables`
对齐工作台色板——mermaid 'dark' 默认色板与 `--yt-*` 家族并非一一对应，逐色映射
属过度打磨，观感抱怨出现再议。测试 +2 例（明亮钉 default / 翻转重渲重钉）。
