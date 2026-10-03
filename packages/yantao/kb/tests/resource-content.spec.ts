import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readResource } from '../src/core.ts'
import { readCitedEntries } from '../src/cited.ts'
import { extractPdfText, parseEml, renderEmlText } from '../src/resource-content.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-resource-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** Build one minimal-but-valid single-page PDF whose page prints the given text. */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const header = '%PDF-1.4\n'
  let body = ''
  const offsets: number[] = []
  let position = header.length
  objects.forEach((object, index) => {
    offsets.push(position)
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`
    body += chunk
    position += chunk.length
  })
  const xrefStart = position
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(header + body + xref + trailer, 'latin1')
}

/** One two-part MIME mail with a base64 attachment. */
function sampleEml(): string {
  return [
    'From: 张三 <zhang@example.com>',
    'To: 李四 <li@example.com>',
    'Subject: 周报第 37 周',
    'Date: Tue, 15 Sep 2026 08:30:00 +0800',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="BOUND"',
    '',
    '--BOUND',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    '本周完成了渲染器。',
    '',
    '--BOUND',
    'Content-Type: application/pdf; name="报告.pdf"',
    'Content-Disposition: attachment; filename="报告.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-fake').toString('base64'),
    '',
    '--BOUND--',
    '',
  ].join('\r\n')
}

describe('extractPdfText', () => {
  it('extracts the text of a minimal PDF', async () => {
    const text = await extractPdfText(new Uint8Array(tinyPdf('Hello Yantao')))
    expect(text).toContain('Hello Yantao')
  })

  it('raises a KbError on garbage bytes instead of returning half-content', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x00, 0xff])
    await expect(extractPdfText(garbage)).rejects.toThrow(/PDF 文本抽取失败/)
  })
})

describe('parseEml', () => {
  it('parses headline fields, body and the attachment listing', async () => {
    const mail = await parseEml(new Uint8Array(Buffer.from(sampleEml(), 'utf8')))
    expect(mail.subject).toBe('周报第 37 周')
    expect(mail.from).toContain('zhang@example.com')
    expect(mail.to).toContain('li@example.com')
    expect(mail.text).toContain('本周完成了渲染器。')
    expect(mail.attachments).toEqual([
      { name: '报告.pdf', contentType: 'application/pdf', size: 9 },
    ])
  })
})

describe('renderEmlText', () => {
  it('renders the headline block above the plain-text body', () => {
    const text = renderEmlText({
      subject: '周报',
      from: '张三 <zhang@example.com>',
      date: '2026-09-15T00:30:00.000Z',
      text: '正文',
      attachments: [{ name: '报告.pdf', contentType: 'application/pdf', size: 10 }],
    })
    expect(text).toContain('主题：周报')
    expect(text).toContain('发件人：张三 <zhang@example.com>')
    expect(text).toContain('附件（1）：报告.pdf (application/pdf, 10 字节)')
    expect(text.endsWith('正文')).toBe(true)
  })

  it('marks an HTML-only mail instead of handing the model markup', () => {
    const text = renderEmlText({ html: '<p>hi</p>', attachments: [] })
    expect(text).toContain('(仅有 HTML 正文)')
    expect(text).not.toContain('<p>')
  })
})

describe('readResource transpilation (ADR-0046)', () => {
  it('answers a .pdf with its extracted text', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', 'hello.pdf'), tinyPdf('Hello Yantao'))
    const result = await readResource(kbRoot, 'resources/hello.pdf')
    expect(result).toMatchObject({ kind: 'file', path: 'resources/hello.pdf' })
    if (result.kind === 'file') expect(result.content).toContain('Hello Yantao')
  })

  it('answers a .eml with headline plus body, never raw MIME', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', '邮件.eml'), sampleEml(), 'utf8')
    const result = await readResource(kbRoot, 'resources/邮件.eml')
    expect(result).toMatchObject({ kind: 'file', path: 'resources/邮件.eml' })
    if (result.kind === 'file') {
      expect(result.content).toContain('主题：周报第 37 周')
      expect(result.content).toContain('本周完成了渲染器。')
      expect(result.content).not.toContain('multipart/mixed')
    }
  })

  it('falls back to the binary refusal when a .pdf cannot be transpiled', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', 'broken.pdf'), new Uint8Array([0x25, 0x50, 0x44, 0x00, 0x01]))
    await expect(readResource(kbRoot, 'resources/broken.pdf')).rejects.toThrow(/二进制文件（5 字节）.*抽取失败/s)
  })

  it('still refuses other NUL-bearing binaries verbatim', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', '照片.png'), new Uint8Array([0x50, 0x4b, 0x00, 0x03]))
    await expect(readResource(kbRoot, 'resources/照片.png')).rejects.toThrow(/二进制文件（4 字节）/)
  })
})

describe('citation pipeline transpilation (ADR-0046 决定 2)', () => {
  it('carries extracted text for a cited .pdf and a placeholder for a broken one', async () => {
    await mkdir(join(kbRoot, 'resources'), { recursive: true })
    await writeFile(join(kbRoot, 'resources', 'good.pdf'), tinyPdf('Cited Hello'))
    await writeFile(join(kbRoot, 'resources', 'bad.pdf'), new Uint8Array([0x00, 0x01, 0x00, 0x02]))
    const cited = await readCitedEntries(kbRoot, ['resources/good.pdf', 'resources/bad.pdf'])
    expect(cited[0]).toMatchObject({ kind: 'file', path: 'resources/good.pdf' })
    if (cited[0]?.kind === 'file') expect(cited[0].content).toContain('Cited Hello')
    expect(cited[1]).toMatchObject({ kind: 'binary', path: 'resources/bad.pdf' })
  })
})
