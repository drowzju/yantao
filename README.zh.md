# yantao 工作台

[English](README.md) | 中文

**yantao** 是一个个人知识工作台:以纯 Markdown 存放 PARA+P 知识库,并让 agent 写入知识库的唯一通道是一小组可审计的工具。

它构建在 **DeepSeek Harness(`dsh`)** 之上——本仓库**就是** `deepseek-harness`(上游:
[github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)),我们工作在本地分支 `main` 上,该分支钉在
上游 `master@d347e70390`(发布版 `0.1.3-alpha.1`,ADR-0002)。我们把 dsh 当作**引擎与后端**,yantao 的一切都是增量添加的。上游文档
原样保留:[README_dsh.zh.md](docs/upstream/README_dsh.zh.md) · [AGENTS_dsh.md](AGENTS_dsh.md)。

## 从这里开始

| 我想… | 去这里 |
|---|---|
| 了解工程与 dsh 的关系 | [docs/yantao/README.md](docs/yantao/README.zh.md) |
| 构建、启动、停止、测试,以及避开已知坑 | [docs/yantao/development.md](docs/yantao/development.zh.md) |
| 看还有哪些没做 | [docs/yantao/TODO.md](docs/yantao/TODO.zh.md) |
| 查规范用词(知识库 / 状态 / 流水 / 提炼 …) | [CONTEXT-MAP.md](CONTEXT-MAP.md) · [packages/yantao/CONTEXT.md](packages/yantao/CONTEXT.md) |
| 读决策记录 | [docs/adr/](docs/adr/) |
| 读知识库与 Remote 子系统 | [docs/subsystems/yantao.md](docs/subsystems/yantao.zh.md) |
| 改上游 dsh 本身 | [AGENTS_dsh.md](AGENTS_dsh.md) · [docs/architecture.md](docs/architecture.zh.md) |

## 快速上手

```bash
cp .env.example .env            # then fill in MODEL_GATEWAY_API_KEY
pnpm install

.\scripts\yantao-web-start.ps1  # workbench: background server, prints the URL
.\scripts\yantao-web-stop.ps1   # stop it

pnpm dsh --profile yantao "用一句话回答：1+1等于几？"   # headless smoke test
```

## 哪些是我们的

| 路径 | 是什么 |
|---|---|
| `apps/yantao/` | 工作台前端(React + Vite),由 dsh 伺服 |
| `packages/yantao/kb/` | PARA+P 领域插件:六个 `kb_*` 工具(agent 的唯一写入通道) |
| `packages/api/yantao-kb-controller/` | `yantaoKb` Typert Remote:给 UI 的 `tree` / `read` / `write` |
| `packages/client/ui-yantao/` | 我们的客户端插件:基于 `ctx.remote` 的工作台 React 树 |
| `packages/bundle/yantao/`、`packages/bundle/yantao-web-app/` | profile 层:模型网关、KB 工具、工作台名单 |
| `packages/preset/agent-presets/presets/yantao/` | 默认 agent 预设(不含写工具) |
| `scripts/yantao-web-{start,stop}.ps1` | 启动/停止工作台 |
| `docs/yantao/`、`docs/adr/`、`CONTEXT-MAP.md`、`.env.example` | 我们的文档、决策与环境模板 |

其余一切属于上游 dsh。我们改动的上游文件清单(合并面)见
[docs/yantao/README.md](docs/yantao/README.zh.md#merge-surface-upstream-files-we-modify)。

## 一句话规矩

- 只加不改:新行为放进我们自己的包;上游文件只做登记式的一行修改。
- 用术语表里的词;LLM 路由叫 `model-gateway`,不写厂商名。
- 密钥绝不入库——走 `.env` 或凭据存储。
- 分支 `main` 只在本地:不要 push。
