---
name: ebook
description: 把一份资源文件（pdf/epub/doc/docx/ppt/pptx/txt/md）抽成纯文本，缓存进知识库供读书项目分页读取。
disable-model-invocation: true
metadata:
  yantao:
    entry: scripts/entry.py
    runtime: python
    version: 1
    appliesTo:
      resource: ['.txt', '.md', '.pdf', '.epub', '.doc', '.docx', '.ppt', '.pptx']
---

# 电子书抽取能力

yantao 工作台的资源抽取能力（ADR-0020 建立，ADR-0021 迁移为能力目录）。它把
`resources/` 下的一份原始材料抽成纯文本，缓存到知识库的 `.yantao/extracts/` 下，
供读书项目（`kb_read_resource`）分页读取；缓存即幂等，重复应用同一资源直接命中。

## 执行契约

入口是 `scripts/entry.py`，由工作台以子进程调用：stdin 收一个 JSON 对象
`{name, kbRoot, input, state}`，stdout 回一个 JSON 对象。

- `input`：`{path}`——资源的 KB 相对路径，必须在 `resources/` 下。
- 成功：`{ok: true, result: {extractPath, format, chars, cached}}`，`extractPath`
  是抽取文本的 KB 相对路径（`.yantao/extracts/<资源名>.txt`），`cached` 为真时
  表示缓存命中、没有真正抽取。
- 失败：`{ok: false, kind, message, hint}`，kind ∈ python-missing / lib-missing /
  no-text / unreadable / input-missing / doc-unavailable / unsupported / other。
  缺库（lib-missing）时脚本会自动 `pip install` 对应包并重试一次，只有安装失败
  才报给人。

## 依赖（按格式，缺哪个装哪个）

  txt/md   无
  pdf      pip install pypdf
  epub     pip install ebooklib（缺失时退回 zipfile+html 内置解析）
  docx     pip install python-docx
  pptx     pip install python-pptx
  doc/ppt  pip install pywin32 + 已安装 Word / PowerPoint 桌面版（走 COM）

`scripts/extract.py` 也可以单独在命令行跑（`--format <fmt> --input <path>`），
便于脱离工作台排查。
