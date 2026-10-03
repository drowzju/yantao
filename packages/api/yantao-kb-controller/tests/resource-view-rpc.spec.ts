import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let ctx: Context
let fiber: { dispose(): Promise<void> }

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-view-'))
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return kbRoot
    },
    get configured(): boolean {
      return true
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  ctx.provide('skills', { get: async () => undefined } as never)
  ctx.provide('tools', { register: () => {} } as never)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

async function seed(relative: string, content: Uint8Array | string): Promise<void> {
  const target = join(kbRoot, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content)
}

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

describe('yantaoKb.readResourceView (ADR-0046 决定 3)', () => {
  it('answers a .pdf with base64 bytes and its size', async () => {
    const pdf = tinyPdf('View Hello')
    await seed('resources/hello.pdf', pdf)
    const view = await ctx.yantaoKbController.readResourceView('resources/hello.pdf')
    expect(view).toEqual({
      kind: 'pdf',
      path: 'resources/hello.pdf',
      base64: pdf.toString('base64'),
      size: pdf.length,
    })
  })

  it('answers an .html file with its raw text', async () => {
    await seed('resources/剪藏.html', '<html><body><h1>标题</h1></body></html>')
    const view = await ctx.yantaoKbController.readResourceView('resources/剪藏.html')
    expect(view).toEqual({ kind: 'html', path: 'resources/剪藏.html', content: '<html><body><h1>标题</h1></body></html>' })
  })

  it('answers an .eml with the parsed mail and an attachment listing without content', async () => {
    const eml = [
      'From: 张三 <zhang@example.com>',
      'Subject: 周报',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="BOUND"',
      '',
      '--BOUND',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>正文</p>',
      '--BOUND',
      'Content-Type: application/pdf; name="报告.pdf"',
      'Content-Disposition: attachment; filename="报告.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('%PDF-x').toString('base64'),
      '--BOUND--',
      '',
    ].join('\r\n')
    await seed('resources/邮件.eml', eml)
    const view = await ctx.yantaoKbController.readResourceView('resources/邮件.eml')
    if (view.kind !== 'eml') throw new Error(`预期 eml 视图，收到 ${view.kind}`)
    expect(view.subject).toBe('周报')
    expect(view.html).toContain('<p>正文</p>')
    expect(view.attachments).toEqual([{ name: '报告.pdf', contentType: 'application/pdf', size: 6 }])
  })

  it('answers any other text file with the text kind', async () => {
    await seed('resources/笔记.txt', '纯文本')
    const view = await ctx.yantaoKbController.readResourceView('resources/笔记.txt')
    expect(view).toEqual({ kind: 'text', path: 'resources/笔记.txt', content: '纯文本' })
  })

  it('keeps the binary refusal for other NUL-bearing files', async () => {
    await seed('resources/照片.png', new Uint8Array([0x50, 0x4b, 0x00, 0x03]))
    await expect(ctx.yantaoKbController.readResourceView('resources/照片.png')).rejects.toThrow(/二进制文件/)
  })

  it('reports a missing file as not-found', async () => {
    await expect(ctx.yantaoKbController.readResourceView('resources/不存在.txt')).rejects.toThrow(/找不到知识库文件/)
  })
})
