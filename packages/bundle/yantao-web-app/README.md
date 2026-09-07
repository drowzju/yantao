---
description: "The yantao workbench browser-surface bundle: the yantao-web profile layer that serves the stock web frontend dist with a KB workbench roster, for users composing or customizing the yantao-web profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-yantao-web-app

English | [中文](README.zh.md)

## Summary

`dsh-yantao-web-app` is the browser-surface layer of the `yantao-web` profile: `dsh --profile yantao-web` serves the SAME built web frontend dist as the stock surface — no new Vite app, no fork — with a workbench composition over it. The bundle is a static patch document plus the small runtime glue plugin that resolves the dist: it mounts the web transport and controller rows, a roster that swaps the coding-agent chrome for the KB workbench (KB tree in the sidebar, KB markdown editor in the details column, stock chat untouched in the center), the `yantaoKb` Remote controller, and the `yantao` agent preset as the default — a persona and no tool rows, so the chat agent sees exactly the boundary-respecting `kb_` tools. The GLM route, default model, Chinese persona, and kb plugin all come from the earlier `dsh-base` and `dsh-yantao` layers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Serve the workbench, get the printed URL, and open it. The first `dsh --profile yantao-web` invocation creates the profile directory from the shipped template (the `dsh-base`, `dsh-yantao`, and `dsh-yantao-web-app` bundles in order).

### Running the workbench

```sh
MODEL_GATEWAY_API_KEY=<key> dsh --profile yantao-web
```

The command prints `dsh web: <url>` and opens the default browser (pass `--no-open` to suppress; `--port` and `--host` work as on the stock surface). The page is the stock web shell; the workbench is the roster behind it: KB tree on the left, chat in the center, KB markdown editor on the right.

### What the bundle changes, layer by layer

| Row group | Content | Effect |
|---|---|---|
| Web host + transport | Same rows as the stock web layer (webserver, web-runtime, controllers, workspace, feedback, references, stats) plus `yantao-kb-controller` | The browser surface and the `yantaoKb` namespace come up identically to stock |
| Browser roster | Stock roster minus coding-agent chrome (ui-sidebar, ui-cordis, ui-workflow-run, ui-deliverables, ui-subagent, ui-skill, ui-jobs, ui-goal, ui-plan, ui-user-questions, ui-trajectory, ui-schedule), plus `ui-yantao-kb` | The workbench layout: tree | chat | editor |
| Base agent-plane rows | Disabled exactly as on the stock web surface (shell, fs, jobs, goal, plan, subagent, workflow, ralph, todo, web, compaction, instructions, skill) | Tools are per-preset again |
| `agent-presets` | `default: yantao` | New sessions mount the yantao preset: Chinese persona, no tool rows — the agent sees only the host-plane `kb_` tools |

### Changing the defaults

Edit the profile's own `cordis.patch.yml` or add a later bundle. The profile template sets `patchReload: 'live'`, so the user patch reloads without a restart. Each patch entry replaces the target's whole configuration, so restate every setting you want to keep.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is mostly a static patch document; its only code is the runtime glue cloned from `dsh-web-app` (dist resolution, the frontend-static mount, the web-surface prompt section, the `DSH_WEB_URL` bash variable, the URL line, and the default-browser handoff) and the `web-startup` command-line provider (same flags, same `webStartup` service key — the stock web-app is never mounted in this composition, so nothing collides).

### The roster diff, with reasons

Omitted from the stock roster (each is a web-app-side insert, so absence suffices): ui-sidebar (replaced by the KB tree), ui-cordis (opt-in tool not mounted), ui-workflow-run / ui-deliverables (workflow/produced-file chrome with no producers here), ui-subagent / ui-skill / ui-jobs / ui-goal / ui-plan / ui-user-questions / ui-trajectory (coding-agent chrome, inert on this surface), ui-schedule (opt-in elsewhere). Kept: the transport and framework rows, ui-conversation/ui-chat/ui-approval, the settings family, ui-workspace (its service powers session creation from the tree's 会话 section), the composer trigger pipeline, ui-message-feedback, ui-model-selection, ui-permission, ui-agent-preset, and ui-settings-plugins (where the kbRoot card renders).

### The trust boundary on this surface

Tools on the web surface are per-preset. The base agent-plane rows are disabled as on stock, and the default preset ships only the Chinese persona, so a session's merged catalog is exactly the global (host-plane) layer: the six `kb_` tools from `dsh-yantao-kb`. The shipped presets stay selectable in General settings — switching presets is the human's informed act; the boundary is the default posture.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: web host rows, transport, roster, disables, and the preset default |
| [`src/index.ts`](src/index.ts) | The runtime glue plugin (the `web-runtime` row), cloned from `dsh-web-app` |
| [`src/startup.ts`](src/startup.ts) | The `web-startup` command-line provider (flags and `--help`) |
| — | No runtime invariant companion is published; the patch-list and glue carry no mutable relation beyond what the mounted packages own. |

### Invariant ownership

No invariant companion is published because the bundle is a patch-list carrier plus stateless glue: each mounted row's package owns that row's invariants, and the bundle owns no mutable relation to check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the layers this bundle rides on or the packages that own the mounted rows.

- [Bundle package map](../README.md) — the surfaces built on the same core.
- [dsh-web-app](../web-app/README.md) — the stock browser surface this bundle's glue and roster derive from.
- [dsh-yantao](../yantao/README.md) — the provider and domain layer underneath (GLM route, persona, kb plugin, tool disables).
- [dsh-yantao-kb](../../yantao/kb/README.md) — the KB domain plugin.
- [dsh-api-yantao-kb-controller](../../api/yantao-kb-controller/README.md) — the `yantaoKb` Remote controller this bundle mounts.
- [dsh-client-ui-yantao-kb](../../client/ui-yantao-kb/README.md) — the workbench roster's centerpiece.

-----

<a id="model-experience"></a>
## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:web-surface` global section orients the model to the GUI: the canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; no-refresh reloads additionally need the `pnpm run dev:web` watcher), and the instruction not to start replacement servers. `DSH_WEB_URL` additionally appears in the managed bash environment with its description, resolved per invocation from the live server. When it is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (the port is a boot fact), so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits tell you when this surface needs extra care. They are current package constraints, not a general comparison or a task backlog.

- **The boundary is the default preset, not a lock** — the shipped coding presets remain selectable in General settings; a human who switches presets grants that session the wider tools deliberately.
- **Overrides replace whole settings blocks** — a later patch layer that touches `agent-presets` or any transport row replaces its entire configuration, so it must restate the values it keeps.
- **The details column belongs to the editor** — ui-chat's turn-details panel is shadowed on this surface; it remains available on the stock web profile.
- **No fork guarantees** — the bundle reuses the stock dist and glue verbatim; a stock web-ui change that reshapes the `sidebar`/`details` slot contract flows here and must be reconciled deliberately.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
