# -*- coding: utf-8 -*-
"""
邮件归档动词的核心（ADR-0037）：把高价值邮件存成自包含的 .eml 原件，并维护
月度索引。与 read_outlook.py 同一脾气——挂在当前已登录的经典 Outlook profile
上（pywin32/COM），单封失败不拖垮整批。

归档路径（ADR-0037 决定 1）：`MailItem.SaveAs` 导出 .msg（COM 不支持直接导出
RFC822），再在本模块内重组为 MIME .eml；重组失败的个别邮件降级保存 .msg 原
件，索引里备注「msg 兜底」。重组依赖 extract_msg（pip install extract-msg），
缺库时整批降级为 .msg——归档永不因转换器缺席而失败。头字段优先取 .msg 内嵌
的传输头（收信时的线上真相），缺项才退 COM 值；正文过一道 Latin-1→GBK 乱码
反演（extract_msg 会把 GBK 正文流误解成 Latin-1，勘误 2026-10-03）。

存储布局（决定 4）：原件落 `<kbRoot>/resources/mails/YYYY/MM/`，索引落
`<kbRoot>/resources/mail-index/mailsYYYYMM.md`。索引由本脚本读-改-写维护，
不给 kb_write_resource 开「可覆盖」口子；这是能力（人批准）通道行为，不是
工具通道（决定 3）。

幂等与撞名（决定 5/6）：文件名 = 收件本地时间_净化主题_发件人显示名；同名
已存在时先验明正身——解析既有 .eml 的头字段与本封比对，同一封即整封跳过
（第二次批准等于无害空操作），确属另一封才追加 mail_id 前 8 位短哈希；
.msg 兜底件无法廉价验身，一律按「已归档」跳过（保守的幂等）。

一致性（决定 7）：逐封串行——.eml 落盘成功立刻追加索引行，再做下一封；
中途崩溃留下的每一对（文件＋索引行）都自洽。

上限（决定 9）：.eml 序列化后超过 25MB 的邮件拒绝落盘，索引里记一行
「过大未存」（只有元信息、没有文件）。

隐私边界（决定 8）：收件人完整列表（主送＋抄送）只在本动词里读取、只落进
经人逐封批准的归档索引——这是对 ADR-0019 取数通道纪律的显式例外，不是疏忽。
"""

import mimetypes
import os
import re
import tempfile
from datetime import timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import format_datetime, formataddr, parsedate_to_datetime

import read_outlook
from read_outlook import (
    OL_MAIL, LOCAL_TZ, OutlookError, mail_id, recipient_address, smtp_address,
    thread_fields,
)

# .eml 序列化后的单封上限（ADR-0037 决定 9）。
MAX_EML_BYTES = 25 * 1024 * 1024

# KB 根下的资源目录名（KB 布局的既有约定）。
RESOURCES = "resources"

# 主题在文件名里的最大字符数（ADR-0037 决定 5）。
SUBJECT_CAP = 60

# Windows 文件名禁字符加两类空白，统一换成下划线。
INVALID_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]')

# 索引表的固定列（ADR-0037 决定 8）。
INDEX_COLUMNS = ("标题", "发件人", "收件人", "时间", "保存路径", "摘要", "线程", "备注")

# MAPI 属性 PR_TRANSPORT_MESSAGE_HEADERS：收信时留下的原始互联网头。
PR_TRANSPORT_HEADERS = "http://schemas.microsoft.com/mapi/proptag/0x007D001F"


def sanitized(text, cap):
    """文件名净化：禁字符与空白换下划线、掐头尾、截长；空了给「无主题」。"""
    cleaned = INVALID_CHARS.sub("_", str(text or "")).strip(". ")
    if len(cleaned) > cap:
        cleaned = cleaned[:cap].strip(". ")
    return cleaned or "无主题"


def flatten(text):
    """索引单元格的一行化：竖线转义、换行压空格；空了给占位符。"""
    flat = re.sub(r"\s*\n\s*", " ", str(text or ""))
    flat = flat.replace("|", "\\|").strip()
    return flat if flat else "—"


def index_row(cells):
    """一行索引：八个格子，竖线包裹。"""
    return "| " + " | ".join(flatten(cell) for cell in cells) + " |"


def index_path_for(kb_root, month_stamp):
    """某月的索引文件路径，如 `<kbRoot>/resources/mail-index/mails202609.md`。"""
    return os.path.join(kb_root, RESOURCES, "mail-index", f"mails{month_stamp}.md")


def ensure_index(index_path, month_stamp):
    """索引文件不存在就带头创建（当月首封归档，ADR-0037 决定 4）。"""
    if os.path.exists(index_path):
        return
    os.makedirs(os.path.dirname(index_path), exist_ok=True)
    header = "\n".join([
        f"# 邮件归档 {month_stamp[:4]}-{month_stamp[4:]}",
        "",
        "| " + " | ".join(INDEX_COLUMNS) + " |",
        "|---|" + "---|" * (len(INDEX_COLUMNS) - 1),
        "",
    ])
    with open(index_path, "w", encoding="utf-8") as handle:
        handle.write(header)


def append_index_row(index_path, row):
    """往索引末尾追加一行：读旧全文 → 写临时副本 → os.replace 原子上位，
    中途崩溃也不会把已有行截断在半路（决定 7 的一致性保证靠它兜底）。"""
    with open(index_path, "r", encoding="utf-8") as handle:
        current = handle.read()
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(index_path) or ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(current.rstrip("\n") + "\n" + row + "\n")
        os.replace(tmp_path, index_path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def recipients_of(item):
    """
    收件人完整列表（ADR-0037 决定 8）：(主送对, 抄送对) 二元组，各是
    (显示名, 地址) 对的序列。地址换不出 SMTP（X.500 原样）时只留名字——
    索引是给人扫的；.eml 头按主送/抄送分写 To/Cc（评审 2026-09-30）。
    """
    to_pairs = []
    cc_pairs = []
    for recipient in item.Recipients:
        kind = getattr(recipient, "Type", 0)
        name = str(getattr(recipient, "Name", "") or "")
        address = recipient_address(recipient)
        display = name if name else address
        if not display:
            continue
        pair = (display, address if "@" in address else "")
        if kind == 1:
            to_pairs.append(pair)
        elif kind == 2:
            cc_pairs.append(pair)
    return to_pairs, cc_pairs


def recipients_cell(pairs):
    """索引「收件人」格：显示名顿号相连，重名去重保序。"""
    seen = []
    for name, _ in pairs:
        if name not in seen:
            seen.append(name)
    return "、".join(seen)


def message_id_of(item):
    """从传输头里抠 Message-ID；没有就算了——归档不强求完美线程。"""
    try:
        headers = item.PropertyAccessor.GetProperty(PR_TRANSPORT_HEADERS)
    except Exception:
        return None
    if not isinstance(headers, str):
        return None
    match = re.search(r"(?mi)^Message-ID:\s*(<[^>\s]+>)", headers)
    return match.group(1) if match else None


def mime_pair_of(filename):
    """按扩展名猜 MIME 类型；猜不出按二进制流处理。"""
    main, sub = mimetypes.guess_type(filename or "")
    if main is None or sub is None:
        return "application", "octet-stream"
    return main, sub


def header_of(parsed, name):
    """
    从 .msg 内嵌的传输头（parsed.header）里取原始值；没有返回 None。
    传输头是 Outlook 收信时留在信封上的原始互联网头，解码保真——而
    extract_msg 的结构化字段（subject 等）会把 GBK 流误解成 Latin-1。
    折叠的多行头展平成单行；相邻编码字（?= =?）之间的空白是折叠痕迹，
    语义上应不存在，不还原它解码后就多个伪空格（「进展 同步」）。
    """
    header = getattr(parsed, "header", None)
    if header is None:
        return None
    try:
        value = header.get(name)
    except Exception:
        return None
    if not value:
        return None
    flat = re.sub(r"\r?\n\s+", " ", str(value)).strip()
    return re.sub(r"\?=\s+=\?", "?==?", flat)


def cjk_ratio(text):
    """一段文本里 CJK 统一表意字的占比；空串为 0。"""
    if not text:
        return 0.0
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    return cjk / len(text)


def repair_mojibake(text):
    """
    extract_msg 对个别 .msg 的 GBK 正文流做 Latin-1 误解码（每个字节变成一个
    Latin-1 字符），这种损坏可无损反演：encode("latin-1") 还原原始字节，再按
    GBK 严格解码。三道闸门保证只在确凿时出手：能反向编码到 Latin-1（含真
    Unicode 字符的正确文本第一关就出局）、GBK 严格解码成功、解码后中文占比
    显著上升（纯英文 ASCII 在 GBK 下自映射，占比不涨，不受影响）。
    """
    if not text:
        return text
    try:
        raw = text.encode("latin-1")
    except UnicodeEncodeError:
        return text
    try:
        repaired = raw.decode("gbk")
    except UnicodeDecodeError:
        return text
    if repaired == text:
        return text
    if cjk_ratio(repaired) > 0.15 and cjk_ratio(repaired) >= 3 * max(cjk_ratio(text), 0.01):
        return repaired
    return text


def decode_body_bytes(data):
    """extract_msg 偶尔吐 bytes 的正文：UTF-8 优先，退而 GBK，最后替换符。"""
    if isinstance(data, bytes):
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return data.decode("gbk", "replace")
    return data


def msg_to_eml_bytes(msg_path, mail):
    """
    把 .msg 重组为 MIME .eml（ADR-0037 决定 1 的「本地转换」）。头字段优先用
    .msg 内嵌的传输头（收信时的线上真相，RFC 2047 编码词保真），缺哪项才退回
    COM 读到的权威值；正文与附件从 .msg 里取，正文过一道 Latin-1→GBK 乱码
    反演（extract_msg 的已知误解码）。内嵌图片（有 Content-ID 且正文是 HTML）
    挂 related，其余挂 attachment。任何一步不成抛 OutlookError
    ('conversion-failed')，由调用方降级 .msg。
    """
    try:
        import extract_msg
    except ImportError:
        raise OutlookError(
            "converter-missing",
            "缺少 extract_msg：pip install extract-msg 后可获得 .eml 归档；当前降级为 .msg。",
        ) from None

    try:
        with extract_msg.openMsg(msg_path) as parsed:
            html_body = repair_mojibake(decode_body_bytes(parsed.htmlBody or ""))
            plain_body = repair_mojibake(decode_body_bytes(parsed.body or ""))
            attachments = [(att.longFilename or att.shortFilename or "附件", att.data, att.contentId)
                           for att in parsed.attachments]
            # 传输头优先（勘误 2026-10-03）：结构化字段可能已被 extract_msg 误解码。
            carried = {name: header_of(parsed, name)
                       for name in ("Subject", "From", "To", "Cc", "Date", "Message-ID")}
    except OutlookError:
        raise
    except Exception as error:
        raise OutlookError("conversion-failed", f".msg 重组失败：{error}") from error

    root = EmailMessage(policy=policy.SMTP)
    # 头组装、正文挂载、附件循环到序列化整体纳入同一层保护（评审 2026-09-30）：
    # 组件期的任何普通异常都统一翻译成 conversion-failed，保住 .msg 兜底的承诺，
    # 而不是让原生报错绕过分类直落 failed 桶。
    try:
        root["Subject"] = carried["Subject"] or mail["subject"]
        if carried["From"]:
            root["From"] = carried["From"]
        else:
            name, address = mail["sender"]
            # X.500 型地址（Exchange 内部发件人）不是合法 addr-spec，只写显示名。
            root["From"] = formataddr((name, address)) if "@" in address else (name or address)
        for header, pairs in (("To", mail["to"]), ("Cc", mail["cc"])):
            if carried[header]:
                root[header] = carried[header]
                continue
            values = [formataddr((pair_name, pair_address)) if pair_address else pair_name
                      for pair_name, pair_address in pairs]
            if values:
                root[header] = ", ".join(values)
        root["Date"] = carried["Date"] or format_datetime(mail["received"])
        message_id = carried["Message-ID"] or mail["messageId"]
        if message_id:
            root["Message-ID"] = message_id

        if html_body:
            root.set_content(plain_body, subtype="plain")
            root.add_alternative(html_body, subtype="html")
        else:
            root.set_content(plain_body, subtype="plain")

        # 内嵌图片挂到 text/html 所在的 multipart/related 子件上（官方配方）——
        # root 此时已是 multipart/alternative，直接 add_related 会把图片挂成
        # 第三个兄弟分支，严格客户端解析 cid: 时找不到图。
        html_part = root.get_payload()[-1] if html_body else None
        for filename, data, content_id in attachments:
            main, sub = mime_pair_of(filename)
            kwargs = {"filename": filename}
            if content_id and html_body:
                html_part.add_related(data, maintype=main, subtype=sub, cid=f"<{content_id.lstrip('<>')}>", **kwargs)
            else:
                root.add_attachment(data, maintype=main, subtype=sub, **kwargs)

        return root.as_bytes()
    except OutlookError:
        raise
    except Exception as error:
        raise OutlookError("conversion-failed", f".eml 重组失败：{error}") from error


def existing_identity(path):
    """
    既有 .eml 的验身三元组的可比较形状：(主题, 发件地址, 收件分钟戳)。
    解析不了（损坏、截断）返回 None——调用方按「同一封」保守处理。
    """
    try:
        with open(path, "rb") as handle:
            head = handle.read(65536)
        parsed = BytesParser(policy=policy.default).parsebytes(head, headersonly=True)
        date_value = parsed.get("Date")
        # Date 头是 RFC 2822 形状（如 "Tue, 30 Sep 2026 10:30:00 +0800"），
        # 不是我们自己写的 ISO 形状——得用 parsedate_to_datetime 解析，
        # 否则这里的防撞比对永远解析失败、恒走「不同一封」误判分支。
        try:
            moment = parsedate_to_datetime(str(date_value)) if date_value else None
        except (TypeError, ValueError):
            moment = None
        address = ""
        from_value = parsed.get("From") or ""
        match = re.search(r"<([^>]+@[^>]+)>", str(from_value))
        if match:
            address = match.group(1).lower()
        return (str(parsed.get("Subject") or ""), address, moment.strftime("%Y%m%d%H%M") if moment else "")
    except Exception:
        return None


def same_mail(existing, mail):
    """既有件与本封是不是同一封：主题、发件地址、收件分钟戳三者皆同才算。
    主题比较压缩空白——.eml 主题现取自传输头，与 COM 值可能差折叠空白。"""
    if existing is None:
        return True
    subject, address, minute = existing
    squash = lambda value: re.sub(r"\s+", "", str(value or ""))
    return (squash(subject) == squash(mail["subject"])
            and (address == "" or address == mail["sender"][1].lower())
            and (minute == "" or minute == mail["received"].strftime("%Y%m%d%H%M")))


def archive_one(ns, kb_root, entry_id, summary, outcome, warned):
    """归档一封：读属性 → 导出 .msg → 重组 .eml → 落盘 → 追加索引行。"""
    try:
        item = ns.GetItemFromID(entry_id)
    except Exception:
        outcome["missing"].append(entry_id)
        return
    if getattr(item, "Class", None) != OL_MAIL:
        outcome["skipped"].append({"id": entry_id, "reason": "不是邮件项（会议邀请等），跳过"})
        return

    received = read_outlook.as_aware(getattr(item, "ReceivedTime", None))
    if received is None:
        outcome["skipped"].append({"id": entry_id, "reason": "读不到收件时间，无法定位月份"})
        return
    received_at = received.astimezone(timezone.utc).isoformat()
    local = received.astimezone(LOCAL_TZ)
    sender_fallback = str(getattr(item, "SenderEmailAddress", "") or "")
    sender_address = smtp_address(item, sender_fallback)
    sender_name = str(getattr(item, "SenderName", "") or "")
    subject = str(getattr(item, "Subject", "") or "")
    _, conversation_topic = thread_fields(item)
    to_pairs, cc_pairs = recipients_of(item)
    mail = {
        "subject": subject,
        "sender": (sender_name or sender_address, sender_address),
        "to": to_pairs,
        "cc": cc_pairs,
        "received": local,
        "messageId": message_id_of(item),
    }
    identity = mail_id(received_at, sender_address, subject)

    # 导出 .msg 到临时目录：COM 只认这条路（ADR-0037 决定 1）。
    temp_dir = tempfile.mkdtemp(prefix="yantao-archive-")
    try:
        msg_path = os.path.join(temp_dir, "original.msg")
        item.SaveAs(os.path.abspath(msg_path), 3)
        try:
            eml_bytes = msg_to_eml_bytes(msg_path, mail)
            extension, remark, fmt = ".eml", "", "eml"
        except OutlookError as error:
            if error.kind != "converter-missing":
                outcome["warnings"].append(f"{subject or '（无主题）'}：{error.message}（已降级为 .msg）")
            elif not warned.get("converter"):
                warned["converter"] = True
                outcome["warnings"].append(error.message)
            extension, remark, fmt = ".msg", "msg 兜底", "msg"
            with open(msg_path, "rb") as handle:
                eml_bytes = handle.read()

        if len(eml_bytes) > MAX_EML_BYTES:
            month_stamp = local.strftime("%Y%m")
            index_path = index_path_for(kb_root, month_stamp)
            ensure_index(index_path, month_stamp)
            append_index_row(index_path, index_row([
                subject, mail["sender"][0], recipients_cell(to_pairs + cc_pairs),
                local.strftime("%Y-%m-%d %H:%M"), "—", summary,
                conversation_topic, "过大未存",
            ]))
            outcome["oversized"].append({"id": identity, "entryId": entry_id, "title": subject or "（无主题）"})
            return

        base = f"{local.strftime('%Y-%m-%d_%H%M')}_{sanitized(subject, SUBJECT_CAP)}_{sanitized(mail['sender'][0], 80)}"
        month_dir = os.path.join(kb_root, RESOURCES, "mails", local.strftime("%Y"), local.strftime("%m"))
        os.makedirs(month_dir, exist_ok=True)
        target = os.path.join(month_dir, base + extension)
        if os.path.exists(target):
            # 同名先验明正身（ADR-0037 决定 5/6）：同一封即幂等跳过，确属
            # 另一封才追加短哈希。.msg 兜底件验不了身，按已归档保守处理。
            is_same = fmt == "msg" or same_mail(existing_identity(target), mail)
            if is_same:
                outcome["skipped"].append({"id": entry_id, "reason": "已归档过（同名同信），跳过"})
                return
            target = os.path.join(month_dir, f"{base}-{identity[:8]}{extension}")
            if os.path.exists(target):
                outcome["skipped"].append({"id": entry_id, "reason": "已归档过（短哈希同名），跳过"})
                return
        with open(target, "wb") as handle:
            handle.write(eml_bytes)

        # 落盘成功立刻追加索引行（决定 7）：这对（文件＋行）从此自洽。
        relative = os.path.relpath(target, os.path.join(kb_root, RESOURCES)).replace(os.sep, "/")
        month_stamp = local.strftime("%Y%m")
        index_path = index_path_for(kb_root, month_stamp)
        ensure_index(index_path, month_stamp)
        append_index_row(index_path, index_row([
            subject, mail["sender"][0], recipients_cell(to_pairs + cc_pairs),
            local.strftime("%Y-%m-%d %H:%M"), relative, summary,
            conversation_topic, remark,
        ]))
        outcome["saved"].append({"id": identity, "entryId": entry_id, "path": relative, "format": fmt, "remark": remark})
    finally:
        try:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


def archive_messages(kb_root, mails):
    """
    归档一批：逐封串行，单封失败不拖垮整批（ADR-0037 决定 7）。
    `mails` 每项 {entryId, summary}——entryId 定位 Outlook 里的原件，
    summary 是分析阶段的摘要，落索引「摘要」列。返回分桶结果：
    saved/oversized/skipped 各带明细，missing 是 EntryID 列表，failed 是
    {id, message}，warnings 是给人看的整批提示。
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

    outcome = {"saved": [], "oversized": [], "skipped": [], "missing": [], "failed": [], "warnings": []}
    warned = {}
    for entry in mails:
        entry_id = str((entry or {}).get("entryId") or "")
        summary = str((entry or {}).get("summary") or "")
        if not entry_id:
            continue
        try:
            archive_one(ns, kb_root, entry_id, summary, outcome, warned)
        except Exception as error:
            outcome["failed"].append({"id": entry_id, "message": str(error)})
    return outcome
