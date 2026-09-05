---
description: "The yantao profile bundle: a patch layer over dsh-base and dsh-headless that routes the one-shot surface through the intranet GLM gateway, for users running dsh against that gateway."
kind: "package-bundle"
---

# @deepseek-ai/dsh-yantao

English | [中文](README.zh.md)

## Summary

`dsh-yantao` is the provider layer of the `yantao` profile: `dsh --profile yantao "your task"` boots the one-shot headless surface and answers through the intranet GLM gateway (GLM5.1) instead of the default DeepSeek route. The bundle is a static patch document — it registers the gateway as a pi-ai provider route and selects that route as the default model, while the shared core and the one-shot runner come unchanged from the earlier `dsh-base` and `dsh-headless` layers. The API key is never inlined: the route names the `GLM_GATEWAY_API_KEY` credential reference, resolved per request from the launching environment or the managed credential store.

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

Run one task through the gateway, get the final answer, and exit. The first `dsh --profile yantao` invocation creates the profile directory from the shipped template (the `dsh-base`, `dsh-headless`, and `dsh-yantao` bundles in order); after that, only the key matters.

### Running a one-shot task

```sh
GLM_GATEWAY_API_KEY=<key> dsh --profile yantao "run the tests"
```

The run behaves exactly like the headless surface — provider reasoning streams to stderr, the final answer prints on stdout, and the exit code reports the outcome — except every model request goes to the gateway route this bundle registers. A missing key fails the request with a missing-credential error; supply it in the launching environment or store it through the credentials surface.

### What the bundle changes

The patch overrides two base rows by id, each replacement stated in full:

| Row | Override | Effect |
|---|---|---|
| `llm-pi-ai` | `providers.glm-gateway` | Registers the intranet GLM gateway route: the OpenAI-completions protocol against the gateway endpoint, one `GLM5.1` model entry, and the `deepseek` thinking wire format |
| `agent-default-model` | `provider: glm-gateway`, `model: GLM5.1` | Agents created without an explicit selection — the headless runner's among them — use the gateway route |

### Changing the defaults

Edit the profile's own `cordis.patch.yml` or add a later bundle. Each patch entry replaces the target's whole configuration, so restate every setting you want to keep — an override that names only one field silently drops the rest of the route.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document: two id-targeted config patches over the `dsh-base` rows, applied after the base and headless layers. It mounts no service, emits no events, and holds no mutable state; the configured rows' packages own their behavior and invariants.

### The provider route

The base `llm-pi-ai` row mounts the pi-ai adapter dormant — no routes until configuration supplies provider profiles. This layer supplies one. The `glm-gateway` route names no installed pi-ai catalog provider, so the profile is the whole provider declaration: the `openai-completions` wire protocol, the gateway endpoint, a one-entry model catalog (`GLM5.1`, sized at a 131,072-token context window and 32,768-token output capability), and the `deepseek` thinking-format compatibility switch. The `GLM_GATEWAY_API_KEY` reference resolves per request through `ctx.credentials`, where the inherited process environment ranks above the managed credential document, so `GLM_GATEWAY_API_KEY=… dsh --profile yantao …` authenticates without any stored state.

### The default selection

The `agent-default-model` row carries the transport-independent default for Agents created by entry points; the headless runner reads that selection when it creates its one-shot Agent. This layer's composition entry points the selection at `glm-gateway`/`GLM5.1`. A saved selection in the user-settings document still wins over the composition entry, as it does for every profile.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: the two row overrides, with rationale as inline comments |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| — | No runtime invariant companion is published; the package is a static patch-list carrier (a YAML document of config overrides on rows owned by other packages); it mounts no service, emits no events, and owns no mutable relation to check. Each configured row's own package carries that row's invariants. |

### Invariant ownership

No invariant companion is published because the package is a static patch-list carrier: each configured row's package owns that row's invariants, and the bundle owns no mutable relation to check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the layers this bundle rides on or the packages that own the configured rows.

- [Bundle package map](../README.md) — the surfaces built on the same core.
- [dsh-base](../base/README.md) — the shared core the yantao profile builds on.
- [dsh-headless](../headless/README.md) — the one-shot surface the profile reuses unchanged.
- [dsh-llm-pi-ai](../../llm/llm-pi-ai/README.md) — the adapter that owns the provider-route configuration shape.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the service that owns the default model selection.
- [app-boot profile section](../../boot/app-boot/README.md) — how profiles are resolved, layered, and customized.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the two rows it configures, whose owning packages own every model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; it only selects which provider route and model the composed tree talks to.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits tell you when the yantao layer needs extra care or where an override must go. They are current package constraints, not a general comparison or a task backlog.

- **The key must exist outside the bundle** — `GLM_GATEWAY_API_KEY` unset in both the launching environment and the managed credential store fails every gateway request with a missing-credential error; the bundle never stores a key itself.
- **Overrides replace whole settings blocks** — a later patch layer that touches `llm-pi-ai` or `agent-default-model` replaces that row's entire configuration, so it must restate the route or the selection in full.
- **One route, one model** — the bundle declares exactly the gateway route and `GLM5.1`; additional providers or models belong to the user-settings document or another bundle layer, not here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
