# AGENTS.md — yantao workbench

This repository is `deepseek-harness` (upstream: [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness))
carrying the **yantao** personal knowledge workbench on a local branch `main`. Upstream's agent instructions are preserved in
[AGENTS_dsh.md](AGENTS_dsh.md) — read that file when working on dsh itself; read this one when working on yantao.

**Start here, in this order:**
1. [README.md](README.md) — what the project is and where everything lives.
2. [docs/yantao/README.md](docs/yantao/README.md) — architecture, and the exact boundary between our code and upstream's.
3. [docs/yantao/development.md](docs/yantao/development.md) — build, run, stop, tests, gates, pitfalls.
4. [docs/yantao/TODO.md](docs/yantao/TODO.md) — what is left to build.
5. [packages/yantao/CONTEXT.md](packages/yantao/CONTEXT.md) — the glossary. Use its words; do not invent synonyms.

## Hard rules

1. **Add, don't redesign.** New behaviour goes into our packages (`packages/yantao/**`, `packages/client/ui-yantao/**`,
   `packages/api/yantao-kb-controller/**`, `packages/bundle/yantao*/**`, `apps/yantao/**`). Upstream files receive only the
   registrations listed as the merge surface in [docs/yantao/README.md](docs/yantao/README.md#%E5%90%88%E5%B9%B6%E9%9D%A2%E6%88%91%E4%BB%AC%E6%94%B9%E5%8A%A8%E7%9A%84%E4%B8%8A%E6%B8%B8%E6%96%87%E4%BB%B6).
   That list is deliberately short — do not grow it without an ADR.
2. **The trust boundary is the tool layer.** The agent gets the eleven `kb_*` tools and no generic write capability; it may edit an
   entity's `状态` (ADR-0010 overturned ADR-0004's human-only rule) through `kb_write_state`, or any `## ` section but `流水`
   through `kb_edit_section` (ADR-0026), and under `resources/` it creates new text files only through `kb_write_resource`
   (creation only, never overwrite) and reads files or directory listings only through `kb_read_resource` (read-only, ADR-0028);
   it runs a capability
   (ADR-0023) only through `kb_run_capability` and only when the capability's declaration — its `yantao.json` sidecar or its entry
   in the central routing file `.dsh/skills/yantao.json` (ADR-0025) — opened it to the agent. The UI is
   the human channel and may edit anything.
3. **Cordis discipline.** Reading a service or a Remote namespace requires declaring it: `inject = ['remote', 'remote.yantaoKb']`.
   Reading an undeclared one throws at runtime.
4. **Frontend contract.** `apps/yantao` must keep the same build contract as upstream's `apps/web` — notably
   `clientBuildEnvironmentDefines(process.env)`, which stubs `process.env` as `{}`. Dropping it yields a blank page.
5. **Never commit secrets.** The model key comes from `.env` (see `.env.example`) or the credentials store; `apiKeyEnv` names a
   credential reference, never a literal.
6. **Two remotes, two branches.** `master` tracks **upstream** (`origin`, github.com/deepseek-ai/deepseek-harness) and is only ever
   fetched — it is our upgrade source. `main` carries our work and is pushed **only to your own remote** (called `yantao` below).
   Never push `main` to `origin`, and never push `master` anywhere. We pin upstream and upgrade deliberately (ADR-0002).

## Everyday commands

```bash
pnpm dsh --profile yantao "…"                 # one-shot headless run through the model gateway
pnpm --filter @deepseek-ai/dsh-yantao-desktop start          # start the workbench (Electron window + tray; ADR-0016)

pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle   # after changing the client plugin
pnpm --filter @deepseek-ai/dsh-yantao-frontend run build     # after changing the frontend
pnpm vitest run packages/yantao/kb packages/api/yantao-kb-controller packages/client/ui-yantao
```

## Before you commit

The pre-commit hooks (lefthook) run lint, whitespace, vendor-manifest, third-party notices, and translation pairing. This is a
single-user fork (ADR-0027): our own docs are **Chinese-only** — write `README.md` / docs directly in Chinese, no `.zh.md`
twins, no `.i18n.yaml` records, no re-recording; the pairing gate still governs upstream docs in full. One thing still bites:

- **New package or Remote?** Re-run the generators (`pnpm run gen-tsconfig-paths`, doc/catalog generators) so the tsconfig
  references, package maps, and catalogs include it.

## When the work is upstream work

Follow [AGENTS_dsh.md](AGENTS_dsh.md) and [docs/AGENTS.md](docs/AGENTS.md) instead — that is dsh's own documentation discipline, and
it still applies to everything outside our packages.
