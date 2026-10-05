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
    vitest 4 的 worker 按启动路径大小写解析模块 URL,同一份 runner 被 Node 当成两个模块。Git Bash 工具默认 cwd 是
    小写盘符,经它发起的运行必挂——先 `cd "D:/code/yantao"` 再跑。2026-09-29 曾误诊为 Node 26 兼容性问题。
13. **vitest 不做类型检查。** 收尾顺序 = vitest 全绿 → `tsc -b <改动包>` 干净 → 需要产物时再 bundle。
    2026-09-29 票 04 中一处参数误用 428 例全绿照样通过,是窄 tsc 抓出来的。

## 调度与提议(ADR-0045 / ADR-0047)

调度到点的任务由前端(人类通道代码)直接起一次 run,不走 agent 工具面;run 结束后前端尝试从回答里解析出
提议信封并入队。整条链路的约定:

- **提示词约定**:调度任务的提示词末尾应要求模型输出**单个**提议信封 JSON——形如
  `{"title":"…","actions":[{"kind":"…","path":"…",…}]}`,kind 必须是已知类别。裸 JSON、围栏包裹、正文夹带皆可
  (解析依次尝试:围栏块 → 全文 → 最外层花括号候选);解析不出就退化为纯通知,run 本身仍算成功。
- **提议队列**在 controller 侧持久化:`<kbRoot>/.dsh/yantao/proposal-inbox.json`,经 Remote 三方法
  `proposalInboxList` / `proposalInboxEnqueue` / `proposalInboxResolve` 读写。生产者只有前端调度器;agent 没有任何
  工具能碰到这张队列。载荷按不透明 JSON 存储,解释权在客户端插件的 `proposalOfPayload`。
- **决策面**是「提议」tab:复用共享 ProposalCard,批准走 applyProposal 先写入、后 resolve;两步任一失败行都保持
  待决。细节取舍见 ADR-0047 台账。

## 排障方向(出了问题先往哪看)

- **agent 行为诡异(「为什么这么回」)** → 看会话日志:`~/.dsh/sessions/--D-yantao-data--/session-*/session.v2.jsonl.zstd`,
  python `zstandard` 解压后逐行 JSON。pre-step 注入(能力目录、`skill-invocation` 指令)会作为 user/message 持久化,
  可据此判断注入是否发生。
- **`/能力名` 手势首轮无效** → 已知病根(2026-10-02 已修):会话首轮系统提示词沙箱快照(plugin 消息)落在用户手势之后,
  旧 pre-step 钩子要求最后一条是 user 消息而误判弃注入。修复:从尾部跳过连续 plugin 消息找真正的 user 消息
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
