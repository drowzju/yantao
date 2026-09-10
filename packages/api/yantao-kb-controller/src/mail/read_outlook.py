# -*- coding: utf-8 -*-
"""
读取 Windows 本地 Outlook 桌面客户端的邮件，输出一个 JSON 数组供 Node 侧读取。

用途：
  这是 yantao 工作台「邮件连接」的取数脚本。它被 Node 以子进程方式调用，
  把 stdout 里的那一个 JSON 数组解析成邮件列表；stdout 除这个数组外不输出
  任何其它内容。

用法：
  python read_outlook.py --since <ISO8601> [--until <ISO8601>] [--limit N] [--folder NAME] --json
    --since   只返回收件时间严格晚于该时刻的邮件（ISO 8601，例如 2026-08-11T00:00:00）
    --until   只返回收件时间严格早于该时刻的邮件（ISO 8601）；用于「往前读更早的一批」，
              与 --since 合起来就是一个半开区间 [since, until)
    --limit   最多返回几封（默认 50，取最新的 N 封；<=0 表示不限）
    --folder  按名称查找文件夹（含各 store 及其子文件夹），默认收件箱
    --json    JSON 输出模式，目前是唯一支持的模式
  示例：
    python read_outlook.py --since 2026-08-11T00:00:00 --limit 50 --json
    python read_outlook.py --since 2026-07-12T00:00:00 --until 2026-08-11T00:00:00 --limit 50 --json

前提：
  1. 必须是经典 Outlook 桌面版（Outlook Application 的 COM 接口）。
     「新版 Outlook」/OneOutlook 没有 COM 表面，本脚本无法读取，会报
     outlook-unavailable。
  2. Python 解释器的位数必须与 Office 一致：64 位 Office 配 64 位 Python，
     32 位 Office 配 32 位 Python。位数不一致时 Dispatch 会失败，这是最常见
     的故障原因。
  3. pip install pywin32。
  4. 无需任何鉴权：脚本挂到当前已登录的 Outlook profile 上读邮件。

退出码：
  0  成功
  3  Outlook 不可用（未安装、未配置 profile、或非经典版）
  4  缺少 pywin32 或 Python 环境不可用
  5  找不到 --folder 指定的文件夹
  6  其它错误
  出错时 stdout 为空，stderr 输出 {"error": "中文说明", "kind": "..."}。

字段说明：
  id       sha1("收件时间|发件地址|主题")，跨次读取的稳定去重键。MAPI EntryID
           在邮箱移动或重建后会变，所以不作为主键，但仍一并输出 entryId。
  receivedAt  ISO 8601 字符串，统一换算到 UTC。
  senderAddress  发件人的 SMTP 地址；Exchange 账号的 X.500 地址会先换成 SMTP
           （先读 MAPI 属性，再问 AddressEntry），换不出来时原样返回。
  本脚本刻意不输出收件人/抄送：分析只需要「谁发给我的」，抄送列表既噪声又是
  他人隐私。
"""

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from html import unescape

EXIT_OK = 0
EXIT_OUTLOOK = 3
EXIT_PYWIN32 = 4
EXIT_FOLDER = 5
EXIT_OTHER = 6

# 正文截断长度。邮件正文可以非常大，而分析只需要前面一段。
BODY_LIMIT = 3000

# `Body` 短于这个长度就认为它是空壳，改用 `HTMLBody` 剥标签。
PLAIN_BODY_MIN = 40

# 43 = olMail。会议邀请等非邮件项一律跳过。
OL_MAIL = 43

# 6 = olFolderInbox
OL_FOLDER_INBOX = 6

# MAPI 属性 PR_SENDER_SMTP_ADDRESS：Outlook 已知的发件人 SMTP 地址。
PR_SENDER_SMTP_ADDRESS = "http://schemas.microsoft.com/mapi/proptag/0x5D01001F"

LOCAL_TZ = datetime.now().astimezone().tzinfo


def fail(message, kind, code):
    """把错误写成一行 JSON 到 stderr，然后以约定的退出码结束。"""
    sys.stderr.write(json.dumps({"error": message, "kind": kind}, ensure_ascii=False) + "\n")
    sys.stderr.flush()
    sys.exit(code)


def parse_time(flag, text):
    """把 --since / --until 解析成带时区的 datetime；解析不了就退出。"""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        fail(f"{flag} 不是合法的 ISO 8601 时间：{text}", "other", EXIT_OTHER)
        return None
    # 没有时区的按本机时区处理，否则无法和 Outlook 返回的时间比较。
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=LOCAL_TZ)


def as_aware(value):
    """Outlook 返回的时间转成带时区的 datetime；不是时间就返回 None。"""
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=LOCAL_TZ)


def normalize_text(text):
    """统一换行并去掉尾部空白。"""
    return re.sub(r"\r\n?", "\n", text or "").strip()


def plain_body(item):
    """取纯文本正文；`Body` 是空壳时退回 `HTMLBody` 做粗糙的标签剥离。"""
    body = normalize_text(getattr(item, "Body", "") or "")
    if len(body) >= PLAIN_BODY_MIN:
        return body

    html_body = getattr(item, "HTMLBody", "") or ""
    if not html_body:
        return body

    # 粗糙剥离：标签换成空格，反转义实体，再压掉多余空白。
    stripped = re.sub(r"<[^>]+>", " ", html_body)
    stripped = unescape(stripped).replace("\xa0", " ")
    stripped = re.sub(r"[ \t]+", " ", stripped)
    stripped = re.sub(r"\n\s*\n+", "\n", stripped).strip()
    return stripped or body


def clip(text):
    """截断正文，返回 (正文, 是否被截断)。"""
    if len(text) <= BODY_LIMIT:
        return text, False
    return text[:BODY_LIMIT], True


def smtp_address(item, fallback):
    """
    发件地址优先取 SMTP。Exchange 账号的 `SenderEmailAddress` 是 X.500 地址
    （/O=…/OU=…/cn=…），界面显示不了也没法按人分组，所以两条路都试一遍：先读
    MAPI 属性 `PR_SENDER_SMTP_ADDRESS`（不依赖 GAL，最快），再试
    `Sender.GetExchangeUser()`。都不成（外部发件人、已离职账号、COM 报错）就
    退回 Outlook 原样给的地址。
    """
    try:
        smtp = item.PropertyAccessor.GetProperty(PR_SENDER_SMTP_ADDRESS)
        if isinstance(smtp, str) and "@" in smtp:
            return smtp
    except Exception:
        pass

    try:
        user = item.Sender.GetExchangeUser()
        if user is not None:
            # 早期绑定下 PrimarySmtpAddress 是方法，晚期绑定下是属性。
            smtp = user.PrimarySmtpAddress
            smtp = smtp() if callable(smtp) else smtp
            if smtp:
                return str(smtp)
    except Exception:
        pass

    return fallback


def mail_id(received_at, sender_address, subject):
    """稳定去重键：收件时间 + 发件地址 + 主题。"""
    payload = f"{received_at}|{sender_address}|{subject}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def find_folder(ns, name):
    """按名称在所有 store 及其子文件夹里递归查找，找不到返回 None。"""
    def walk(folder):
        if folder.Name == name:
            return folder
        for sub in folder.Folders:
            found = walk(sub)
            if found is not None:
                return found
        return None

    for store in ns.Folders:
        if store.Name == name:
            return store
        found = walk(store)
        if found is not None:
            return found
    return None


def read_mails(folder, since, until, limit):
    """取 folder 里收件时间落在 [since, until) 的最新 limit 封邮件。"""
    items = folder.Items
    items.Sort("[ReceivedTime]", True)

    messages = []
    # 注意：这里刻意不用 items.Restrict("[ReceivedTime] >= '…'")——那个日期
    # 字面量在部分 Outlook 版本上受区域设置影响。先把排好序的邮件取回来，
    # 再在 Python 里用 datetime 比较。
    for item in items:
        if getattr(item, "Class", None) != OL_MAIL:
            continue

        received = as_aware(getattr(item, "ReceivedTime", None))
        if received is None:
            continue
        # 邮件按收件时间倒序：比 until 还新的先跳过，比 since 还旧的后面全都是，
        # 所以这里可以直接收工——「往前读」时省掉整箱的扫描。
        if until is not None and received >= until:
            continue
        if received <= since:
            break

        try:
            received_at = received.astimezone(timezone.utc).isoformat()
            sender_name = getattr(item, "SenderName", "") or ""
            sender_address = smtp_address(item, getattr(item, "SenderEmailAddress", "") or "")
            subject = getattr(item, "Subject", "") or ""
            body, truncated = clip(plain_body(item))
            entry_id = str(getattr(item, "EntryID", "") or "")

            messages.append({
                "id": mail_id(received_at, sender_address, subject),
                "entryId": entry_id,
                "receivedAt": received_at,
                "senderName": sender_name,
                "senderAddress": sender_address,
                "subject": subject,
                "body": body,
                "truncated": truncated,
            })
        except Exception as error:
            # 单封邮件读属性失败（加密、损坏、权限）不该拖垮整批；只提示，不回传。
            sys.stderr.write(f"[跳过一封邮件] {error}\n")

        if limit > 0 and len(messages) >= limit:
            break

    return messages


def main():
    parser = argparse.ArgumentParser(description="读取本地 Outlook 邮件并输出 JSON")
    parser.add_argument("--since", required=True, help="只取收件时间晚于该时刻的邮件（ISO 8601）")
    parser.add_argument("--until", default=None, help="只取收件时间早于该时刻的邮件（ISO 8601，与 --since 组成区间）")
    parser.add_argument("--limit", type=int, default=50, help="最多返回几封（默认 50，<=0 表示不限）")
    parser.add_argument("--folder", default=None, help="文件夹名称，默认收件箱")
    parser.add_argument("--json", action="store_true", help="JSON 输出模式（唯一支持的模式）")
    args = parser.parse_args()

    try:
        import win32com.client
    except ImportError:
        fail("缺少 pywin32：请先安装 Python 3，再执行 pip install pywin32，并确认 Python 位数与 Office 一致。",
             "python-missing", EXIT_PYWIN32)
        return

    since = parse_time("--since", args.since)
    until = parse_time("--until", args.until) if args.until else None

    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        ns = outlook.GetNamespace("MAPI")
    except Exception as error:
        fail(f"无法连接 Outlook：{error}。请确认已安装经典 Outlook 桌面版并已启动、已配置好账户。",
             "outlook-unavailable", EXIT_OUTLOOK)
        return

    try:
        if args.folder:
            folder = find_folder(ns, args.folder)
            if folder is None:
                fail(f"找不到文件夹：{args.folder}", "folder-missing", EXIT_FOLDER)
                return
        else:
            folder = ns.GetDefaultFolder(OL_FOLDER_INBOX)
    except Exception as error:
        fail(f"打开邮件文件夹失败：{error}", "folder-missing", EXIT_FOLDER)
        return

    try:
        messages = read_mails(folder, since, until, args.limit)
    except Exception as error:
        fail(f"读取邮件失败：{error}", "other", EXIT_OTHER)
        return

    json.dump(messages, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(EXIT_OK)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
