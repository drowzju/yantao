# 开发指南

[English](development.md) | 中文

如何构建、运行、测试与扩展工作台,以及已经让我们付出过时间代价的那些坑。

## 环境

| 需求 | 值 |
|---|---|
| Node / pnpm | Node 24、pnpm 11(仓库要求) |
| npm registry | 内网镜像,已写入 `.npmrc`(`registry`、`disturl`) |
| 原生重建(如 `fs-ext`) | 生命周期脚本需要显式指定头文件镜像:<br>`npm_config_disturl=https://mirrors.dahuatech.com/nodejs-release/ pnpm install` |
| 模型密钥 | `.env`(复制 `.env.example`)或凭据存储;`apiKeyEnv` 只是引用名,绝不内联密钥 |
| 端口 | 用 **8080**。本机 8081/8082 会被拒绝(`EACCES`,Windows 保留区段)。 |

## 构建 —— 只构建你动过的部分

| 改动位置 | 执行 |
|---|---|
| 前端 `apps/yantao/src/**` | `pnpm --filter @deepseek-ai/dsh-yantao-frontend run build` |
| 客户端插件 `packages/client/ui-yantao/src/**` | `pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle` |
| kb 插件 / 控制器 / 任意 host 包 | `npm run build:lib:host`(较慢,数分钟) |
| `packages/client/**` 下任意内容 | `npm run build:lib:client` |
| 迭代客户端插件时热更新 | 服务运行的同时开 `pnpm run dev:web` |

## 启动与停止

```bash
.\scripts\yantao-web-start.ps1   # background server, waits for and prints the URL
.\scripts\yantao-web-stop.ps1    # stop by PID, then clears anything left on 8080
pnpm dsh --profile yantao-web --port 8080        # foreground; Ctrl+C stops it
```

冒烟测试:

```bash
pnpm dsh --profile yantao "用一句话回答：1+1等于几？"     # headless: model gateway + kb tools
# workbench: open the printed URL; the probe line shows `tree() ok: …`
```

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
6. **每个 README 都是三件套**:`README.md` + `README.zh.md` + `README.i18n.yaml`,互相保留语言切换链接;改动后用
   `pnpm run verify-translation-pairing --write <文件>` 重新记录。
7. **模型 id 拼写。** 网关接受 `GLM5.1`、`GLM`、`glm52` 三种,我们都已声明,选哪个都能工作;新增模型要连拼写一起加。
8. **别用 `taskkill //IM node.exe` 清进程** —— 会连你的 agent 运行时一起杀掉。用停止脚本。
9. **构建残留**:`tsc -b` 会在 `packages/client/*/src` 内留下 `.js`/`.d.ts`/`.map`(未跟踪,不需要)。清理前先问;
   `git clean -n packages/client/<pkg>/src` 可预览。
10. **构建版 CLI(`apps/cli/lib/bin.js`)在本机跑不通**(profile 目录解析不到 `@deepseek-ai/dsh-storage-json`)。用源码入口
    `pnpm dsh …`。
11. **新增/改名 Remote 方法后必须重建 client 产物。** 浏览器侧的 Remote 代理方法表被打包进
    `packages/api/remotes/lib/client.js`,而 `pnpm run typecheck` 只重建 host 侧(`build:lib:host`)。所以改动 `@Remote`
    方法后要跑 `pnpm run build:lib:client`(外加插件自己的 `bundle`),否则页面报 `kb.<方法> is not a function`
    —— 服务端其实已经是新的了。

## 扩展方式

- **新增 agent 能力** → 在 `packages/yantao/kb/src/index.ts` 里加一个 `kb_*` 工具(该文件就是全部工具面),并补一个证明它
  不会越过「状态」边界的单测。
- **UI 需要新数据** → 给 `yantaoKb` Remote 加方法(`packages/api/yantao-kb-controller/`),必要时挂载,重建 client 侧
  (`pnpm run build:lib:client`),再由客户端插件调用。
- **新界面** → `apps/yantao/src/`(React)。`ctx.remote` 是通往后端的唯一门。
