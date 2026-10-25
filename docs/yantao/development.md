# 开发指南

如何构建、运行、测试与扩展工作台,以及已经让我们付出过时间代价的那些坑。

## 环境

| 需求 | 值 |
|---|---|
| Node / pnpm | Node 24、pnpm 11(仓库要求) |
| npm registry | 内网镜像,已写入 `.npmrc`(`registry`、`disturl`) |
| 原生重建(如 `fs-ext`) | 生命周期脚本需要显式指定头文件镜像:<br>`npm_config_disturl=https://mirrors.dahuatech.com/nodejs-release/ pnpm install` |
| 模型密钥 | `.env`(复制 `.env.example`)或凭据存储;`apiKeyEnv` 只是引用名,绝不内联密钥 |
| 端口 | 桌面壳用 `--port 0` 由系统分配;手动前台跑宿主用 **8080**。本机 8081/8082 会被拒绝(`EACCES`,Windows 保留区段)。 |

## 构建 —— 只构建你动过的部分

| 改动位置 | 执行 |
|---|---|
| 前端 `apps/yantao/src/**` | `pnpm --filter @deepseek-ai/dsh-yantao-frontend run build` |
| 客户端插件 `packages/client/ui-yantao/src/**` | `pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle` |
| kb 插件 / 控制器 / 任意 host 包 | `npm run build:lib:host`(较慢,数分钟) |
| `packages/client/**` 下任意内容 | `npm run build:lib:client` |
| 迭代客户端插件时热更新 | 服务运行的同时开 `pnpm run dev:web` |
| 改动后的类型检查(vitest 不查型!) | `./node_modules/typescript/bin/tsc -b <包目录>`(窄构建;必须在**大写** `D:/code/yantao` 下启动,见坑 12) |
| 改 Remote 方法后重生成 typert 产物 | 先窄 tsc,再在仓库根跑 `npx tsdown --env.DSH_BUILD_FACE host -F "@deepseek-ai/dsh-<完整 scoped 包名>"`(`-F` 匹配完整包名,不能 cd 进包目录跑) |
| 改控制器 Remote 面(UI 报 `kb.xxx is not a function` 时) | 在 `packages/api/remotes/` 包目录内跑 `npx tsdown --env.DSH_BUILD_FACE client`,重建聚合产物 `remotes/lib/client.js` |

**⚠️ `pnpm run yantao:refresh` 目前不可用(2026-09-29 时点):** 它的全量 `tsc -b tsconfig.client.json` 会被上游包(ui-settings-models/ui-settings/ui-workspace/experimental)测试文件的陈年类型错误绊住,与 yantao 无关。一律改走上表的窄构建组合:`npm run build:lib:host` → 窄 tsc → 各包自己的 `bundle`/`build`。

**桌面端不热加载产物**:Electron 进程启动时就把插件 bundle 读进内存,之后改代码、重建都不会反映到已开的窗口——
症状是「我明明改了,点了没反应」。重建完成后必须重启工作台(托盘退出再 `start`)才生效。
`dev:web` 的热更新只覆盖浏览器入口,救不了桌面壳。

## 启动与停止

```bash
pnpm --filter @deepseek-ai/dsh-yantao-desktop start   # Electron window + tray; spawns the host child process (ADR-0016)
pnpm dsh --profile yantao-web --port 8080             # foreground host only (what the shell spawns); Ctrl+C stops it
```

冒烟测试:

```bash
pnpm dsh --profile yantao "用一句话回答：1+1等于几？"     # headless: model gateway + kb tools
# workbench: open the printed URL; the probe line shows `tree() ok: …`
```

## 出包

两条路,目的不同。

### 日常开发

```powershell
powershell -File scripts\dev-yantao.ps1            # 按新鲜度重建 + 启动
powershell -File scripts\dev-yantao.ps1 -NoStart   # 只重建(发布打包也走这一条)
```

- 宿主跑**仓库源码**(tsx 直跑),跨包引用吃各包 `lib/` 产物——改了 A 就要重建 A,脚本按
  `src` 与 `lib` 的新鲜度判断,不重建没动过的包。
- 重建 client bundle / 前端 dist 会热替换到正在跑的窗口上;白屏时按 Ctrl+Shift+R 或托盘
  「重新加载页面」。
- 启动前会检查有没有工作台进程在跑(共享 KB/调度名册/钉钉 Stream,双实例互抢)。

### 发布出包(给别人,不带源码)

```bash
node scripts/pack-release.mjs --reuse-runtime --strip-links --with-shell --zip
# 产出 .package-build/release/yantao-workbench-<version>-win-x64.zip
```

- 脚本第一步调 `dev-yantao.ps1 -NoStart` 重建过期产物——构建逻辑只有一份,发布包不会带上
  比 `src/` 还旧的 `lib/`。`--skip-rebuild` 可以跳过(只在你确认产物是新的时用)。
- 出包前先从托盘退出工作台:重建 `lib/` 和 electron-builder 都会撞上文件锁。
- runtime 只含构建产物(`lib/`、`dist/`),没有 `src/`、没有 tsx;宿主用普通 node 跑
  `apps/cli/lib/bin.js`。
- 依赖按可达性裁剪:从 profile 的插件表加 CLI 出发,沿 `dependencies/optionalDependencies/
  peerDependencies` 求闭包,闭包外的包整包删除;source map 与 `.d.ts` 也一并剔除。当前
  runtime 0.50GB、zip 0.85GB——其中 Electron 壳约 0.33GB 是下限,换壳才能去掉。
- 归档里**没有任何链接**:8835 个 junction 以 `link-manifest.json` 记录,壳首启按当前路径重建。
- 私有 home `%APPDATA%\yantao-workbench\dsh-home`:首启自动从模板建 `yantao-web` profile,
  KB 根走 onboarding,模型 key 由使用者自己填。
- 目标机器需要 Node 20+;壳启动时检查,缺了会显示安装页而不是白窗。
- 首次全量物化约 10 分钟(整仓复制 + 断链门禁 + 冒烟);之后 `--reuse-runtime` 是秒级。
- **同一时刻只开一个实例**:两个实例共享 KB 时会双触发调度、抢钉钉消息。

## 离线双机同步(A 外网 ↔ B 内网)

用 git bundle 走 U 盘/共享目录,进度记账在标签 `pair/base`(双方都已持有的最后一个提交)上:

```powershell
# A 机出货(增量,通常几 MB);首次或给新机器播种用 -Full(全量约 190MB)
powershell -File scripts\sync-out.ps1 [-Out 路径] [-Full]
# B 机收货:校验 → 合并进 main → 回写 pair/base;有冲突时解决后重跑一遍即收尾
powershell -File scripts\sync-in.ps1 -Bundle <bundle 路径>
# 反方向同理:B 机 sync-out,A 机 sync-in
```

注意:bundle 只装已提交内容,`.env`/`lib/`/`temp/` 永不过境,两侧各自构建;B 无法直连 GitHub,
上游 `master` 的升级也由 bundle 的 `--branches --tags` 一并捎带。

测试:`pnpm vitest run packages/yantao/kb packages/api/yantao-kb-controller packages/client/ui-yantao`

## 门禁

- 预提交(lefthook):lint、空白、vendor 清单、第三方声明、双语配对。
- 提 PR 前值得单独跑:`pnpm run constraints`、`pnpm run verify-tsconfig-paths`、`pnpm run verify-package-readme-*`、
  `pnpm run verify-translation-pairing`。
- 新增包或 Remote 后:重跑生成器(`pnpm run gen-tsconfig-paths`、文档/目录生成器),否则 verify 脚本会要求重新生成。

## 坑(每一条都真实耗过一轮调试)

1. **前端构建必须桩掉 `process.env`。** `apps/yantao/vite.config.ts` 必须像上游 `apps/web` 一样展开
   `clientBuildEnvironmentDefines(process.env)`——它会把 `process.env` 定义为 `{}`。缺了它,产物在启动期抛错,页面**全白**。
2. **`slots` 是基础设施,不是 UI。** `dsh-client-ui-slots` 提供的服务被 theme、locale、Cordis 客户端 runner、session-log
   export、目录选择器共同依赖;禁用它会让启动失败并报 "entries did not activate"。
3. **读了什么就要声明什么。** Cordis 会抛 `cannot get property X without inject`。Remote 命名空间同样各自计数:
   `inject = ['remote', 'remote.yantaoKb']`。
4. **`!!js process.env.X ?? '默认值'` 的兜底不可靠。** 变量未设置时表达式不会取到字面量,请求会打到错误端点(症状:`404`)。
   部署值写成字面量,需要覆盖时走用户层。
5. **客户端插件入口是 `src/client/index.ts`**(不是 `.tsx`),且包需要一个空的 host 入口 `src/index.ts`。
6. **yantao 自有文档是中文单语(ADR-0027)**:直接用中文写 `README.md` 与 docs,不要 `.zh.md` twin、不要 `.i18n.yaml`、
   不需要重录配对;双语配对门仍全量管辖上游文档,改了上游文件才需要 `--write` 重录。
7. **模型 id 拼写。** 网关接受 `GLM5.1`、`GLM`、`glm52` 三种,我们都已声明,选哪个都能工作;新增模型要连拼写一起加。
8. **别用 `taskkill //IM node.exe` 清进程** —— 会连你的 agent 运行时一起杀掉。桌面壳用托盘「退出」/「重启宿主」;残留的前台宿主用 Ctrl+C 或按 PID 结束。
9. **构建残留**:`tsc -b` 会在 `packages/client/*/src` 内留下 `.js`/`.d.ts`/`.map`(未跟踪,不需要)。清理前先问;
   `git clean -n packages/client/<pkg>/src` 可预览。
10. **构建版 CLI(`apps/cli/lib/bin.js`)在本机跑不通**(profile 目录解析不到 `@deepseek-ai/dsh-storage-json`)。用源码入口
    `pnpm dsh …`。
11. **新增/改名 Remote 方法后必须重建 client 产物。** 浏览器侧的 Remote 代理方法表被打包进
    `packages/api/remotes/lib/client.js`,而 `pnpm run typecheck` 只重建 host 侧(`build:lib:host`)。所以改动 `@Remote`
    方法后要在 `packages/api/remotes/` 包目录内跑 `npx tsdown --env.DSH_BUILD_FACE client`(外加插件自己的 `bundle`),
    否则页面报 `kb.<方法> is not a function` —— 服务端其实已经是新的了。
12. **vitest 必须从大写 `D:/code/yantao` 启动。** 从小写 `d:\` 启动时所有用例报 "Vitest failed to find the runner":
    vitest 4 的 worker 按启动路径大小写解析模块 URL,同一份 runner 被 Node 当成两个模块。2026-09-29 曾误诊为
    Node 26 兼容性问题。⚠️ 2026-10-07 补充:Git Bash 里 `cd "D:/code/yantao"` **救不了**——同盘不同大小写的 cd 是
    no-op,进程 CWD 仍是继承的小写(`cmd //c cd` 可验证)。可靠做法是用 PowerShell 跑 vitest(`Set-Location
    D:\code\yantao` 真正重设大小写)。
13. **vitest 不做类型检查。** 收尾顺序 = vitest 全绿 → `tsc -b <改动包>` 干净 → 需要产物时再 bundle。
    2026-09-29 票 04 中一处参数误用 428 例全绿照样通过,是窄 tsc 抓出来的。
14. **客户端两步构建序。** 平台客户端模块(ui-primitives 等)的副本被前端 shell(apps/yantao dist)打包进静态模块表;
    改了它们要先 `pnpm run build:lib:client` 刷新 per-package client 产物,**再** `pnpm --filter
    @deepseek-ai/dsh-yantao-frontend run build`,最后重启工作台。只重建前端的话 shell 里是旧副本,运行时报
    `X is not a function`(实例:`observeComposition is not a function`,2026-10-07)。
15. **`dsh.client.inject`(package.json)≠ 模块服务级 `inject`。** boot manifest 行里的 inject 只是加载/预取的**包名**
    元信息;服务等待清单在各客户端模块源码的 `export const inject`,不能靠 patch yml 给上游模块改服务依赖。
16. **客户端服务环用动态 inject 破。** 0.2.1 起 ui-workspace 等 `layout`(ui-yantao 提供),ui-yantao 又要用
    `uiWorkspace`/`conversation`——静态互相 inject 四方全 pending。破法:被依赖方先 `ctx.inject(['uiWorkspace'], scope =>
    ref.current = scope.uiWorkspace)` 捕获引用座,消费点经 `whenUiWorkspace(run)` 辅助即就绪即执行、未就绪则排队
    (先例:ui-chat 的 `sidebarRightTabs`)。
17. **profile 配置互不相通。** kbRoot、模型配置都存在各 profile 的 patch(`~/.dsh/profiles/<名>/cordis.patch.yml`)里;
    headless `yantao` 与桌面 `yantao-web` 是两份。桌面栈行为异常(比如明明配置过却走首启流程)先查
    `yantao-web` 的 patch 是不是空的(2026-10-07 实机踩过)。
18. **升级后的装配级症状速查(0.2.1 实战,单测全绿照样栽)。** 共性:上游改了注册/声明形态,我们一侧**静默缺席**——
    修法是拿上游同功能的注册代码对着抄,而不是猜。已知的三个症状 → 病根:
    - 中栏 tab 只剩标签、内容全空白 → 内容槽改名(上游 ui-conversation 占位形态变了,详见 ADR-0002「内容槽改名」);
    - 会话建不起来、停在「选择工作区」hero、控制台报 `beginNavigation is not a function` → `ctx.layout` 替身缺
      0.2.1 新面(`beginNavigation`/`panelInfo`/`selectPanel`,ui-workspace 建会话必经);
    - 同样停在 hero、控制台报 `agent-preset/not-found` → preset 注册表声明了 `default` 却没插 preset 本体
      (`@deepseek-ai/dsh-agent-preset` 声明行)。后者已有 YAML 闸门测试拦截
      (`packages/bundle/yantao-web-app/tests/preset-roster.spec.ts`)。
19. **electron 二进制下载被墙。** postinstall 连 GitHub 拉 SHASUMS 直接超时;zip 往往已在
    `%LOCALAPPDATA%\electron\Cache`。设 `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'` 后重装即命中
    缓存。另注意:合并/切分支后 pnpm verify-deps 判定 node_modules 失同步会 relink electron 包,`dist/` 随之蒸发
    (启动报找不到 electron),同样用上面的镜像重装即可,不必手工解 zip。

## 调度与提议(ADR-0045 / ADR-0047 / ADR-0055)

调度到点的任务由前端(人类通道代码)直接起一次 run,不走 agent 工具面;run 结束后按双路径收取提议
(ADR-0055)。整条链路的约定:

- **提名正门是工具 `kb_propose_actions`**(ADR-0055):调度器在每次 fire 时**自动**把工具约定拼到
  提示词末尾(`scheduler.ts` 的 `withProposalConvention`)——教模型把值得人拍板的写入动作经
  `kb_propose_actions` 送进收件箱(title + actions 逐项,kind 与必填字段服务端校验,不合格项点名剔除、
  合格项照常入队,全坏才整单拒绝;2026-10-10 由整单制改逐项容错,诊断当轮回给模型修),不自行执行、
  没有值得提议的就完全不调用、入队成功后不再重复输出信封。
  2026-10-09 的能力归属原则延续:统一约定只教**能力无关**的 KB 写入类别;邮件专属的
  `delete-mails`/`archive-mails` 动作与 `mails` 水位字段的教学在 mail 能力自己的 SKILL.md(builtin v16)。
- **双路径互斥**:run 结束先扫事件日志,检出 `kb_propose_actions` 调用即走工具路径(跳过散文解析与
  追问兜底,防双入队;proposalId 从收件箱按 `source=schedule:<id>` 回查,供通知分流);未检出才走
  散文回退——旧约定(`withProposalEnvelope` 时代)的答案解析 `proposalOfAnswer` + 信封拒绝诊断 +
  一轮修复保留原样,伺候模型惯性与旧 prompt 快照。
- **动作词汇表孪生**:kinds/必填/可空字段表在 controller(`capability/proposal-actions.ts`)与客户端
  (`capability-match.ts`)各持一份——controller 不能反向依赖客户端包(web bundle 纯度),漂移由
  `proposal-tool.spec.ts` 的 parity 组钉住。改词汇表必须两边同步,parity 测试会拦漏改。
- **提议队列**在 controller 侧持久化:`<kbRoot>/.dsh/yantao/proposal-inbox.json`,经 Remote 三方法
  `proposalInboxList` / `proposalInboxEnqueue` / `proposalInboxResolve` 读写。生产者是前端调度器与
  `kb_propose_actions`(两者都只入队);agent 不读队列、不裁决、不能改撤已入队行。载荷按不透明
  JSON 存储,解释权在客户端插件的 `proposalOfPayload`。
- **决策面**是「提议」tab:复用共享 ProposalCard,**取消/Esc 即丢弃**(验收修正:卡一关必有裁决,不让人再点
  第二次);批准走 applyProposal 先写入、后 resolve;两步任一失败行都保持待决。细节取舍见 ADR-0047 台账。
- **邮件水位联动**(验收修正 2):提议的可选 `mails` 范围字段(模型抄实际批次首尾的 `receivedAt`,教学在
  mail 能力的 SKILL.md,见上;工具路径由服务端规范化为 ISO Z 戳防幻觉游标);
  人**批准或丢弃**提议时,Frame 经 `mailMarkRead` 把水位推过该范围——与手动面板 confirm/dismiss 的「看过即处理」
  同义,下次读邮件不再重推同批。范围同时显示在队列行的 note 上,隐式簿记变明面。

## 排障方向(出了问题先往哪看)

- **agent 行为诡异(「为什么这么回」)** → 看会话日志:`~/.dsh/sessions/--D-yantao-data--/session-*/session.v2.jsonl.zstd`,
  python `zstandard` 解压后逐行 JSON。pre-step 注入(能力目录、`skill-invocation` 指令)会作为 user/message 持久化,
  可据此判断注入是否发生。
- **`/能力名` 手势首轮无效** → 已知病根(2026-10-02 首修,0.2.1 适配备再修):会话首轮的 runtime-context 快照落在用户手势之后,
  旧 pre-step 钩子要求最后一条是 user 消息而误判弃注入。修复:从尾部跳过连续 runtime-context 快照找真正的 user 消息
  (`packages/api/yantao-kb-controller/src/index.ts`)。修复前的规避:新会话先发一句闲话再用手势。
- **headless CLI 不能复现工作台链路。** `pnpm dsh --profile yantao "…"` 不挂 yantao-kb-controller 的 pre-step,
  模型看不到能力目录,只适合上游 dsh 技能与冒烟。另外 Git Bash 会把 `/archify` 这类前导斜杠参数转成
  `C:/Program Files/Git/archify`,需 `MSYS_NO_PATHCONV=1`。
- **`kb_exec_capability_script` 多行命令被截断** → 已裁决不动底层(2026-10-02):cmd.exe `/c` 的换行是命令分隔符,
  这是语义不是桥的 bug;真正要程序逻辑时让能力自带 `.py` 脚本,而不是塞 `python -c` 多行载荷。

## 扩展方式

- **新增 agent 能力** → 在 `packages/yantao/kb/src/index.ts` 里加一个 `kb_*` 工具(该文件就是全部工具面),并补一个证明它
  不会越过「状态」边界的单测。
- **UI 需要新数据** → 给 `yantaoKb` Remote 加方法(`packages/api/yantao-kb-controller/`),必要时挂载,重建 client 侧
  (`pnpm run build:lib:client`),再由客户端插件调用。
- **新界面** → `apps/yantao/src/`(React)。`ctx.remote` 是通往后端的唯一门。
