# yantao 工作台

[English](README.md) | 中文

yantao 是一个**个人知识工作台**:以纯 Markdown 存放 PARA+P 知识库,并让 agent 写入知识库的唯一通道是一小组可审计的工具。

它构建在 **DeepSeek Harness(`dsh`)** 之上——本仓库**就是** `deepseek-harness`(上游:github.com/deepseek-ai/deepseek-harness),
我们在从上游 `master@d347e70390`
(发布版 `0.1.3-alpha.1`,ADR-0002)切出的本地分支 `main` 上工作,并**刻意钉住**上游。我们把 dsh 当作**引擎与后端**;yantao 的一切都是
增量添加的。日常开发(构建、运行、停止、测试、门禁、坑)见 [development.md](development.zh.md)。

## 1. 本工程与 DeepSeek Harness 的关系(先读这段)

| | |
|---|---|
| 本仓库是什么 | `deepseek-harness` 本身(上游:`github.com/deepseek-ai/deepseek-harness`),不是复制式分叉 |
| 我们在哪工作 | 本地分支 `main`,自上游 `master` 的 `d347e70390` 切出(发布版 `0.1.3-alpha.1`) |
| 上游跟踪 | `origin/master` 仍指向上游;我们**钉版本**、按节奏刻意升级(ADR-0002)——上游每周都有破坏性变更 |
| 我们的原则 | yantao 需要的一切都**增量添加**(新包、新 profile 模板),或在上游文件里做**有据可查的一行登记**。绝不重构上游内部。 |
| agent 运行时 | 用 dsh 自己的:agent loop、工具、session 事件日志、Typert RPC。我们只加插件与 profile,不分叉引擎。 |

### 合并面:我们改动的上游文件

以下是目前工程触及的全部上游文件。请保持这个清单短小——**它就是我们升级上游的成本**。

| 文件 | 为什么动 |
|---|---|
| `packages/boot/app-boot/src/profile.ts` | 注册 profile 模板 `yantao` 与 `yantao-web` |
| `apps/cli/package.json` | workspace 依赖,让 profile 树能解析我们的包 |
| `packages/api/remotes/{package.json,src/client/index.ts,tsconfig.*.json}` | 在两个平面挂载 `yantaoKb` Remote 命名空间 |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | 我们 Remote 的生成式目录条目 |
| `tsconfig.base.json`、`tsconfig.client.json`、`tsconfig.host.json` | 我们包的生成别名与项目引用 |
| `docs/capability-seams.md`、`docs/config-catalog.md` | 重新生成的文档 |
| `scripts/gen-cordis-catalog.ts`、`scripts/gen-doc-graphs.ts`、`scripts/type-equiv.manifest.json`、`scripts/verify-subsystem-pages.ts`、`scripts/verify-package-readme-model-experience.ts` | 生成器与门禁旁车,必须知道我们的包存在 |
| `packages/{api,bundle,client}/README{,.zh}.md` 及配对记录 | 包地图列出每个成员 |
| `pnpm-lock.yaml`、`.gitignore` | 依赖链接;`apps/yantao/dist/` 忽略规则 |

其余完全属于我们:`packages/yantao/**`、`packages/client/ui-yantao/**`、`packages/bundle/yantao/**`、
`packages/bundle/yantao-web-app/**`、`packages/api/yantao-kb-controller/**`、
`packages/preset/agent-presets/presets/yantao/**`、`apps/yantao/**`、`docs/adr/**`、`docs/yantao/**`、
`docs/subsystems/yantao*`、`CONTEXT-MAP.md`、`.env.example`、`.npmrc`。

### 升级上游

1. 读上游发布说明;默认有破坏性变更。
2. 把 `origin/master` 合并/rebase 到 `main`,只解决上面合并面里的文件。
3. 重跑生成器(`pnpm run gen-tsconfig-paths`、文档/目录生成器)与门禁套件。
4. 重跑 [development.md](development.zh.md) 里的冒烟测试——headless 作答 + 工作台 `tree()`。

## 2. 架构

```
apps/yantao (React + Vite)  ──served by──►  dsh profile yantao-web
   own three-pane UI                          = dsh-base + dsh-yantao + dsh-yantao-web-app
   talks to ctx.remote only                        │
                                                   ├─ agent loop, kb_* tools, session log
                                                   ├─ packages/yantao/kb ....... PARA+P domain + trust boundary
                                                   ├─ packages/api/yantao-kb-controller ... yantaoKb Remote (tree/read/write)
                                                   └─ llm-pi-ai route `model-gateway` ..... intranet LLM gateway (ADR-0007)

profile `yantao` = the same stack without the web surface (one-shot headless runs)
```

- **dsh 是后端。** 我们的 UI 通过 Typert RPC 与转发事件流消费它,不使用 dsh 自带基于槽位的 web UI(ADR-0009)。
- **信任边界在工具层。** agent 只有六个 `kb_*` 工具、没有通用写能力;实体文件的「状态」区对它结构上不可达(ADR-0004)。
  **UI 是人类通道**,可以编辑任何内容。
- **知识存在文件里**,不是数据库:KB 根下的 `resources/`、`entities/{projects,areas,people}/`、`sessions/`(ADR-0005)。每个实体文件里的
  「状态」/「流水」两区就是人与 agent 的边界。

## 3. 领域用语(请用这些词)

规范术语在 [CONTEXT-MAP.md](../../CONTEXT-MAP.md)(上下文地图)与
[packages/yantao/CONTEXT.md](../../packages/yantao/CONTEXT.md)(词汇表)。承重词:

**知识库 / Resource / 影子笔记 / Entity / State(状态) / 流水(Log) / 提炼(Refine) / LLM 网关 / Session(事件日志)vs 会话(交互)**

不要在代码、提交与文档里自造同义词;也不要用厂商名称呼 LLM 路由(它是 `model-gateway`,不是 `glm-gateway`,见 ADR-0007)。

## 4. 决策(ADR 索引)

| ADR | 决策 |
|---|---|
| 0001 | 以 dsh 插件形态重建 yantao,放弃旧 Flutter 应用 |
| 0002 | 钉住上游 0.1.3-alpha.1,刻意升级 |
| 0003 | 工作台 UI 作为独立 app(机制后被 0008/0009 细化) |
| 0004 | 信任边界 = 工具集;状态区人类专属、流水区只追加 |
| 0005 | 沿用纯 Markdown 知识库格式 |
| 0006 | yantao 包仅中文文案,放宽该范围的双语配对门 |
| 0007 | LLM 走内网模型网关;ACP/codebuddy 不是运行时路径 |
| 0008 | *(被 0009 取代)* 用 dsh 客户端插件组合 UI |
| 0009 | 自研前端、dsh 退居后端。**已验证**,并记录了教训 |

## 5. 快速上手

```bash
cp .env.example .env          # then fill in MODEL_GATEWAY_API_KEY
pnpm install

# workbench (persistent; starts in the background and prints the URL)
.\scripts\yantao-web-start.ps1
.\scripts\yantao-web-stop.ps1

# headless smoke test: one prompt through the GLM gateway
pnpm dsh --profile yantao "用一句话回答：1+1等于几？"
```

完整的构建/验证命令、门禁与坑:[development.md](development.zh.md)。

## 6. 文档地图

**入口文件归我们,上游的以 `_dsh` 后缀保留。**

根目录的 [README.md](../../README.zh.md) 与 [AGENTS.md](../../AGENTS.md) 描述的是 **yantao**,不是上游 dsh。上游原文件原样保留为
[docs/upstream/README_dsh.md](../upstream/README_dsh.zh.md) / `README_dsh.zh.md`,以及 [AGENTS_dsh.md](../../AGENTS_dsh.md)。

为什么 `_dsh` 副本放在 `docs/upstream/` 而不是根目录:双语配对门(`scripts/verify-translation-pairing.ts` 及其清单)把**改名后的根
README** 视为范围外,于是根级 `README_dsh.md` 无法作为一对被记录,提交会被拒绝;放在 `docs/` 下则是范围内,可以正常记录。以后移动文档
请记住:**文件放在哪,决定了它能不能成为一对。**

**我们的**

| 文档 | 内容 |
|---|---|
| [development.md](development.zh.md) | 构建、运行、停止、测试、门禁、坑 |
| [TODO.md](TODO.zh.md) | 待办:done / next / deferred(每个搁置项都带原因) |
| [../adr/](../adr/) | ADR 0001–0009(索引见第 4 节) |
| [../subsystems/yantao.md](../subsystems/yantao.zh.md) | 知识库与 `yantaoKb` Remote 子系统页(上游子系统格式) |
| [CONTEXT-MAP.md](../../CONTEXT-MAP.md) | 上下文地图:yantao 工作台 ↔ dsh 平台 |
| [packages/yantao/CONTEXT.md](../../packages/yantao/CONTEXT.md) | 词汇表(规范用词) |

**上游 dsh —— 对我们包以外的一切仍然权威**

| 文档 | 内容 |
|---|---|
| [README_dsh.zh.md](../upstream/README_dsh.zh.md) | 上游项目 README(原样保留) |
| [AGENTS_dsh.md](../../AGENTS_dsh.md) | 上游 agent/开发指引(原样保留) |
| [../architecture.md](../architecture.zh.md) | dsh 架构:profile、bundle、能力接缝 |
| [../cordis-primer.md](../cordis-primer.zh.md) · [../cordis-tutorial/](../cordis-tutorial/) | Cordis loader、配置与 patch 语言 |
| [../cookbook/](../cookbook/) | 如何加包、加工具、加 LLM adapter、加 Remote API |
| [../i18n/README.zh.md](../i18n/README.zh.md) | 双语文档契约(三文件一对) |
