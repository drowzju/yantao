# yantao workbench

English | [中文](README.zh.md)

yantao is a **personal knowledge workbench** built inside this repository: a PARA+P knowledge base of plain Markdown files, plus an
agent whose only write path into that base is a small, auditable tool family.

It runs on top of **DeepSeek Harness (`dsh`)** — an open-source agent harness by DeepSeek AI. Read the next section before touching
anything: the single most important thing to understand here is **which parts are upstream's and which are ours**.

For day-to-day work (build, run, stop, tests, gates, pitfalls) see [development.md](development.md).

## 1. How this project relates to DeepSeek Harness

| | |
|---|---|
| What this repo is | `deepseek-harness` itself (upstream: `github.com/deepseek-ai/deepseek-harness`), not a fork by copy |
| Where we work | local branch `main`, cut from upstream `master` at `d347e70390` (release `0.1.3-alpha.1`) |
| Upstream tracking | `origin/master` still points at upstream; we **pin** and upgrade deliberately (ADR-0002) — upstream ships breaking changes weekly |
| Our rule | Everything yantao needs is **additive** (new packages, new profile templates), or a **documented one-line registration** in an upstream file. We never redesign upstream internals. |
| Agent runtime | dsh's own: agent loop, tools, session event log, Typert RPC. We add plugins and profiles; we do not fork the engine. |

### Merge surface: upstream files we modify

This is the complete list of upstream-owned files the project touches today. Keep it short — this list *is* our upgrade cost.

| File | Why |
|---|---|
| `packages/boot/app-boot/src/profile.ts` | registers profile templates `yantao` and `yantao-web` |
| `apps/cli/package.json` | workspace dependencies so the profile tree can resolve our packages |
| `packages/api/remotes/{package.json,src/client/index.ts,tsconfig.*.json}` | mounts the `yantaoKb` Remote namespace on both planes |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | generated catalog entry for our Remote |
| `tsconfig.base.json`, `tsconfig.client.json`, `tsconfig.host.json` | generated aliases + project references for our packages |
| `docs/capability-seams.md`, `docs/config-catalog.md` | regenerated docs |
| `scripts/gen-cordis-catalog.ts`, `scripts/gen-doc-graphs.ts`, `scripts/type-equiv.manifest.json`, `scripts/verify-subsystem-pages.ts`, `scripts/verify-package-readme-model-experience.ts` | generators and gate sidecars that must know our packages exist |
| `packages/{api,bundle,client}/README{,.zh}.md` + pairing sidecars | package maps list every member |
| `pnpm-lock.yaml`, `.gitignore` | dependency link; `apps/yantao/dist/` ignore rule |

Everything else we own outright: `packages/yantao/**`, `packages/client/ui-yantao/**`, `packages/bundle/yantao/**`,
`packages/bundle/yantao-web-app/**`, `packages/api/yantao-kb-controller/**`, `packages/preset/agent-presets/presets/yantao/**`,
`apps/yantao/**`, `docs/adr/**`, `docs/yantao/**`, `docs/subsystems/yantao*`, `CONTEXT-MAP.md`, `.env.example`, `.npmrc`.

### Upgrading upstream

1. Read upstream release notes; expect breaking changes.
2. Rebase/merge `origin/master` onto `main` and resolve only the merge-surface files above.
3. Re-run generators (`pnpm run gen-tsconfig-paths`, doc/catalog generators) and the gate suite.
4. Re-run the smoke tests in [development.md](development.md) — headless answer + workbench `tree()`.

## 2. Architecture

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

- **dsh is the backend.** Our UI consumes it over Typert RPC and the forwarded event stream; it does not use dsh's own slot-based
  web UI (ADR-0009).
- **The agent's trust boundary is the tool layer.** The agent gets six `kb_*` tools and no generic write capability; the `状态`
  section of an entity is structurally unreachable for it (ADR-0004). The **UI is the human channel** and may edit anything.
- **Knowledge lives in files**, not a database: `resources/`, `entities/{projects,areas,people}/`, `sessions/` under the KB root
  (ADR-0005). ADR-0004's `状态` / `流水` sections are the human/agent boundary inside every entity file.

## 3. Domain language (use these words)

Canonical terms live in [CONTEXT-MAP.md](../../CONTEXT-MAP.md) (context map) and
[packages/yantao/CONTEXT.md](../../packages/yantao/CONTEXT.md) (glossary). The load-bearing ones:

**知识库 / Resource / 影子笔记 / Entity / State(状态) / 流水(Log) / 提炼(Refine) / LLM 网关 / Session(事件日志) vs 会话(交互)**

Do not invent synonyms in code, commits, or docs — and never call the LLM route by a vendor name (it is `model-gateway`, not
`glm-gateway`; see ADR-0007).

## 4. Decisions (ADR index)

| ADR | Decision |
|---|---|
| 0001 | Rebuild yantao as dsh plugins; drop the old Flutter app |
| 0002 | Pin upstream at 0.1.3-alpha.1, upgrade deliberately |
| 0003 | Workbench UI as its own app (mechanism later refined by 0008/0009) |
| 0004 | Trust boundary = the tool set; `状态` is human-only, `流水` append-only |
| 0005 | Keep the plain-Markdown KB format |
| 0006 | Chinese-only strings in yantao packages; relax the i18n pairing gate there |
| 0007 | LLM comes from the intranet model gateway; ACP/codebuddy is not the runtime path |
| 0008 | *(superseded by 0009)* compose the UI from dsh client plugins |
| 0009 | Bespoke frontend; dsh is the backend. **Validated**, with lessons recorded |

## 5. Quick start

```bash
cp .env.example .env          # then fill in MODEL_GATEWAY_API_KEY
pnpm install

# workbench (persistent; starts in the background and prints the URL)
.\scripts\yantao-web-start.ps1
.\scripts\yantao-web-stop.ps1

# headless smoke test: one prompt through the GLM gateway
pnpm dsh --profile yantao "用一句话回答：1+1等于几？"
```

Full build/verify commands, gates, and pitfalls: [development.md](development.md).

## 6. Documentation map

**Entry files are ours; upstream's are preserved with a `_dsh` suffix.**

The root [README.md](../../README.md) and [AGENTS.md](../../AGENTS.md) describe **yantao**, not upstream dsh. Upstream's originals are
kept verbatim as [docs/upstream/README_dsh.md](../upstream/README_dsh.md) / `README_dsh.zh.md` and [AGENTS_dsh.md](../../AGENTS_dsh.md).

Why the `_dsh` copies live under `docs/upstream/` rather than at the root: the bilingual pairing gate
(`scripts/verify-translation-pairing.ts` and its manifest) treats a *renamed* root `README` as out of scope, so root-level
`README_dsh.md` cannot be recorded as a pair and the commit is rejected. Inside `docs/` the same pair is in scope and records cleanly.
Keep this in mind before moving documentation: **where a file lives decides whether it can be a pair.**

**Ours**

| Document | What it holds |
|---|---|
| [development.md](development.md) | build, run, stop, tests, gates, pitfalls |
| [TODO.md](TODO.md) | backlog: done / next / deferred (each deferred item keeps its reason) |
| [../adr/](../adr/) | ADR 0001–0009 — index in section 4 |
| [../subsystems/yantao.md](../subsystems/yantao.md) | the KB + `yantaoKb` Remote subsystem page (upstream's subsystem format) |
| [CONTEXT-MAP.md](../../CONTEXT-MAP.md) | context map: yantao 工作台 ↔ dsh 平台 |
| [packages/yantao/CONTEXT.md](../../packages/yantao/CONTEXT.md) | the glossary (canonical terms) |

**Upstream dsh — still authoritative for everything outside our packages**

| Document | What it holds |
|---|---|
| [README_dsh.md](../upstream/README_dsh.md) | upstream project README (verbatim) |
| [AGENTS_dsh.md](../../AGENTS_dsh.md) | upstream agent/development instructions (verbatim) |
| [../architecture.md](../architecture.md) | dsh architecture: profiles, bundles, capability seams |
| [../cordis-primer.md](../cordis-primer.md) · [../cordis-tutorial/](../cordis-tutorial/) | the Cordis loader, config, and patch language |
| [../cookbook/](../cookbook/) | how to add a package, a tool, an LLM adapter, a remote API |
| [../i18n/README.md](../i18n/README.md) | the bilingual documentation contract (three-file pairs) |
