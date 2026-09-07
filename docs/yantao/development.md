# Development

English | [中文](development.zh.md)

How to build, run, test, and extend the workbench — plus the traps that already cost us time.

## Environment

| Need | Value |
|---|---|
| Node / pnpm | Node 24, pnpm 11 (repo requirement) |
| npm registry | internal mirror, already in `.npmrc` (`registry`, `disturl`) |
| native rebuilds (e.g. `fs-ext`) | lifecycle scripts need the header mirror explicitly:<br>`npm_config_disturl=https://mirrors.dahuatech.com/nodejs-release/ pnpm install` |
| model key | `.env` (copy `.env.example`) or the credentials store; `apiKeyEnv` names a reference — never inline a key |
| ports | use **8080**. On this machine 8081/8082 are refused (`EACCES`, Windows excluded ranges). |

## Build — build only what you touched

| You changed | Run |
|---|---|
| frontend `apps/yantao/src/**` | `pnpm --filter @deepseek-ai/dsh-yantao-frontend run build` |
| client plugin `packages/client/ui-yantao/src/**` | `pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle` |
| kb plugin / controller / any host package | `npm run build:lib:host` (slow, a few minutes) |
| anything under `packages/client/**` | `npm run build:lib:client` |
| HMR while iterating on the client plugin | `pnpm run dev:web` alongside a running server |

## Run and stop

```bash
.\scripts\yantao-web-start.ps1   # background server, waits for and prints the URL
.\scripts\yantao-web-stop.ps1    # stop by PID, then clears anything left on 8080
pnpm dsh --profile yantao-web --port 8080        # foreground; Ctrl+C stops it
```

Smoke tests:

```bash
pnpm dsh --profile yantao "用一句话回答：1+1等于几？"     # headless: model gateway + kb tools
# workbench: open the printed URL; the probe line shows `tree() ok: …`
```

Tests: `pnpm vitest run packages/yantao/kb packages/api/yantao-kb-controller packages/client/ui-yantao`

## Gates

- Pre-commit (lefthook): lint, whitespace, vendor manifest, third-party notices, translation pairing.
- Targeted checks worth running before a PR: `pnpm run constraints`, `pnpm run verify-tsconfig-paths`,
  `pnpm run verify-package-readme-*`, `pnpm run verify-translation-pairing`.
- After adding a package or a Remote: re-run generators (`pnpm run gen-tsconfig-paths`, doc/catalog generators), or the verify
  scripts will ask for regeneration.

## Pitfalls (each one cost a debugging round)

1. **`process.env` must be stubbed in the frontend build.** `apps/yantao/vite.config.ts` must spread
   `clientBuildEnvironmentDefines(process.env)` exactly like upstream `apps/web` — it defines `process.env` as `{}`. Without it the
   bundle throws at boot and the page is **blank**.
2. **`slots` is infrastructure, not UI.** `dsh-client-ui-slots` provides a service that theme, locale, the Cordis client runner,
   session-log export, and the directory picker all wait on. Disabling it makes boot fail with "entries did not activate".
3. **Declare what you read.** Cordis throws `cannot get property X without inject`. A Remote namespace counts on its own:
   `inject = ['remote', 'remote.yantaoKb']`.
4. **`!!js process.env.X ?? 'default'` does not fall back reliably.** When the variable is unset the expression does not resolve to
   the literal; the request goes to the wrong endpoint (symptom: `404`). Keep deployment values as literals and override them in the
   user layer, not with expression defaults.
5. **Client plugin entry is `src/client/index.ts`** (not `.tsx`), and the package needs a no-op host entry `src/index.ts`.
6. **Every README is a triple**: `README.md` + `README.zh.md` + `README.i18n.yaml`, with mutual switcher links; re-record with
   `pnpm run verify-translation-pairing --write <file>`.
7. **Model id spellings.** The gateway accepts `GLM5.1`, `GLM` and `glm52`; all three are declared, so picking any of them works.
   Adding a model means adding its spelling too.
8. **Do not kill stray servers with `taskkill //IM node.exe`** — it takes down your agent runtime too. Use the stop script.
9. **Build residue**: `tsc -b` leaves `.js`/`.d.ts`/`.map` inside `packages/client/*/src` (untracked, unwanted). Ask before
   cleaning; `git clean -n packages/client/<pkg>/src` shows what would go.
10. **The built CLI (`apps/cli/lib/bin.js`) fails on this checkout** (`@deepseek-ai/dsh-storage-json` unresolvable from the profile
    dir). Use the source entry: `pnpm dsh …`.

## Extending

- **New agent capability** → add a `kb_*` tool in `packages/yantao/kb/src/index.ts` (that file is the whole tool surface) and a unit
  test that proves it cannot cross the `状态` boundary.
- **New UI data need** → add a method to the `yantaoKb` Remote (`packages/api/yantao-kb-controller/`), mount it if needed, then call
  it from the client plugin.
- **New UI** → `apps/yantao/src/` (React). Keep `ctx.remote` as the only door to the backend.
