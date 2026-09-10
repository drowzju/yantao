---
status: accepted
---

# 桌面外壳：Electron，宿主子进程

> **修订（2026-09-10）**：第 2、3、7 条原为「宿主在 Electron 主进程内启动」，已改为子进程。
> 理由见「为什么从同进程改为子进程」。其余各条不变。

决定：

1. **yantao 增加一个 Electron 桌面外壳**，但**不替代**现有 web 形态——两者并存一段时间（见第 8 条）。
   外壳只负责"把应用变成一个有自己窗口和托盘的东西"，**不复制也不改写前端**：
   它加载的就是同一个 workbench 页面，前端仍然只有一份。
2. **宿主作为子进程运行在系统 Node 上**，不在 Electron 主进程里。外壳
   `spawn` 一份 `node --import tsx/esm --expose-internals apps/cli/src/bin.ts
   --profile yantao-web --port 0 --no-open`，从它的 stdout 等到
   `dsh web: http://…` 那一行，再让窗口加载它。
3. **保留 loopback HTTP 服务**，不改成 `file://` + IPC。子进程用 `--port 0`
   让系统分配端口，外壳因此不必记住任何端口号，两份 workbench 也不会撞端口。
4. **不用 `file://`**：`api-request-trust.ts` 的信任围栏要求 `Origin` 与 `Host` 一致，
   而 `file://` 页面发出的是 `Origin: null`，会被拒。上游文档设想的
   "Electron 用 `file://` + IPC 桥"（`docs/subsystems/web-server.md`）要求自己伪造 Host 头，
   等于重写 `client-connection` 的传输层——不值。
5. **托盘常驻**：关闭窗口 = 最小化到托盘，托盘菜单是「打开」「重启宿主」「退出」。
   **不做全局热键**（暂缓），不做开机自启。
5b. **窗口先弹出来**，显示「正在启动 yantao 工作台…」，再等宿主就绪后加载真实页面。
   启动本身慢（实测约 26 秒），空白桌面会被当成崩溃。
6. **分发范围就是这一台机器**：不签名、不自动更新、不做安装包。日常用源码跑
   （`electron .`），不出构建产物。
7. **外壳退出时收干净宿主子进程**（`before-quit` 里 kill）。dsh 装在子进程里的
   `unhandledRejection` / SIGINT 监听随子进程一起消失，主进程不再需要接管任何东西——
   同进程方案里的那一整套移除逻辑因此被删掉了。
8. **web 壳的退出条件是双条件，两者同时满足才砍**：① 连续 14 天没有手动打开过浏览器；
   ② 桌面版通过下面这份验收表。验收表就写在本 ADR 里，动工前定死。

原因：

- **为什么桌面版买得值**：要买的只有三样——独占窗口与独立任务栏图标（不再混在几十个浏览器标签里）、
  托盘常驻、以及"双击图标就用"的启动方式（不再跑 ps1、记端口）。这三样 RPC 补不了。
- **为什么明确不买"更方便操作本地文件"**：文件操作的执行者一直是宿主（Node），从来不是浏览器。
  KB 根目录选择早就走的是原生 Win32 对话框（`packages/host/directory-picker-native`），
  agent 写文件走 `kb_*` 工具。桌面形态在文件能力上**增益接近零**——真正缺的是 UI 上的按钮和
  watcher，那是 ADR-0017 的事。把这个当成桌面版的理由会买错东西。
- **为什么 Obsidian 那套体验不要求桌面形态**：Obsidian 自己就是 Electron =
  Chromium 渲染 + Node 主进程做文件系统，和 yantao 今天是同构的。
  双链、所见即所得、本地图片全是渲染进程的工作加几个 RPC（见 ADR-0015、ADR-0017）。
- **为什么同进程**：省掉一套父子进程的生命周期与端口协商。代价是 dsh 与 Electron 争 `process`，
  所以第 7 条是硬要求，不是优化。
- **为什么保留 loopback 而不是"彻底无服务"**：Q1(d) 想要的"不起 HTTP 服务"在自用单机前提下
  收益接近于零（127.0.0.1 随机端口 + 进程内 token 已经没有暴露面），而它的代价是重写
  `client-connection`（它 `inject = ['webServer','credentials']`，没有 webServer 根本起不来）
  外加自己造 `window.__DSH_BOOT__` 注入与插件 script 标签加载。这正是 ADR-0009 经验教训 ②
  警告的区域。
- **为什么先并存再砍**：ADR-0009 经验教训 ④——这套 shell 是逐行调通、很脆的。砍掉它等于丢掉唯一
  能跑的基线，必须先在桌面版上独立复现全部行为。

后果：

- 新增 `apps/yantao-desktop`（我们的包，不动上游）。上游**零改动**。
- `runProfile()` 取自 `apps/cli/src/profile-boot.ts`（深引用源码，不要 import `bin.ts`——
  它在模块顶层就执行 argv 派发）。`apps/cli/package.json` 没有 `exports` 字段。
- 主进程 boot 后必须处理两个坑：
  - `packages/boot/app-boot/src/index.ts:680` 注册了全局 `unhandledRejection`，处理函数结尾
    `proc.exit(1)`。**任何一处未捕获的 rejection 都会把整个应用带走。**
  - `apps/cli/src/profile-boot.ts:237-238` 注册了 SIGINT/SIGTERM 且从不移除，
    `interrupt()` 最终 `process.exit()`。
- 打包态跑不了 tsx：目前是源码态运行（main 入口顶部 register tsx，走 `tsx/esm/api`
  编程式注册——`tsx/esm` 是 CLI 的 flag 入口，注册会报 "must be loaded with --import"）。
  真要出 exe 时，宿主必须先出 JS 产物——**这是已知未做项**，自用阶段不阻塞。
- Electron 依赖体积约 100MB+，只在开发机安装。

### 为什么从同进程改为子进程（动工后实测）

同进程**能跑通**（验证过：窗口 `yantao 工作台`、日志 `workbench ready`），但暴露了三笔代价，
第一笔是决定性的：

1. **一个 `.node` 文件服务不了两个 Node（决定性）。** 同进程意味着 `session-persistence-jsonl`
   的 `fs-ext` 要按 Electron 的 Node ABI 编译。实测：系统 Node 24.11.0 是 ABI 137，而
   Electron 36/37/38/39 分别是 135/136/139/140——**137 是空档，不存在 ABI 对齐的版本可绕开**。
   更糟的是副作用：重编成 Electron 版之后，**CLI 立刻起不来**（报 `requires
   NODE_MODULE_VERSION 137`），而 `pnpm dsh --profile yantao "…"` 是 AGENTS.md 里的日常命令。
   也就是说同进程方案下 **CLI 与桌面版互斥**，每次切换都要重编原生模块。
2. **重建所需的两个文件这台机器拿不到。** 内网镜像只同步 Electron 的可运行产物
   （`electron-v*-win32-x64.zip`，130 MB / 18 秒），**没有 headers 也没有 `node.lib`**；
   外网（electronjs.org / npmmirror / nodejs.org）全部不可达，最后靠人肉带回。
   - `electron-rebuild` 即使缓存就位仍联网（ECONNRESET），得改用 node-gyp 显式给 `--nodedir`。
   - `node.lib` 要放在 `<node-gyp 缓存>/<版本>/Release/`，不是 `x64/` 也不是 `win-x64/`。
   - 镜像真实路径是 `electron/39.8.10/`（**无 `v` 前缀**），写成 `v39.8.10/` 是 404。
3. **同进程会丢掉热重载。** `yantao-web` 是 `patchReload: 'live'`，需要 host 侧 HMR，
   而 HMR 要求 Node 的 `--expose-internals`——Electron 不转发 node flag（实测
   `electron --expose-internals .` 无效）。同进程只能把 HMR 关掉；**子进程能传这个 flag**，
   实测 `node --import tsx/esm --expose-internals apps/cli/src/bin.ts --profile yantao-web`
   正常启动且 stderr 干净，**HMR 拿回来了**。

**子进程不是性能方案**：实测 CLI 22.6 s、同进程壳 22.2 s、子进程壳 26.1 s——
慢的是 dsh 的 profile boot，与进程模型基本无关。真正的改善是**感知**：窗口从 22.2 s
变成 **3.2 s** 就出现（先显示「启动中」），这是第 5b 条的作用。

**已撤销**：曾经为绕开 HMR 而在 `packages/boot/app-boot/src/profile.ts` 加的
`yantao-desktop` 模板（同样的 bundles、`patchReload: 'startup'`）已删除——子进程能直接用
`yantao-web`，merge surface 收回原状。

**代价**：多一份常驻内存（约 200–300 MB）、外壳要 spawn 并回收子进程、URL 要从 stdout 抓。
**收益**：CLI 与桌面版同时可用、HMR 回来、宿主崩溃不再带走窗口、升级 Electron 无感、
外壳可以只重启宿主而不关窗口（托盘「重启宿主」）。
- 本 ADR **修订 ADR-0001 留下的一条术语规则**：`packages/yantao/CONTEXT.md` 里
  `_Avoid_: 桌面应用（Flutter 时代已终结）` 改为"避免自维护 agent 基建"口径——
  ADR-0001 当年放弃 Flutter 的真实理由是"避免自维护 agent 基建"，不是"桌面形态错了"，
  "桌面应用"是被误伤的词。

## 验收表（砍 web 壳之前必须全部勾选）

- [x] 冷启动：一个图标点开，无需跑脚本、无需记端口、无需手动开浏览器
      （已验证：窗口 3.2 s 出现，`yantao: workbench ready`，端口由系统分配）
- [x] 托盘：关闭窗口最小化到托盘，菜单可打开/退出（已构建，尚未人工点击验证）
- [x] **CLI 与桌面版同时可用**（子进程方案的验收点：两者不再互斥）
- [x] **宿主热重载可用**（用 `yantao-web` 的 `patchReload: 'live'`，`--expose-internals` 传给子进程）
- [ ] ADR-0011：三栏框架（intake / workspace / 中列）齐全，拖拽与收起对称
- [ ] ADR-0012：文件 tab（含永久对话 tab）从 localStorage 恢复、raw 编辑自动保存与冲突检查、
      内联新建、待办清单、首启目录选择
- [ ] ADR-0013：中列工作目录跟随 KB root、`@` 提及解析
- [ ] ADR-0014：文件默认打开阅读视图、YAML 折叠、阅读/源码切换
- [ ] ADR-0015：`[[…]]` 渲染成可点链接、反向链接面板可用
- [ ] ADR-0017：能在 Obsidian 中打开当前文件、外部改动能自动刷新
- [ ] 连续 14 天未手动打开浏览器

未做（明确列入，避免被当成遗漏）：全局热键、开机自启、代码签名、自动更新、安装包、
`file://` + IPC 传输、多窗口。
