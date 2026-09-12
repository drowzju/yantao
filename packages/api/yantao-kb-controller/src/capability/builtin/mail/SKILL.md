---
name: mail
description: 读取本地 Outlook 桌面客户端的邮件，按断点增量拉取最新邮件列表。
disable-model-invocation: true
---

# 邮件能力

yantao 工作台的邮件能力（ADR-0019 建立，ADR-0021 迁移为能力目录）。它挂到当前已登录的
经典 Outlook 桌面版 profile 上（pywin32/COM），按人的断点增量读取邮件，交给工作台的
分析流程；断点只在人批准写库后推进。

能力声明（入口、运行时、appliesTo）在本目录的 `yantao.json`，不在本文件里——
SKILL.md 保持纯净，方便直接复用开源 skill 目录。

## 执行契约

入口是 `scripts/entry.py`，由工作台以子进程调用：stdin 收一个 JSON 对象
`{name, kbRoot, input, state}`，stdout 回一个 JSON 对象。

- `input`：`{since?, until?, limit?, folder?}`——`since`/`until` 是显式翻页边界
  （半开区间 `[since, until)`）；都不给时用 `state.lastReadAt`，再没有就用 30 天前。
- `state`：`{lastReadAt?}`——上次读到的水印，由工作台持久化，脚本只读不写
  （推进水印是批准后的另一个动作）。
- 成功：`{ok: true, result: {since, until?, lastReadAt?, stale, messages, hasMore}}`，
  `messages` 每封 `{id, entryId, receivedAt, senderName, senderAddress, subject, body, truncated}`。
- 失败：`{ok: false, kind, message, hint}`，kind ∈ python-missing / outlook-unavailable /
  folder-missing / other。

## 前提

1. 经典 Outlook 桌面版（「新版 Outlook」没有 COM 接口，读不了）。
2. Python 位数与 Office 一致（64 位 Office 配 64 位 Python）。
3. `pip install pywin32`。

`scripts/read_outlook.py` 也可以单独在命令行跑（`--since/--until/--limit/--folder --json`），
便于脱离工作台排查。
