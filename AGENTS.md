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
   registrations listed as the merge surface in [docs/yantao/README.md](docs/yantao/README.md#merge-surface-upstream-files-we-modify).
   That list is deliberately short — do not grow it without an ADR.
2. **The trust boundary is the tool layer.** The agent gets the six `kb_*` tools and no generic write capability; an entity's
   `状态` section must stay structurally unreachable for it (ADR-0004). The UI is the human channel and may edit anything.
3. **Cordis discipline.** Reading a service or a Remote namespace requires declaring it: `inject = ['remote', 'remote.yantaoKb']`.
   Reading an undeclared one throws at runtime.
4. **Frontend contract.** `apps/yantao` must keep the same build contract as upstream's `apps/web` — notably
   `clientBuildEnvironmentDefines(process.env)`, which stubs `process.env` as `{}`. Dropping it yields a blank page.
5. **Never commit secrets.** The model key comes from `.env` (see `.env.example`) or the credentials store; `apiKeyEnv` names a
   credential reference, never a literal.
6. **Branch `main` is local-only. Do not push.** Upstream tracking stays on `origin/master`; we pin and upgrade deliberately
   (ADR-0002).

## Everyday commands

```bash
pnpm dsh --profile yantao "…"                 # one-shot headless run through the model gateway
.\scripts\yantao-web-start.ps1                # start the workbench (background, prints URL)
.\scripts\yantao-web-stop.ps1                 # stop it

pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle   # after changing the client plugin
pnpm --filter @deepseek-ai/dsh-yantao-frontend run build     # after changing the frontend
pnpm vitest run packages/yantao/kb packages/api/yantao-kb-controller packages/client/ui-yantao
```

## Before you commit

The pre-commit hooks (lefthook) run lint, whitespace, vendor-manifest, third-party notices, and translation pairing. Two extra
things bite often:

- **New package?** Add the bilingual README triple (`README.md`, `README.zh.md`, `README.i18n.yaml`), keep the mutual language
  switcher links, and re-record: `pnpm run verify-translation-pairing --write <pkg>/README.md`.
- **New package or Remote?** Re-run the generators (`pnpm run gen-tsconfig-paths`, doc/catalog generators) so the tsconfig
  references, package maps, and catalogs include it.

## When the work is upstream work

Follow [AGENTS_dsh.md](AGENTS_dsh.md) and [docs/AGENTS.md](docs/AGENTS.md) instead — that is dsh's own documentation discipline, and
it still applies to everything outside our packages.
