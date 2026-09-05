---
description: "The yantao group map: the personal knowledge-workbench domain for the yantao profile, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/yantao

English | [中文](README.zh.md)

## Summary

The yantao group holds the personal knowledge-workbench domain mounted by the `yantao` profile: a file-backed PARA+P knowledge base whose entity notes split a human-only State section from an append-only Log section, and the tool family that makes the Log the agent's only write path. The profile composition itself — GLM gateway route, default model, persona, and the disabled generic write tools — lives in the [`bundle/yantao`](../bundle/yantao/README.md) package; this group owns the domain plugin and its file formats.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`kb`](kb/README.md) | PARA+P knowledge-base domain plugin: the six `kb_` trust-boundary tools over the file-backed KB | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [dsh-yantao bundle](../bundle/yantao/README.md) — the profile layer that mounts this group's plugin and removes the generic write tools.
- [Tool authoring reference](../../docs/cookbook/adding-a-tool.md) — the `defineTool` contract the group's tools follow.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
