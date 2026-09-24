# -*- coding: utf-8 -*-
"""
邮件能力的宿主入口（ADR-0021）：stdin 收一个 JSON 对象，stdout 回一个 JSON
对象——`{name, kbRoot, input, state, channel}` 进，`{ok, result}` 或
`{ok: false, kind, message, hint}` 出。按 `input.verb` 分派：缺省是取数
（本体在 `read_outlook.py` 的 `fetch_messages`，可独立命令行运行），`delete`
是把勾选邮件移入已删除文件夹的删除刀（ADR-0034 决定 5，仅人通道）。本脚本
只做翻译与分发：把 input/state 翻译成取数窗口或删除清单、调用核心、把结果
与失败分类翻成能力协议。

断点（state.lastReadAt）由工作台持久化，本脚本只读：推进水印发生在人批准
写库之后，是另一个动作，不是取数的一部分。
"""

import json
import sys
from datetime import datetime, timedelta, timezone

import read_outlook
from read_outlook import OutlookError, delete_messages, fetch_messages

# 与工作台侧一致的陈旧阈值（ADR-0019）：没有水印，或水印老于 30 天，都算
# 「可能有断层」，由 UI 决定要不要补读，脚本绝不悄悄补。
MAIL_STALE_DAYS = 30

# 一页的默认上限。
MAIL_LIMIT = 50

# 失败提示（ADR-0006）：message 说出了什么事，hint 说人能怎么办。
HINTS = {
    "python-missing": "请安装 Python 3（安装时勾选 Add to PATH）并执行 pip install pywin32；"
                      "Python 的位数必须与 Office 一致（64 位 Office 配 64 位 Python）。",
    "outlook-unavailable": "经典 Outlook 桌面版必须已启动并配置好 profile；"
                           "“新版 Outlook”没有 COM 接口，无法读取。",
    "folder-missing": "请确认文件夹名称与 Outlook 中显示的名称完全一致。",
    "other": "请查看服务端日志了解详情。",
}


def emit(answer):
    """把协议答案写成一行 JSON 到 stdout，除它之外不输出任何内容。"""
    json.dump(answer, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()


def default_since():
    """首读边界：30 天前。第一次读不该走完整个收件箱。"""
    return (datetime.now(timezone.utc) - timedelta(days=MAIL_STALE_DAYS)).isoformat()


def is_stale(last_read_at):
    """没有水印、或水印老于 30 天、或解析不了，都算可能有断层。"""
    if not last_read_at:
        return True
    try:
        then = datetime.fromisoformat(str(last_read_at).replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True
    return datetime.now(timezone.utc) - then > timedelta(days=MAIL_STALE_DAYS)


def run_fetch(caller_input, state):
    """取数动词：把 input/state 翻译成窗口，取回一页邮件。"""
    last_read_at = state.get("lastReadAt")
    since = caller_input.get("since") or last_read_at or default_since()
    until = caller_input.get("until") or None
    try:
        limit = int(caller_input.get("limit") or MAIL_LIMIT)
    except (TypeError, ValueError):
        limit = MAIL_LIMIT
    folder = caller_input.get("folder") or None

    # 上级的 SMTP 地址集合（ADR-0034 批次②）：只为收取侧计算 superiorInvolved
    # 旗标；集合本身不落任何输出，收件人名单也照样不出脚本。
    superior = caller_input.get("superiorAddresses")
    superior_addresses = [str(address) for address in superior if str(address)] if isinstance(superior, list) else []

    try:
        messages = fetch_messages(since, until, limit, folder, superior_addresses)
    except OutlookError as error:
        emit({
            "ok": False,
            "kind": error.kind,
            "message": error.message,
            "hint": HINTS.get(error.kind, HINTS["other"]),
        })
        return

    result = {
        "since": since,
        "stale": is_stale(last_read_at),
        "messages": messages,
        "hasMore": len(messages) >= limit if limit > 0 else False,
    }
    if until:
        result["until"] = until
    if last_read_at:
        result["lastReadAt"] = last_read_at
    emit({"ok": True, "result": result})


def run_delete(caller_input, channel):
    """
    删除动词（ADR-0034 决定 5）：把勾选的邮件移入「已删除」文件夹。刀只握在
    人手里——宿主在请求信封里注入的 `channel` 是唯一的凭据，agent 通道
    （kb_run_capability）永远带着 `agent` 来，在这里被拒；input 是调用方自报
    的，不作数。
    """
    if channel != "human":
        emit({
            "ok": False,
            "kind": "not-invocable",
            "message": "删除邮件只对人的确认开放：请在工作台的提案卡上勾选后再执行。",
            "hint": "这是有意的设计（ADR-0034）：agent 只有删除提名权，没有删除执行权。",
        })
        return
    raw_ids = caller_input.get("ids")
    ids = [str(entry_id) for entry_id in raw_ids if str(entry_id)] if isinstance(raw_ids, list) else []
    if not ids:
        emit({
            "ok": False,
            "kind": "other",
            "message": "删除动词需要非空的 ids（邮件 EntryID 列表）。",
            "hint": HINTS["other"],
        })
        return
    try:
        outcome = delete_messages(ids)
    except OutlookError as error:
        emit({
            "ok": False,
            "kind": error.kind,
            "message": error.message,
            "hint": HINTS.get(error.kind, HINTS["other"]),
        })
        return
    emit({"ok": True, "result": outcome})


def main():
    try:
        request = json.loads(sys.stdin.read() or "{}")
    except ValueError as error:
        emit({"ok": False, "kind": "other", "message": f"stdin 不是合法的 JSON：{error}"})
        return
    if not isinstance(request, dict):
        emit({"ok": False, "kind": "other", "message": "stdin 必须是一个 JSON 对象。"})
        return

    caller_input = request.get("input") or {}
    state = request.get("state") or {}
    if not isinstance(caller_input, dict):
        caller_input = {}
    if not isinstance(state, dict):
        state = {}

    # 信封里的 channel 由宿主按真实调用方注入（run.ts ← index.ts 的 invoker），
    # 与调用方可任意伪造的 input 无关。缺省按 agent 处理：特权动词宁可错杀。
    channel = request.get("channel")

    verb = caller_input.get("verb") or "fetch"
    if verb == "delete":
        run_delete(caller_input, channel)
        return
    run_fetch(caller_input, state)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
