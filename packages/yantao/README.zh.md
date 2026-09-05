---
description: "yantao 组地图：yantao profile 的个人知识工作台领域，面向浏览本组的使用者与维护者。"
kind: "package-group"
---

# packages/yantao

[English](README.md) | 中文

## 概述

yantao 组承载 `yantao` profile 挂载的个人知识工作台领域：一个基于文件的 PARA+P 知识库，其实体笔记把人类专属的「状态」区与只许追加的「流水」区分开，以及一组让『流水』成为 agent 唯一写入口的工具。profile 组合本身——GLM 网关路由、默认模型、persona 与被禁用的通用写入工具——在 [`bundle/yantao`](../bundle/yantao/README.zh.md) 包里；本组拥有领域插件及其文件格式。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`kb`](kb/README.zh.md) | PARA+P 知识库领域插件：建立在文件型知识库之上的六个 `kb_` 信任边界工具 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [dsh-yantao bundle](../bundle/yantao/README.zh.md)——挂载本组插件并移除通用写入工具的 profile 层。
- [工具编写参考](../../docs/cookbook/adding-a-tool.zh.md)——本组工具遵循的 `defineTool` 契约。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
