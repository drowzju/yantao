# -*- coding: utf-8 -*-
"""
读取 Windows 本地 Outlook 桌面客户端的邮件，输出一个 JSON 数组供 Node 侧读取。

用途：
  这是 yantao 工作台「邮件能力」的取数脚本（ADR-0019 建立，ADR-0021 迁入能力
  目录）。它既被能力入口 `entry.py` 以函数方式调用（`fetch_messages`），也可以
  在命令行单独运行排查；命令行模式下把 stdout 里的那一个 JSON 数组解析成邮件
  列表，stdout 除这个数组外不输出任何其它内容。

用法：
  python read_outlook.py --since <ISO8601> [--until <ISO8601>] [--limit N] [--folder NAME] [--slim] --json
    --since   只返回收件时间严格晚于该时刻的邮件（ISO 8601，例如 2026-08-11T00:00:00）
    --until   只返回收件时间严格早于该时刻的邮件（ISO 8601）；用于「往前读更早的一批」，
              与 --since 合起来是一个开区间 (since, until)，两端都不含——
              since 取上一批末封的收件时间正好不会重读它
    --limit   最多返回几封（默认 50，取最新的 N 封；<=0 表示不限）
    --folder  按名称查找文件夹（含各 store 及其子文件夹），默认收件箱
    --slim    元数据模式：每封只回 id/entryId/receivedAt/发件人/主题/toMe/线程
              字段，不取正文。翻页与巡扫一律用它——正文是输出的体积大头，
              带正文的大页会被工作台 64KB 输出截断，吞掉页底时间戳导致翻页
              锚点丢失；需要读某封正文时再单独小页拉取
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
  toMe     我在收件人列表里的位置："to"（主送）、"cc"（抄送）、"none"（都不是）、
           "unknown"（认不出当前账户）。只输出我与这封邮件的关系，不输出其他
           收件人的名字或地址——完整抄送列表既噪声又是他人隐私。
  superiorInvolved  收件人中是否有人的地址命中调用方给出的上级地址集合（布尔）。
           只回旗标，同样不输出收件人的名字或地址；调用方没给集合时恒为 false。
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from html import unescape

EXIT_OK = 0
EXIT_OUTLOOK = 3
EXIT_PYWIN32 = 4
EXIT_FOLDER = 5
EXIT_OTHER = 6

# kind → 命令行退出码；entry.py 只用 kind，main() 两个都用。
EXIT_BY_KIND = {
    "outlook-unavailable": EXIT_OUTLOOK,
    "python-missing": EXIT_PYWIN32,
    "folder-missing": EXIT_FOLDER,
    "other": EXIT_OTHER,
}

# 正文摘要长度。2026-10-10 定的 512 是给 128K 窗口的：那时整页正文灌进上下文
# 几分钟就顶满，压缩开销占到墙钟 73%。2026-10-24 窗口对齐到 768K 后复核，512
# 的副作用浮出来——摘要常常不够下判断，agent 只好同一封反复重读，总消耗反而
# 更高。2026-10-25 抬到 2048（单封取数路径）。批量巡扫不受影响：agent 信封缺省
# 仍是 slim，正文只在显式要或单封小页取时才来。
# 整封原文不靠这里留存——值得留存的邮件由人批准后走保存动词落 .eml 原件
# （ADR-0037），数据不会丢。
BODY_LIMIT = 2048

# `Body` 短于这个长度就认为它是空壳，改用 `HTMLBody` 剥标签。
PLAIN_BODY_MIN = 40

# 43 = olMail。会议邀请等非邮件项一律跳过。
OL_MAIL = 43

# Recipient.Type：1 = olTo（主送），2 = olCC（抄送）。
OL_TO = 1
OL_CC = 2

# 6 = olFolderInbox
OL_FOLDER_INBOX = 6

# 运行级正文账本的老化线（小时）：一次调度运行几十分钟足矣，隔天的账本视为
# 前尘——写入时顺手清掉过期文件，目录不会被无限堆积。
LEDGER_MAX_AGE_HOURS = 24

# 3 = olFolderDeletedItems：删除刀的去处（ADR-0034 决定 5）。移动而非永久
# 删除——回收站里还能捞回来，误删有闸。
OL_FOLDER_DELETED = 3

# MAPI 属性 PR_SENDER_SMTP_ADDRESS：Outlook 已知的发件人 SMTP 地址。
PR_SENDER_SMTP_ADDRESS = "http://schemas.microsoft.com/mapi/proptag/0x5D01001F"

LOCAL_TZ = datetime.now().astimezone().tzinfo


class OutlookError(Exception):
    """一次可分类的取数失败；kind 与 stderr JSON 的 kind 同词表。"""

    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind
        self.message = message


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
    """截成正文摘要，返回 (摘要, 是否被截断)。"""
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


def ledger_path_from_env():
    """
    运行级正文账本的路径：宿主执行桥在 agent 会话里注入
    CAPABILITY_RUN_LEDGER（同一会话的多次取数共用一份）；缺席（人通道、
    命令行裸跑、测试）返回 None——一切去重行为随之关闭，脚本照旧。
    """
    path = os.environ.get("CAPABILITY_RUN_LEDGER") or ""
    return path if path else None


def load_ledger(path):
    """读账本：id → True 的字典。文件缺席/损坏都按空账处理——去重是
    优化不是权威，账本坏了宁可多送一遍，绝不因此失败。"""
    if not path:
        return set()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return {str(key) for key in data} if isinstance(data, list) else set()
    except (OSError, ValueError):
        return set()


def save_ledger(path, seen_ids):
    """
    合并写回账本：先重读盘上最新的一份再做并集（同一次运行里的并行取数
    各自读写，谁后落盘谁的视野全；丢一条的代价只是多送一次正文，可接受），
    临时文件 + os.replace 原子落盘。顺手清掉老化线之外的旧账本。全程
    best-effort：任何失败静默放弃，绝不让去重账本拖垮取数本身。
    """
    if not path:
        return
    try:
        merged = load_ledger(path) | {str(key) for key in seen_ids}
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
            prune_old_ledgers(directory)
        scratch = f"{path}.{os.getpid()}.tmp"
        with open(scratch, "w", encoding="utf-8") as handle:
            json.dump(sorted(merged), handle, ensure_ascii=False)
        os.replace(scratch, path)
    except OSError:
        pass


def prune_old_ledgers(directory, now=None):
    """删掉目录里超过老化线的账本文件（含别的会话留下的）；失败不管。"""
    now = now or time.time()
    cutoff = now - LEDGER_MAX_AGE_HOURS * 3600
    try:
        for name in os.listdir(directory):
            if not name.endswith(".json"):
                continue
            candidate = os.path.join(directory, name)
            try:
                if os.stat(candidate).st_mtime < cutoff:
                    os.unlink(candidate)
            except OSError:
                continue
    except OSError:
        pass


def thread_fields(item):
    """
    线程归并的两个原始字段：`ConversationID`（Outlook 2010+ 的稳定会话键）
    和 `ConversationTopic`（会话主题，通常是去掉 RE/FW 的原始主题）。
    任一读不到（旧版 Outlook、异常项）就给空串，由消费端自行回退。
    """
    try:
        conversation_id = str(getattr(item, "ConversationID", "") or "")
    except Exception:
        conversation_id = ""
    try:
        conversation_topic = str(getattr(item, "ConversationTopic", "") or "")
    except Exception:
        conversation_topic = ""
    return conversation_id, conversation_topic


def current_user(ns):
    """
    当前 profile 的账户：返回 (名字, SMTP 地址)；任一拿不到就是空串。
    Exchange 账号的 `CurrentUser.Address` 是 X.500，与发件人一样先换 SMTP。
    """
    try:
        user = ns.CurrentUser
        name = str(getattr(user, "Name", "") or "")
        address = str(getattr(user, "Address", "") or "")
    except Exception:
        return "", ""
    try:
        exchange = user.GetExchangeUser()
        if exchange is not None:
            smtp = exchange.PrimarySmtpAddress
            smtp = smtp() if callable(smtp) else smtp
            if smtp:
                address = str(smtp)
    except Exception:
        pass
    return name, address


def recipient_address(recipient):
    """一个收件人的 SMTP 地址（X.500 先换算），换不出就退回原样地址。"""
    address = str(getattr(recipient, "Address", "") or "")
    try:
        entry = recipient.AddressEntry
        exchange = entry.GetExchangeUser() if entry is not None else None
        if exchange is not None:
            smtp = exchange.PrimarySmtpAddress
            smtp = smtp() if callable(smtp) else smtp
            if smtp:
                return str(smtp)
    except Exception:
        pass
    return address


def to_me(item, me_name, me_address):
    """
    我在这封邮件收件人列表里的位置："to"（主送）/ "cc"（抄送）/ "none"（都不是）；
    当前账户完全认不出时 "unknown"。只比较我自己，不收集其他收件人的信息。
    """
    if me_name == "" and me_address == "":
        return "unknown"
    me_address = me_address.lower()
    me_name = me_name.lower()
    in_cc = False
    try:
        for recipient in item.Recipients:
            kind = getattr(recipient, "Type", 0)
            if kind != OL_TO and kind != OL_CC:
                continue
            address = recipient_address(recipient).lower()
            name = str(getattr(recipient, "Name", "") or "").lower()
            mine = (me_address != "" and address == me_address) or (me_name != "" and name == me_name)
            if not mine:
                continue
            if kind == OL_TO:
                return "to"
            in_cc = True
    except Exception:
        return "unknown"
    return "cc" if in_cc else "none"


def superior_involved(item, superior_addresses):
    """
    这封邮件的收件人里有没有上级：把收件人的 SMTP 地址逐一与调用方给出的
    上级地址集合比对，命中即真。与 to_me 一样只比较、不收集——任何收件人的
    名字或地址都不落输出（ADR-0019 的隐私边界不变，ADR-0034 批次②）。
    """
    wanted = {str(address).lower() for address in superior_addresses if str(address)}
    if not wanted:
        return False
    try:
        for recipient in item.Recipients:
            if recipient_address(recipient).lower() in wanted:
                return True
    except Exception:
        return False
    return False


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


def stub_row(message):
    """
    正文重复送达时的桩行（2026-10-20 邮件窗口去重）：保留提名所需的身份
    字段（id/entryId/发件人/主题/收件时间），砍掉体积大头（正文）与其余
    已在上下文里的字段，标 deduped 供 agent 认领「这封前面看过全文」。
    """
    return {
        "id": message["id"],
        "entryId": message["entryId"],
        "receivedAt": message["receivedAt"],
        "senderName": message["senderName"],
        "senderAddress": message["senderAddress"],
        "subject": message["subject"],
        "deduped": True,
    }


def read_mails(folder, since, until, limit, me_name="", me_address="", superior_addresses=(), slim=False, dedupe_ledger=None, wanted_ids=None):
    """
    取 folder 里收件时间落在开区间 (since, until) 的最新 limit 封邮件（两端都不含）。
    wanted_ids 给出时是「按 id 找信」的快捷面（stage_actions.py 用）：
    从最新往旧扫，找齐这些 id 立即收工——不必扫完整个窗口。
    slim=True 时是元数据模式：跳过正文提取（输出的体积大头），其余字段照回——
    翻页/巡扫用它，单页几十封也不会触碰工作台 64KB 输出截断；slim 行不与账本
    发生关系（翻页锚点依赖完整行，且 slim 送达不算「见过正文」）。
    dedupe_ledger 给出账本路径时（仅非 slim），本运行已带正文送过的邮件只回
    桩行——重扫窗口不再重复付正文的价钱。
    """
    items = folder.Items
    items.Sort("[ReceivedTime]", True)

    messages = []
    seen_bodies = load_ledger(dedupe_ledger) if (dedupe_ledger and not slim) else set()
    delivered = []
    # 「按 id 找信」的收工条件：找齐即停，别为几封新信扫完整箱。
    wanted = set(wanted_ids) if wanted_ids else set()
    found = set()
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
            body, truncated = ("", False) if slim else clip(plain_body(item))
            entry_id = str(getattr(item, "EntryID", "") or "")
            conversation_id, conversation_topic = thread_fields(item)

            message = {
                "id": mail_id(received_at, sender_address, subject),
                "entryId": entry_id,
                "receivedAt": received_at,
                "senderName": sender_name,
                "senderAddress": sender_address,
                "subject": subject,
                "body": body,
                "truncated": truncated,
                "toMe": to_me(item, me_name, me_address),
                "superiorInvolved": superior_involved(item, superior_addresses),
                "conversationId": conversation_id,
                "conversationTopic": conversation_topic,
            }
            # 运行级正文去重（2026-10-20）：这笔正文已经在本运行送过一次的，
            # 这次只回桩行——重扫窗口不再重复付正文的价钱。slim 模式不走这里。
            if not slim and message["id"] in seen_bodies:
                messages.append(stub_row(message))
                continue
            # 写侧也守一道（2026-10-20）：slim 行不进账本，调用方传没传
            # ledger 都不例外——否则 slim 扫过的邮件在同运行内补正文只会
            # 拿到桩行。读侧的 not slim 保护在 seen_bodies 那行。
            if not slim:
                delivered.append(message["id"])
            messages.append(message)
            if wanted:
                # 两种键都认：指纹 id（取数结果的主键）与 EntryID（刀只认它）——
                # 调用方给哪种都能收工，不会因为键形态不同扫完整箱。
                for candidate in (message["id"], message["entryId"]):
                    if candidate in wanted:
                        found.add(candidate)
                if found >= wanted:
                    break
        except Exception as error:
            # 单封邮件读属性失败（加密、损坏、权限）不该拖垮整批；只提示，不回传。
            sys.stderr.write(f"[跳过一封邮件] {error}\n")

        if limit > 0 and len(messages) >= limit:
            break

    # 本页新送的正文创进账本（best-effort）：下一窗再碰到这些 id 就只剩桩行。
    if delivered:
        save_ledger(dedupe_ledger, delivered)
    return messages


def delete_messages(entry_ids):
    """
    把 EntryID 列表对应的邮件逐封移入「已删除」文件夹（ADR-0034 决定 5）。
    移动而非永久删除：回收站里还能捞回来。逐封收集结果——单封失败不拖垮
    整批，这与 read_mails 的单封容错同一脾气。返回 {moved, missing, failed}：
    moved/missing 是 EntryID 列表，failed 是 {id, message}。整体性的失败
    （连不上 Outlook、打不开已删除文件夹）抛 OutlookError。
    """
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

    try:
        deleted = ns.GetDefaultFolder(OL_FOLDER_DELETED)
    except Exception as error:
        raise OutlookError("other", f"打不开「已删除」文件夹：{error}") from error

    moved = []
    missing = []
    failed = []
    for entry_id in entry_ids:
        try:
            item = ns.GetItemFromID(entry_id)
        except Exception:
            # EntryID 认不出：邮件已被移走、邮箱重建、或本来就不是这个
            # profile 的东西。如实报告，不猜。
            missing.append(entry_id)
            continue
        try:
            item.Move(deleted)
            moved.append(entry_id)
        except Exception as error:
            failed.append({"id": entry_id, "message": str(error)})
    return {"moved": moved, "missing": missing, "failed": failed}


def fetch_messages(since_text, until_text, limit, folder_name, superior_addresses=(), slim=False, dedupe_ledger=None, wanted_ids=None):
    """
    取数核心：把 (since, until) 开区间窗口里的最新 limit 封邮件取回来。
    供 entry.py 以函数方式调用；失败抛 OutlookError（kind/message 与命令行
    stderr 的 JSON 同词表）。superior_addresses 是上级的 SMTP 地址集合，只为
    计算 superiorInvolved 旗标（ADR-0034 批次②）。slim=True 见 read_mails。
    dedupe_ledger 是运行级正文账本的路径（agent 会话由宿主经
    CAPABILITY_RUN_LEDGER 注入，命令行可用 --dedupe-ledger 显式给出）；
    缺席即不去重。
    """
    try:
        import win32com.client
    except ImportError:
        raise OutlookError(
            "python-missing",
            "缺少 pywin32：请先安装 Python 3，再执行 pip install pywin32，并确认 Python 位数与 Office 一致。",
        ) from None

    try:
        since = datetime.fromisoformat(since_text.replace("Z", "+00:00"))
    except (ValueError, AttributeError) as error:
        raise OutlookError("other", f"--since 不是合法的 ISO 8601 时间：{since_text}") from error
    if since.tzinfo is None:
        since = since.replace(tzinfo=LOCAL_TZ)

    until = None
    if until_text:
        try:
            until = datetime.fromisoformat(until_text.replace("Z", "+00:00"))
        except (ValueError, AttributeError) as error:
            raise OutlookError("other", f"--until 不是合法的 ISO 8601 时间：{until_text}") from error
        if until.tzinfo is None:
            until = until.replace(tzinfo=LOCAL_TZ)

    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        ns = outlook.GetNamespace("MAPI")
    except Exception as error:
        raise OutlookError(
            "outlook-unavailable",
            f"无法连接 Outlook：{error}。请确认已安装经典 Outlook 桌面版并已启动、已配置好账户。",
        ) from error

    try:
        if folder_name:
            folder = find_folder(ns, folder_name)
            if folder is None:
                raise OutlookError("folder-missing", f"找不到文件夹：{folder_name}")
        else:
            folder = ns.GetDefaultFolder(OL_FOLDER_INBOX)
    except OutlookError:
        raise
    except Exception as error:
        raise OutlookError("folder-missing", f"打开邮件文件夹失败：{error}") from error

    try:
        return read_mails(folder, since, until, limit, *current_user(ns),
                          superior_addresses=superior_addresses, slim=slim,
                          dedupe_ledger=dedupe_ledger, wanted_ids=wanted_ids)
    except Exception as error:
        raise OutlookError("other", f"读取邮件失败：{error}") from error


def main():
    parser = argparse.ArgumentParser(description="读取本地 Outlook 邮件并输出 JSON")
    parser.add_argument("--since", default=None, help="只取收件时间晚于该时刻的邮件（ISO 8601）；缺省 30 天前，与 entry.py 的首读兜底一致")
    parser.add_argument("--until", default=None, help="只取收件时间早于该时刻的邮件（ISO 8601，与 --since 组成区间）")
    parser.add_argument("--limit", type=int, default=50, help="最多返回几封（默认 50，<=0 表示不限）")
    parser.add_argument("--folder", default=None, help="文件夹名称，默认收件箱")
    parser.add_argument("--slim", action="store_true", help="元数据模式：不取正文，翻页/巡扫用，防 64KB 截断")
    parser.add_argument("--dedupe-ledger", default=None, dest="dedupe_ledger",
                        help="运行级正文账本路径：本运行已带正文送过的邮件只回桩行；缺省读 CAPABILITY_RUN_LEDGER 环境变量")
    parser.add_argument("--json", action="store_true", help="JSON 输出模式（唯一支持的模式）")
    args = parser.parse_args()

    ledger = args.dedupe_ledger or ledger_path_from_env()
    since_text = args.since
    if not since_text:
        since_text = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    try:
        messages = fetch_messages(since_text, args.until, args.limit, args.folder, slim=args.slim,
                                  dedupe_ledger=None if args.slim else ledger)
    except OutlookError as error:
        fail(error.message, error.kind, EXIT_BY_KIND.get(error.kind, EXIT_OTHER))
        return

    json.dump(messages, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(EXIT_OK)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
