# -*- coding: utf-8 -*-
"""
邮件附件下载动词的核心（2026-10-08，提案驱动修订）：把邮件的附件存进
归档原件所在的 mails 目录，并在 mail-index 里记一行账。

与 archive_mail.py 同一脾气——挂在当前已登录的经典 Outlook profile 上
（pywin32/COM），逐封串行，单封失败不拖垮整批。仅人通道（entry.py 的
channel 闸门把关）：agent 只提名（分析答复的 attachments 块 → 提案卡的
「下载附件」组），落盘这一下永远由人的勾选触发。

存储布局：与归档原件同目录——`<kbRoot>/resources/mails/YYYY/MM/
<收件本地时间>_<净化主题>_<净化附件名>`。附件名来自邮件本身、不可信——
先取 basename 掐掉路径分量，再过一遍禁字符净化，杜绝路径穿越。

索引：落盘成功的当月，往 `<kbRoot>/resources/mail-index/mailsYYYYMM.md`
追加一行八列（与归档同表同列），「保存路径」列放本次新落的附件路径（多个
用「；」相连），「备注」列记「附件下载」。索引函数直接复用 archive_mail
的（同目录同约定），保证两张账本一个长相。

幂等：同名已存在按「已存过」保守跳过（与 .msg 兜底件同一立场）——附件
没有廉价的验身办法。整封的附件全都已存在时不追索引行，避免重复记账。
"""

import os
import re

import read_outlook
from read_outlook import OL_MAIL, LOCAL_TZ, OutlookError, as_aware

# KB 根下的资源目录名（KB 布局的既有约定）。
RESOURCES = "resources"

# 主题在文件名里的最大字符数（比归档短：附件名自身也要占地方）。
SUBJECT_CAP = 40

# 附件名在文件名里的最大字符数。
FILENAME_CAP = 80

# Windows 文件名禁字符加控制性空白，统一换成下划线（与 archive_mail 同表）。
INVALID_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]')

# 索引「备注」列的身份标记。
INDEX_REMARK = "附件下载"


def sanitized(text, cap):
    """文件名片段净化：禁字符与空白换下划线、掐头尾、截长；空了给空串。"""
    cleaned = INVALID_CHARS.sub("_", str(text or "")).strip(". ")
    if len(cleaned) > cap:
        cleaned = cleaned[:cap].strip(". ")
    return cleaned


def attachment_filename_of(att):
    """
    附件的落地文件名：只取 basename（附件名理论上是纯文件名，但它是邮件
    自带的、不可信——掐掉路径分量再净化，杜绝路径穿越），保住扩展名。
    """
    raw = str(getattr(att, "FileName", "") or "").replace("\\", "/")
    base = raw.rsplit("/", 1)[-1].strip(". ")
    return sanitized(base, FILENAME_CAP) or "附件"


def download_one(ns, kb_root, entry_id, summary, outcome):
    """下载一封的全部附件：定位原件 → 逐个 SaveAsFile 落盘 → 追索引行。"""
    # archive_mail 的索引家什直接借用：同目录同表同列，两张账本一个长相。
    from archive_mail import (
        append_index_row, ensure_index, index_path_for, index_row,
        recipients_cell, recipients_of,
    )

    try:
        item = ns.GetItemFromID(entry_id)
    except Exception:
        outcome["missing"].append(entry_id)
        return
    if getattr(item, "Class", None) != OL_MAIL:
        outcome["skipped"].append({"id": entry_id, "reason": "不是邮件项（会议邀请等），跳过"})
        return
    received = as_aware(getattr(item, "ReceivedTime", None))
    if received is None:
        outcome["skipped"].append({"id": entry_id, "reason": "读不到收件时间，无法定位月份"})
        return

    attachments = list(getattr(item, "Attachments", None) or [])
    if not attachments:
        outcome["skipped"].append({"id": entry_id, "reason": "无附件"})
        return

    local = received.astimezone(LOCAL_TZ)
    # 与归档原件同目录（resources/mails/YYYY/MM/），附件跟着 .eml 住。
    month_dir = os.path.join(
        kb_root, RESOURCES, "mails",
        local.strftime("%Y"), local.strftime("%m"),
    )
    os.makedirs(month_dir, exist_ok=True)
    subject = str(getattr(item, "Subject", "") or "")
    prefix = f"{local.strftime('%Y-%m-%d_%H%M')}_{sanitized(subject, SUBJECT_CAP)}"
    saved_paths = []
    for att in attachments:
        name = attachment_filename_of(att)
        target = os.path.join(month_dir, f"{prefix}_{name}")
        if os.path.exists(target):
            # 同名已存在按已存过跳过：附件没有廉价的验身手段，重复点击
            # 等于无害空操作（保守的幂等，与 .msg 兜底件同一立场）。
            outcome["skipped"].append({"id": entry_id, "reason": f"同名已存在，跳过：{name}"})
            continue
        try:
            att.SaveAsFile(os.path.abspath(target))
        except Exception as error:
            outcome["failed"].append({"id": entry_id, "message": f"{name}：{error}"})
            continue
        relative = os.path.relpath(target, os.path.join(kb_root, RESOURCES)).replace(os.sep, "/")
        outcome["saved"].append({"id": entry_id, "path": relative, "filename": name})
        saved_paths.append(relative)

    if not saved_paths:
        # 一个都没落下（全是同名跳过）：不追索引行，重复确认不重复记账。
        return

    # 落盘成功立刻追加索引行（与归档决定 7 同一对自洽：文件＋行一起出生）。
    try:
        to_pairs, cc_pairs = recipients_of(item)
    except Exception:
        to_pairs, cc_pairs = [], []
    month_stamp = local.strftime("%Y%m")
    index_path = index_path_for(kb_root, month_stamp)
    ensure_index(index_path, month_stamp)
    append_index_row(index_path, index_row([
        subject or "（无主题）",
        str(getattr(item, "SenderName", "") or ""),
        recipients_cell(to_pairs + cc_pairs),
        local.strftime("%Y-%m-%d %H:%M"),
        "；".join(saved_paths),
        summary or "",
        str(getattr(item, "ConversationTopic", "") or ""),
        INDEX_REMARK,
    ]))


def download_attachments(kb_root, mails):
    """
    下载一批邮件的附件：逐封串行，单封失败不拖垮整批（与归档决定 7 同一
    一致性立场）。`mails` 每项 {entryId, summary?}——entryId 定位 Outlook
    里的原件，summary（分析提名的理由）落索引「摘要」列。返回分桶结果：
    saved 每项 {id, path, filename}（path 相对 `resources/`），skipped 带
    明细，missing 是 EntryID 列表，failed 是 {id, message}，warnings 预留
    给整批提示（当前恒空，与归档结果同形，方便 UI 复用）。
    """
    if not kb_root:
        raise OutlookError("other", "知识库根目录未设置：请先在工作台里选定 KB 根目录。")

    try:
        import win32com.client
    except ImportError:
        raise OutlookError(
            "python-missing",
            "缺少 pywin32：请先安装 Python 3，再执行 pip install pywin32，并确认 Python 位数与 Office 一致。",
        ) from None
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        ns = outlook.GetNamespace("MAPI")
    except Exception as error:
        raise OutlookError(
            "outlook-unavailable",
            f"无法连接 Outlook：{error}。请确认已安装经典 Outlook 桌面版并已启动、已配置好账户。",
        ) from error

    outcome = {"saved": [], "skipped": [], "missing": [], "failed": [], "warnings": []}
    for entry in mails:
        row = entry or {}
        entry_id = str(row.get("entryId") or "")
        if not entry_id:
            continue
        summary = str(row.get("summary") or "")
        try:
            download_one(ns, kb_root, entry_id, summary, outcome)
        except Exception as error:
            outcome["failed"].append({"id": entry_id, "message": str(error)})
    return outcome
