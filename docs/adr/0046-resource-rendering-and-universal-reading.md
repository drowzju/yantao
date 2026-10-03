---
status: accepted
---

# 资源渲染视图与读取面人人平等（`.html`/`.pdf`/`.eml` 的双通道打通）

resources/ 里躺着两类一直在等人看的内容：ADR-0037 归档的 `.eml` 邮件原件（正文本体是
HTML），以及经 ADR-0020 拖拽/登记进来的 PDF。今天双击它们的结局是同一个：工作台
`ReadOnlyFile` 裸吐文本（PDF 直接被 controller `read` 的 NUL 检查拒之门外），agent 这边
`kb_read_resource` 对一切含 NUL 字节的文件硬拒（ADR-0028）。人看不懂、agent 读不了——
而这两类格式恰恰都是**可以被程序忠实转译**的：HTML 本来就是文本，PDF 有成熟的文本
抽取，eml 有确定的 MIME 解析。

本 ADR 同时确立一条读取面原则：**凡人类通道能读的内容，agent 也一律应能读；读取面
不做硬限制**。信任锚放在"内容是被人收编进库的"这个一次性动作上（ADR-0020 登记、
ADR-0037 归档），而不是在每个读取点上设卡。ADR-0028 取舍台账第 1 行预留的重开条件
（"出现真实的读 pdf 需求时走能力脚本抽取"）在此兑现——但路线换成更彻底的内核内
提取，理由见"原因"。

事实基础（已核实）：controller `read`（yantao-kb-controller/src/index.ts:642）对 NUL
文件拒绝并提示"创建读书项目"——那条路已随 ADR-0020 退役，提示是死的；`readResource`
（packages/yantao/kb/src/core.ts:599）与提及管线 `readTextFile`（cited.ts:18）共用同一
NUL 判据；Electron 39.8.10 内建 PDF viewer（PDFium）默认启用，`<iframe src=blob:…>`
即可渲染 PDF；工作台经宿主 loopback HTTP 加载，`contextIsolation:true`。

决定：

1. **内核转译模块 `resource-content.ts`**（packages/yantao/kb）。两个纯异步函数：
   `extractPdfText(bytes)`（pdfjs-dist legacy 构建，逐页 `getTextContent`，页间空行连接）
   与 `parseEml(bytes)`（mailparser `simpleParser`：主题/发件人/收件人/日期/HTML 正文/
   纯文本正文/附件清单）。转译失败向上抛 `KbError`，由调用方决定降级形态。
2. **agent 读取面：`kb_read_resource` 对 `.pdf`/`.eml` 自动转译**。扩展名分发先于
   NUL 检查：`.pdf` 返回抽取文本，`.eml` 返回头部摘要 + 纯文本正文（mailparser 在
   只有 HTML 正文时会派生文本）；两者失败时回落到原有的二进制拒绝报错（带上"转译
   失败"注记）。其余二进制一字不改。提及管线（`cited.ts`）走同一分发——`@` 一个
   pdf 目录时，抽取文本计入既有的 96k 预算与 32k 截断，不发明新预算。
3. **人类渲染面：controller 新增 `readResourceView(path)`**，返回判别联合
   `KbResourceView`：`text`（其余一切，含 NUL 拒绝语义不变）/ `html`（原文文本）/
   `pdf`（base64 + size）/ `eml`（解析后的结构化字段 + 附件**清单**——名字、类型、
   大小，不含内容）。客户端以 `Blob` + `URL.createObjectURL` 自造 URL：
   - `.pdf` → `application/pdf` Blob → 无沙箱 iframe（PDFium 接管，零依赖）；
   - `.html` → `text/html` Blob → `sandbox="allow-scripts allow-popups allow-forms"`
     的 iframe（无 `allow-same-origin`，opaque origin——脚本可跑，特权为零）；
   - `.eml` → 头部块 + 正文（HTML 走同款沙箱 iframe，纯文本走 `<pre>`）+ 附件行。
   Blob URL 在 tab 切换/关闭时 revoke。
4. **传输不走新 HTTP 端点**。设计讨论中曾设想"宿主 HTTP 二进制端点"，实现时发现
   它要么长在上游宿主服务器（扩大合并面，硬规则 1 要求 ADR 且倾向不做），要么在
   Electron 主进程加自定义协议（浏览器形态的工作台享受不到）。RPC 返回 base64 +
   客户端 Blob 的组合以零新增攻击面（无未鉴权的本地端点）达到同样的渲染效果，且
   浏览器形态同样可用。设计意图（iframe + 内建 PDFium + 零新前端依赖）原样保留。
5. **明确不做**：agent 写二进制（写侧维持 ADR-0020/0026 现状）；外部 URL 渲染；
   正文 readability 抽取；epub/docx 等其他格式（无提取器者仍按 ADR-0028 拒绝）；
   附件内容的渲染/导出（清单先行，需求出现再议）。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | PDF 抽取文本无版面（表格扁平、公式丢失） | 零新基建的 agent 可读性 | agent 需要版面信息时走视觉模型路线 |
| 2 | eml 附件只报清单不给内容 | RPC 载荷可控（一个大附件不撑爆会话） | 出现"看附件"的真实需求 |
| 3 | pdf base64 整文件过 RPC | 不新增 HTTP/协议面 | 平均资源体积大到 RPC 序列化成为瓶颈 |
| 4 | `.eml`/`.pdf` 转译失败回落"二进制拒绝"报错 | 失败可见，不静默注入半截内容 | 无——这是特性不是缺陷 |

原因：

- **为什么内核内提取而不是 ADR-0028/0029 预留的能力脚本**：能力路线给 agent 加了
  一个动作（先查目录再调用），且把"读自己库里的文件"变成一件需要外部 Python 环境
  的事。读取面人人平等原则下，`kb_read_resource` 是双方共用的唯一读取口，转译收在
  读取口内部，双方零额外动作。ADR-0020 的抽取当年退役是读书项目的产品级裁剪，
  抽取本身未被判定失败；本次以更小的面（只 pdf/eml、只读、无缓存无分页）重做。
- **为什么 HTML 不清洗而用 sandbox iframe**：opaque origin 已把最坏情况（脚本逃逸、
  同源特权）压住，成本是一个 iframe 属性；清洗反而制造"看起来对但其实缺了东西"的
  第三种真相。外链请求不设限：追踪像素的隐私代价小于剪藏页大面积裂图的可用性代价。
- **为什么 PDF 不引 PDF.js 进前端**：客户端 bundle 是单文件 CJS，大依赖内联代价高
  （TODO 阅读视图 v4 注记）；Electron 39 内建 PDFium 免费、可靠、自带缩放/搜索。

后果：

- `packages/yantao/kb`：新增 `src/resource-content.ts` 与依赖 `pdfjs-dist`、
  `mailparser`（均为宿主侧，不进客户端 bundle）；`core.ts readResource` 与
  `cited.ts readTextFile` 接入扩展名分发；`kb_read_resource` 工具描述同步。
- `packages/api/yantao-kb-controller`：types.ts 增 `KbResourceView`/`KbEmlAttachment`；
  index.ts 增 `readResourceView`。
- `packages/client/ui-yantao`：`ReadOnlyFile.tsx` 按视图种类分流渲染；Frame 装配
  `readView`；locales 增键。零新增前端依赖。
- ADR-0028 取舍台账第 1 行标记已被本 ADR 取代；AGENTS.md 硬规则 2 的
  `kb_read_resource` 从句补"pdf/eml 自动转译"。
- `packages/api/remotes/lib/client.js` 需重建（新 Remote 方法进客户端代理）。
