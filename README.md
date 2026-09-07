# yantao workbench

English | [中文](README.zh.md)

**yantao** is a personal knowledge workbench: a PARA+P knowledge base of plain Markdown files, plus an agent whose only write path
into that base is a small, auditable tool family.

It is built **inside DeepSeek Harness (`dsh`)** — this repository *is* `deepseek-harness` (upstream:
[github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)), carried on a local branch `main` that is
pinned to upstream `master@d347e70390` (release `0.1.3-alpha.1`, ADR-0002). We use dsh as the **engine and backend**; everything
yantao-specific is additive. Upstream's own documents are kept verbatim: [README_dsh.md](docs/upstream/README_dsh.md) ·
[AGENTS_dsh.md](AGENTS_dsh.md).

## Start here

| I want to… | Go to |
|---|---|
| Understand the project and its relation to dsh | [docs/yantao/README.md](docs/yantao/README.md) |
| Build, run, stop, test — and avoid known traps | [docs/yantao/development.md](docs/yantao/development.md) |
| See what is left to build | [docs/yantao/TODO.md](docs/yantao/TODO.md) |
| Know the canonical words (知识库 / 状态 / 流水 / 提炼 …) | [CONTEXT-MAP.md](CONTEXT-MAP.md) · [packages/yantao/CONTEXT.md](packages/yantao/CONTEXT.md) |
| Read the decisions | [docs/adr/](docs/adr/) |
| Read the KB + Remote subsystem | [docs/subsystems/yantao.md](docs/subsystems/yantao.md) |
| Work on upstream dsh itself | [AGENTS_dsh.md](AGENTS_dsh.md) · [docs/architecture.md](docs/architecture.md) |

## Quick start

```bash
cp .env.example .env            # then fill in MODEL_GATEWAY_API_KEY
pnpm install

.\scripts\yantao-web-start.ps1  # workbench: background server, prints the URL
.\scripts\yantao-web-stop.ps1   # stop it

pnpm dsh --profile yantao "用一句话回答：1+1等于几？"   # headless smoke test
```

## What is ours

| Path | What it is |
|---|---|
| `apps/yantao/` | the workbench frontend (React + Vite), served by dsh |
| `packages/yantao/kb/` | PARA+P domain plugin: the six `kb_*` tools (the agent's only write path) |
| `packages/api/yantao-kb-controller/` | `yantaoKb` Typert Remote: `tree` / `read` / `write` for the UI |
| `packages/client/ui-yantao/` | our client plugin: the workbench React tree over `ctx.remote` |
| `packages/bundle/yantao/`, `packages/bundle/yantao-web-app/` | profile layers: model gateway, KB tools, workbench roster |
| `packages/preset/agent-presets/presets/yantao/` | the default agent preset (no write tools) |
| `scripts/yantao-web-{start,stop}.ps1` | run/stop the workbench |
| `docs/yantao/`, `docs/adr/`, `CONTEXT-MAP.md`, `.env.example` | our documentation, decisions, and env template |

Everything else belongs to upstream dsh. The complete list of upstream files we modify (our merge surface) is in
[docs/yantao/README.md](docs/yantao/README.md#merge-surface-upstream-files-we-modify).

## Rules in one breath

- Add, don't redesign: new behaviour goes in our packages; upstream files only get one-line registrations.
- Use the glossary words; the LLM route is `model-gateway`, never a vendor name.
- Never commit a secret — the key comes from `.env` or the credentials store.
- Branch `main` is local-only: do not push.
