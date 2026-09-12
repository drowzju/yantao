# -*- coding: utf-8 -*-
"""
电子书抽取能力的宿主入口（ADR-0021）：stdin 收一个 JSON 对象，stdout 回一个
JSON 对象——`{name, kbRoot, input, state}` 进，`{ok, result}` 或
`{ok: false, kind, message, hint}` 出。抽取本体在 `extract.py`（可独立命令行
运行），本脚本负责缓存幂等、路径校验和缺库自动安装：

- 缓存即幂等：`.yantao/extracts/<资源名>.json` 可读时直接回答 `cached: true`，
  不再跑抽取；重新抽取是人删缓存目录，不是加参数。
- 缺库（lib-missing）是机器的事，不是人的事：自动 `pip install` 对应包并重试
  一次，只有安装失败才把手动补救报给人。
- 抽取文本与 meta 写进知识库的 `.yantao/extracts/`（与迁移前同一位置，读书
  流程与树的隐藏名单不受影响）。
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

import extract
from extract import ExtractFailure, extract_document

# 与工作台侧一致的可抽取格式（ADR-0020）。
FORMATS = ("txt", "md", "pdf", "epub", "doc", "docx", "ppt", "pptx")

# 每个格式缺库时要装的 pip 包。doc/ppt 走 Office COM，包就是 COM 桥本身。
LIB_PACKAGES = {
    "pdf": "pypdf",
    "docx": "python-docx",
    "pptx": "python-pptx",
    "doc": "pywin32",
    "ppt": "pywin32",
}

HINTS = {
    "python-missing": "请安装 Python 3（安装时勾选 Add to PATH）。",
    "lib-missing": "请按格式安装对应库：pip install pypdf / ebooklib / python-docx / python-pptx / pywin32。",
    "no-text": "扫描版需要 OCR，当前版本不支持；可换一份文字版的文件。",
    "unreadable": "请先解除加密，或换一份完好的文件。",
    "input-missing": "请确认资源文件还在知识库的 resources/ 下。",
    "doc-unavailable": "请确认已安装 Word / PowerPoint 桌面版；或先把文件另存为 .docx / .pptx。",
    "unsupported": "目前支持 txt / md / pdf / epub / doc / docx / ppt / pptx。",
    "other": "请查看服务端日志了解详情。",
}


def emit(answer):
    """把协议答案写成一行 JSON 到 stdout，除它之外不输出任何内容。"""
    json.dump(answer, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()


def report(kind, message, hint=None):
    emit({"ok": False, "kind": kind, "message": message, "hint": hint or HINTS.get(kind, HINTS["other"])})


def sanitize_base(name):
    """与工作台侧 sanitizeFileName 同规则：资源名在登记时已清洗过，这里再走
    一遍是幂等的，只为让缓存路径和 Node 侧 extractPaths 算出的完全一致。"""
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", name).strip()
    cleaned = re.sub(r"[. ]+$", "", cleaned)
    return cleaned or "未命名"


def extract_paths(kb_root, resource_path):
    """与 Node 侧 extractPaths 同一推导：`.yantao/extracts/<资源名>.txt|.json`。"""
    base = sanitize_base(re.split(r"[\\/]", resource_path)[-1] or "")
    text_rel = f".yantao/extracts/{base}.txt"
    meta_rel = f".yantao/extracts/{base}.json"
    return text_rel, meta_rel, base


def read_cache(meta_path):
    """可读且自描述（format/chars 都在）的缓存才算命中。"""
    try:
        with open(meta_path, "r", encoding="utf-8") as handle:
            cached = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(cached, dict):
        return None
    fmt = cached.get("format")
    chars = cached.get("chars")
    if not isinstance(fmt, str) or not isinstance(chars, int):
        return None
    return {"format": fmt, "chars": chars}


def pip_install(pkg):
    """缺哪个装哪个；装不上由调用方报给人。"""
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", pkg],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main():
    try:
        request = json.loads(sys.stdin.read() or "{}")
    except ValueError as error:
        report("other", f"stdin 不是合法的 JSON：{error}")
        return
    if not isinstance(request, dict):
        report("other", "stdin 必须是一个 JSON 对象。")
        return

    kb_root = request.get("kbRoot") or ""
    caller_input = request.get("input") or {}
    if not isinstance(caller_input, dict):
        caller_input = {}
    path = caller_input.get("path") or ""

    if not kb_root or not isinstance(kb_root, str):
        report("other", "缺少知识库根目录（kbRoot）。")
        return
    if not path or not isinstance(path, str) or not path.startswith("resources/"):
        report("unsupported", f"只能抽取 resources/ 下的资源文件：{path}")
        return
    segments = path.split("/")
    if any(segment in ("", ".", "..") for segment in segments) or "\\" in path:
        report("input-missing", f"资源路径不合法：{path}")
        return

    text_rel, meta_rel, base = extract_paths(kb_root, path)
    meta_path = os.path.join(kb_root, *meta_rel.split("/"))

    cached = read_cache(meta_path)
    if cached is not None:
        emit({"ok": True, "result": {
            "extractPath": text_rel,
            "format": cached["format"],
            "chars": cached["chars"],
            "cached": True,
        }})
        return

    fmt = path.rsplit(".", 1)[-1].lower() if "." in os.path.basename(path) else ""
    if fmt not in FORMATS:
        report("unsupported", f"不支持抽取这种格式：{path}")
        return

    target = os.path.join(kb_root, *segments)
    try:
        try:
            text = extract_document(target, fmt)
        except ExtractFailure as failure:
            if failure.kind != "lib-missing" or fmt not in LIB_PACKAGES:
                raise
            # 缺库是机器的事：自动装上重试一次，装不上才报给人。
            try:
                pip_install(LIB_PACKAGES[fmt])
            except Exception:
                report("lib-missing",
                       f"缺少该格式所需的 Python 库（自动安装 {LIB_PACKAGES[fmt]} 没有成功）。",
                       f"请手动安装后再试：pip install {LIB_PACKAGES[fmt]}。")
                return
            text = extract_document(target, fmt)
    except ExtractFailure as failure:
        report(failure.kind, failure.message)
        return
    except Exception as error:
        report("other", f"抽取文档文本失败：{error}")
        return

    text_path = os.path.join(kb_root, *text_rel.split("/"))
    try:
        os.makedirs(os.path.dirname(text_path), exist_ok=True)
        with open(text_path, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        with open(meta_path, "w", encoding="utf-8") as handle:
            json.dump({
                "format": fmt,
                "chars": len(text),
                "extractedAt": datetime.now(timezone.utc).isoformat(),
                "source": path,
            }, handle, ensure_ascii=False, indent=2)
    except OSError as error:
        report("other", f"无法写入抽取缓存：{error}")
        return

    emit({"ok": True, "result": {
        "extractPath": text_rel,
        "format": fmt,
        "chars": len(text),
        "cached": False,
    }})


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
