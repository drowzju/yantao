---
status: deprecated
---

# 打包：`--dir` 产出与源码解耦的可执行目录

> **本文修订 ADR-0016 决定 6**：原文「不出构建产物，日常用源码跑」只保留前半句的
> 精神——源码态仍是开发形态——但 yantao 现在多了一条出包路径，用来把**正在使用的实例**
> 与**正在修改的代码**分开。

## 出发点

一直从代码仓启动工作台，改代码会直接打到正在运行的实例上：

- `yantao-web` profile 是 `patchReload: 'live'`，保存即注入宿主；
- 宿主加载各包的 `lib/` 产物，重建即替换运行中的模块；
- Windows 上重建产物时文件被占用（EBUSY），要么先退出实例、要么放弃构建。

三件事叠起来就是「一边改一边用」的常态冲突。要的不是更聪明的快照，而是一条**真正的
构建**：产物落在自己的目录里，跑起来之后与仓库再无关系。

## 决定

1. **出包形态是 `electron-builder --dir` 的 `win-unpacked/` 目录**，双击
   `yantao-workbench.exe` 即用。不做安装包、不签名、不自动更新——分发范围仍是这一台机器
   （ADR-0016 决定 6 未变的部分）。
2. **主进程预编译，后端仍是源码 + tsx**。Electron 主进程由 esbuild 打成 `dist/main.js`
   进 asar，打包态不带 tsx；宿主子进程照旧 `node --import tsx/esm … apps/cli/src/bin.ts`，
   但跑的是 `resources/runtime` 下的物化副本。把整个后端预编译不现实，也不必要：宿主本来就
   是「Node + TS 源码」的形态（ADR-0016 决定 2）。
3. **运行树物化 = 整仓复制 + 链接分类重写**。复制仓库到 `resources/runtime`，逐条检查
   reparse point：
   - 目标在仓库内（workspace 链接、`node_modules/<pkg>` → `.pnpm/…`）→ **重写到副本内**的
     同一相对路径，指向仓库的链接一条不留；
   - 目标在仓库外（pnpm store 的绝对路径）→ 原样保留 junction。
4. **断链门禁**：复制完成后遍历整棵运行树，任何链接（含悬空链接）解析结果落在仓库内即
   **构建失败**。这是「已出包实例不受仓库影响」的机器保证，而不是口头承诺。
5. **打包实例有自己的 dsh home**：`%APPDATA%\@deepseek-ai\dsh-yantao-desktop\dsh-home`（Electron userData，随 appId），经 `DSH_HOME`
   注入宿主子进程（`packages/util/home-paths` 原生支持）。首启时：
   - 从 `resources/dsh-home-template` 播种 profile `yantao-packaged`（同一组 bundles、
     同一份 `cordis.patch.yml`，**没有 `patchReload`**）；
   - 从 `~/.dsh` 一次性拷贝 `.env` 与 `.credentials.yaml`（凭据 store 的 `user-env`
     兜底层读的正是 `$DSH_HOME/.env`）；
   - 按 `link-manifest.json` 重建 `profiles/node_modules` 的 junction，指向
     `resources/runtime`——目录整体挪动后下次启动自愈。
6. **KB 根共享**（`D:\yantao-data`），调度名册 `<kbRoot>/.dsh/yantao/schedules.json`
   因此天然共享：打包实例首启就能看到全部定时任务。会话、存储、profile 隔离。
7. **钉钉通道默认启用**（打包 profile 保留 `dingtalk-channel`）。
8. **同一时刻只跑一个实例**。共享 KB + 共享调度名册 + 钉钉 Stream 单消费者，两个实例
   同时在线会双触发调度、抢消息。首版靠约定，不做互斥锁——加锁属于运行期行为，等真需要
   再单独决策。

## 取舍台账

| 取舍 | 选择 | 理由 |
|---|---|---|
| 运行树整仓复制 vs 按依赖图裁剪 | **整仓复制**（剔除 `.git`/`docs`/`website` 等明确无用目录） | 裁剪要维护一份「运行期到底读什么」的清单，漏一项就是运行到一半才炸；体积换确定性，本机磁盘不紧张 |
| 打包实例与开发实例共享 KB vs 完全隔离 | **共享 KB** | 出包是为了「稳定地干活」，不是「另起一个空工作台」；调度名册跟着 KB 走，正是想要的 |
| 源码态 vs 打包态 | **两者并存** | 源码态留着改代码（HMR、快速迭代），打包态负责稳定运行；`app.isPackaged` 一处分叉，开发路径零改动 |

## 后果

- 出包是一次显式动作：`pnpm --filter @deepseek-ai/dsh-yantao-desktop run build:win:dir`。
  之后改代码、重建 `lib/`，已出包实例毫无感知。
- 打包实例仍要求 PATH 上有系统 Node（宿主子进程用它）。彻底免安装要塞便携 Node，
  仿上游 `prepare-primary-runtime`，本期不做。
- 首次出包数分钟、产物 GB 级（十万级文件 + junction 重建）。后续可做依赖裁剪优化。
- 秘钥一次性拷贝后独立演进：轮换后删掉打包 home 里的 `.env`，下次启动重拷。
- 出包前的常规工件构建（前端 `dist`、client bundle）仍会写仓库；那时若开发实例在跑，
  照样可能撞 EBUSY——这与出包本身无关，建议出包前从托盘退出开发实例。

## 修订（2026-10-24）：配置镜像，home 分离只为代码冻结

用户裁决：本 ADR 的本意是「exe 运行时不受**代码**影响」，配置/环境的加载逻辑应与
开发实例完全一致——home 的分离只为代码冻结（junction 墙指进 `resources/runtime`）
服务，不该连配置一起冻结。据此修订 `ensurePackagedHome`：

- packaged profile 的 `cordis.patch.yml` **每次启动从开发 profile
  （`~/.dsh/profiles/yantao-web`）镜像覆盖**——配置的唯一权威是开发侧，改配置
  → 出包 → exe 重启即生效，不再有首启快照陈旧导致的「exe 显 128K」类漂移。
- 源缺失（exe 被挪到无 `~/.dsh` 的机器）则保留上次镜像，安装仍可启动。
- `.env` / `.credentials.yaml` 同样改为**每次启动镜像**（用户裁决：环境与配置一致，
  密钥轮换自动跟随；源缺失保留上次镜像）。「拷贝一次、独立演进」的旧语义废止。
- `cordis.yml` / `package.json` / link-manifest 属播种基础设施，维持自愈逻辑不变。

## 废弃（2026-10-24）

本文描述的「与源码解耦」形态已废弃：正文决定 2/3/4/5 与修订节的配置镜像均不再成立
（runtime 物化、断链门禁、私有 home 播种、patch 镜像已在代码中删除）。

现行形态（用户裁决，代码为准）：

- exe = 冻结的 Electron 壳（`dist/main.js` 进 asar）+ 宿主跑**仓库源码**
  （`node --import tsx/esm <repo>/apps/cli/src/bin.ts`），仓库路径由打包时写入的
  `dist/repo-path.txt` 提供，`YANTAO_REPO` 环境变量可覆盖。
- 配置与开发实例同一世界：共用 `~/.dsh` 与 `yantao-web` profile。
- 代价（已知情接受）：exe 依赖仓库存在；代码改动在 exe **下次启动**时生效，
  运行中的实例不受磁盘变化影响（`cordis.patch.yml` 例外，热生效）。
- 单实例守卫保留（共享 KB/会话存储/钉钉 Stream）。

依据：`apps/yantao-desktop/src/main.ts`、`scripts/pack-win.mjs`、
`electron-builder.config.mjs` 的实际实现。
