# -*- coding: utf-8 -*-
"""
把一批「删除/归档」提名翻成合规的提议动作，直接写进本运行的暂存文件。

为什么存在（2026-10-20 分批落盘批次）：10:10 那次调度里，模型把取数结果的
40 位指纹 id 抄进了 entryId 槽位，32 项全被闸门剔除；为了拿回真 EntryID，它
又逐封重取了两轮。EntryID 本来就在取数结果里——这件事不该让模型抄。

本脚本收一份极简计划（只给 id），自己从 Outlook 把 entryId/sender/subject
解析出来，拼成 delete-mails / archive-mails 动作，写进
CAPABILITY_RUN_STAGING 指向的暂存文件；动作 JSON 因此不必经过模型上下文。
收尾时 kb_propose_actions（缺省 draft）会把暂存并入那一张卡。

stdin（执行桥的 JSON 信封，计划放在 input 字段）：
  {"input": {
    "delete": ["<取数结果的 id>", …],
    "archive": [{"id": "<id>", "summary": "<摘要>", "reason": "<可选缘由>"}, …],
    "since": "<ISO8601>", "until": "<ISO8601 可省>", "folder": "<文件夹名，可省>",
    "reason": "<这批删除的统一缘由，可省>"
  }}；也接受裸计划（直接把计划对象放在 stdin）。

stdout（一行 JSON）：{ok, staged, delete, archive, total, missing}
失败：{ok: false, kind, message, hint}——与能力协议的失败面同词表。
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import read_outlook
from read_outlook import OutlookError, fetch_messages

# 缺省窗口：7 天。本脚本是「按 id 找信」的翻译器，找齐即停；窗口只决定
# 找不到时最多往回翻多远——给 30 天会让一封已删掉的 id 拖成整箱扫描
# （2026-10-20 首跑实测：没传 since 就卡在整箱遍历上）。
DEFAULT_WINDOW_DAYS = 7
# missing 明细最多回几条——回执是给模型看的，不是清单。
MISSING_CAP = 20


HELP = """stage_actions.py —— 把一批「删除/归档」提名翻成合规动作，直接写进本运行的暂存文件。

用法（经 kb_exec_capability_script 调用）：
  command = "python scripts/stage_actions.py"
  input   = 下面这段 JSON（字符串即可）

计划形状：
  {
    "delete":  ["<取数结果的 id>", ...],
    "archive": [{"id": "<id>", "summary": "<摘要>"}, ...],
    "since":   "<本批起点 ISO8601，强烈建议给>"
    "until":   "<本批终点 ISO8601，可省>"
    "folder":  "<文件夹名，可省>"
    "reason":  "<这批删除的统一缘由，可省>"
  }

规则：
  - 只给 id（40 位指纹）或 entryId（长十六进制）都可以，脚本自己解析成动作。
  - 不要自己拼 delete-mails/archive-mails 动作 JSON——那正是 2026-10-20 指纹误填事故的来源。
  - since 缺省只往回翻 7 天；id 都在最近一批里时，给 since 能立刻收工。

回执（一行 JSON）：
  {"ok": true, "staged": N, "delete": D, "archive": A, "total": T, "missing": [...]}
  missing 非空 = 这些 id 不在窗口里，换 since/until 或核对 id 后补跑。
"""


def emit(answer):
    """把协议答案写成一行 JSON 到 stdout，除它之外不输出任何内容。"""
    json.dump(answer, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()


def staging_path():
    """本运行的暂存文件路径；人通道没有这个环境变量。"""
    return os.environ.get("CAPABILITY_RUN_STAGING") or None


def load_staged(path):
    """读暂存（fail-open：坏文件当空，最多多暂存一次，不丢卡）。"""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            parsed = json.load(handle)
        return parsed if isinstance(parsed, list) else []
    except (OSError, ValueError):
        return []


def staging_key(action):
    """合并键：邮件动作按 kind+entryId（同一封重暂存时新行胜），其余按全量序列化。"""
    if isinstance(action, dict) and isinstance(action.get("entryId"), str) and action["entryId"]:
        return "%s|%s" % (action.get("kind"), action["entryId"])
    return "raw|" + json.dumps(action, ensure_ascii=False, sort_keys=True)


def save_staged(path, actions):
    """合并写回（先读再写，原子替换）——脚本与工具交替写不会互相覆盖。"""
    existing = load_staged(path)
    index = {}
    for position, row in enumerate(existing):
        index[staging_key(row)] = position
    for row in actions:
        key = staging_key(row)
        if key in index:
            existing[index[key]] = row
        else:
            index[key] = len(existing)
            existing.append(row)
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    temporary = "%s.%d.tmp" % (path, os.getpid())
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(existing, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    os.replace(temporary, path)
    return len(existing)


def id_of(entry):
    """delete 项可以是 id 字符串，也可以是 {id: …} 对象。"""
    if isinstance(entry, str):
        return entry.strip()
    if isinstance(entry, dict):
        return str(entry.get("id") or "").strip()
    return ""


def run(plan):
    """解析 id → 动作 → 暂存，返回回执字典。"""
    target = staging_path()
    if target is None:
        raise OutlookError(
            "no-staging",
            "没有 CAPABILITY_RUN_STAGING：本脚本只在会话运行里可用（人通道直接提交成卡）。",
        )

    deletes = [id_of(entry) for entry in plan.get("delete") or []]
    deletes = [value for value in deletes if value]
    archives = plan.get("archive") or []
    since = plan.get("since")
    if not since:
        since = (datetime.now(timezone.utc) - timedelta(days=DEFAULT_WINDOW_DAYS)).isoformat()
    until = plan.get("until")
    folder = plan.get("folder")

    # slim 取数：只要元数据，正文一个字不读——本脚本做的是「翻译」，不是「理解」。
    # wanted_ids 让取数找齐即停：这些 id 都在最近一批里，通常扫几十封就收工。
    wanted = set(deletes)
    wanted.update(str(entry.get("id") or "").strip() for entry in archives if isinstance(entry, dict))
    wanted.update(str(entry).strip() for entry in archives if isinstance(entry, str))
    rows = fetch_messages(since, until, 0, folder, slim=True, wanted_ids=wanted or None)
    by_id = {}
    by_entry = {}
    for row in rows:
        by_id[row.get("id")] = row
        by_entry[row.get("entryId")] = row

    def resolve(identifier):
        return by_id.get(identifier) or by_entry.get(identifier)

    actions = []
    missing = []
    delete_reason = str(plan.get("reason") or "").strip() or "系统例行/重复推送，建议删除"
    for identifier in deletes:
        row = resolve(identifier)
        if row is None:
            missing.append(identifier)
            continue
        actions.append({
            "kind": "delete-mails",
            "entryId": row["entryId"],
            "sender": row.get("senderAddress") or row.get("senderName") or "",
            "subject": row.get("subject") or "",
            "reason": delete_reason,
        })
    for entry in archives:
        if isinstance(entry, str):
            identifier, summary, reason = entry.strip(), "", ""
        elif isinstance(entry, dict):
            identifier = str(entry.get("id") or "").strip()
            summary = str(entry.get("summary") or "").strip()
            reason = str(entry.get("reason") or "").strip()
        else:
            continue
        row = resolve(identifier)
        if row is None:
            missing.append(identifier)
            continue
        actions.append({
            "kind": "archive-mails",
            "entryId": row["entryId"],
            "sender": row.get("senderAddress") or row.get("senderName") or "",
            "subject": row.get("subject") or "",
            "summary": summary,
            "reason": reason or "有内容价值，建议归档",
        })

    total = save_staged(target, actions) if actions else len(load_staged(target))
    return {
        "ok": True,
        "staged": len(actions),
        "delete": len([a for a in actions if a["kind"] == "delete-mails"]),
        "archive": len([a for a in actions if a["kind"] == "archive-mails"]),
        "total": total,
        "missing": missing[:MISSING_CAP],
    }


def plan_of(envelope):
    """信封 → 计划：执行桥送的是 {name, kbRoot, input, state, channel}，
    计划在 input 里；直接跑命令行时允许裸计划。"""
    if isinstance(envelope, dict) and "input" in envelope:
        return envelope.get("input")
    return envelope


def main():
    # --help：不读 stdin 直接自述接口——2026-10-20 那轮 agent 为了猜接口
    # 连发了五次 python -c 探测，每一步都要付一轮压缩，比脚本本身贵得多。
    if "--help" in sys.argv or "-h" in sys.argv:
        sys.stdout.write(HELP)
        return
    try:
        plan = plan_of(json.load(sys.stdin))
    except ValueError:
        emit({"ok": False, "kind": "other", "message": "stdin 不是 JSON 对象",
              "hint": "传入 {\"delete\": [id…], \"archive\": [{id, summary}…], \"since\": …}"})
        return
    if not isinstance(plan, dict):
        emit({"ok": False, "kind": "other", "message": "stdin 不是 JSON 对象", "hint": "同上的计划形状"})
        return
    try:
        emit(run(plan))
    except OutlookError as error:
        emit({"ok": False, "kind": error.kind, "message": error.message,
              "hint": "确认 Outlook 已启动；人通道无暂存（用提议卡直接提交）"})
    except Exception as error:
        emit({"ok": False, "kind": "other", "message": "暂存失败：%s" % error,
              "hint": "检查 CAPABILITY_RUN_STAGING 指向的目录是否可写"})


if __name__ == "__main__":
    main()
