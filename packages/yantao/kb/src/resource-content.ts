/**
 * Faithful transpilation of the resource formats a machine can read for you
 * (ADR-0046 决定 1): PDF pages become text, an `.eml` original becomes its
 * parsed headline fields, bodies and attachment listing. Both functions are
 * transport-free and take the file's bytes, so the agent read plane
 * (`readResource`), the mention pipeline (`cited.ts`) and the human render
 * plane (the controller's `readResourceView`) share one implementation.
 *
 * Failure is loud, never silent half-content: a transpilation that cannot
 * complete raises {@link KbError} and every caller falls back to the plain
 * binary refusal (ADR-0046 取舍台账第 4 行).
 * @module @deepseek-ai/dsh-yantao-kb/resource-content
 */

import { KbError } from './types.ts'

/** One attachment of a parsed `.eml`, as the listing reports it (no content). */
export interface EmlAttachment {
  /** The attachment's filename, when the mail carries one. */
  readonly name: string
  /** Its MIME type, e.g. `application/pdf`. */
  readonly contentType: string
  /** Its size in bytes. */
  readonly size: number
}

/** The parsed shape of one `.eml` original. */
export interface EmlParsed {
  readonly subject?: string
  readonly from?: string
  readonly to?: string
  /** The Date header, rendered by the parser. */
  readonly date?: string
  /** The `text/html` body when the mail carries one. */
  readonly html?: string
  /** The plain-text body — derived from the HTML one when no `text/plain` part exists. */
  readonly text?: string
  readonly attachments: readonly EmlAttachment[]
}

/**
 * Extract one PDF's text, page by page (pdfjs-dist legacy build — the same
 * library family the workbench's PDFium iframe renders with, so both faces
 * agree on how the file parses). Text items are joined honoring their EOL
 * flags; pages are separated by a blank line. No layout reconstruction:
 * tables flatten, formulas drop — that is 取舍台账第 1 行, not a defect to fix.
 * @param data - the PDF's complete bytes.
 * @returns the extracted text, pages in order.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  let text: string
  try {
    // Lazy import: pdfjs-dist is heavy and only this path pays for it. The
    // legacy build runs worker-free in Node; verbosity 0 keeps progress
    // chatter out of the host log.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // pdfjs 6 refuses a Buffer outright ("provide binary data as Uint8Array")
    // and *transfers* the ArrayBuffer it is handed (detaching the caller's
    // view) — hand it a private copy so the caller's bytes survive a failure.
    const plain = new Uint8Array(data.byteLength)
    plain.set(data)
    const loading = pdfjs.getDocument({
      data: plain,
      verbosity: 0,
      useWorkerFetch: false,
      disableFontFace: true,
    })
    const doc = await loading.promise
    try {
      const pages: string[] = []
      for (let index = 1; index <= doc.numPages; index += 1) {
        const page = await doc.getPage(index)
        const content = await page.getTextContent()
        let line = ''
        for (const item of content.items) {
          if (!('str' in item)) continue
          line += item.str
          if (item.hasEOL) line += '\n'
        }
        pages.push(line.trim())
      }
      text = pages.join('\n\n')
    } finally {
      await loading.destroy()
    }
  } catch (error) {
    throw new KbError('resource-extract-failed', `PDF 文本抽取失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return text
}

/**
 * Parse one `.eml` original into its headline fields, bodies and attachment
 * listing. The parser derives a plain-text body from an HTML-only mail, so
 * `text` is present for virtually every real mail.
 * @param data - the `.eml` file's complete bytes.
 * @returns the parsed mail.
 */
export async function parseEml(data: Uint8Array): Promise<EmlParsed> {
  let parsed: import('mailparser').ParsedMail
  try {
    const { simpleParser } = await import('mailparser')
    parsed = await simpleParser(Buffer.from(data))
  } catch (error) {
    throw new KbError('resource-extract-failed', `邮件解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
  // `from`/`to` are one address object or a list; the headline takes the
  // first group's rendered form either way. Each spread arm keeps its key
  // *absent* (not undefined-valued) — exactOptionalPropertyTypes is in force.
  const addressText = (value: import('mailparser').AddressObject | import('mailparser').AddressObject[] | undefined): string | undefined => {
    if (value === undefined) return undefined
    const head = Array.isArray(value) ? value[0] : value
    return typeof head?.text === 'string' && head.text !== '' ? head.text : undefined
  }
  const from = addressText(parsed.from)
  const to = addressText(parsed.to)
  return {
    ...(typeof parsed.subject === 'string' && parsed.subject !== '' ? { subject: parsed.subject } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(parsed.date !== undefined && !Number.isNaN(parsed.date.getTime()) ? { date: parsed.date.toISOString() } : {}),
    ...(typeof parsed.html === 'string' && parsed.html !== '' ? { html: parsed.html } : {}),
    ...(typeof parsed.text === 'string' && parsed.text !== '' ? { text: parsed.text } : {}),
    attachments: (Array.isArray(parsed.attachments) ? parsed.attachments : []).map(attachment => ({
      // Runtime-proofed with typeof guards (not optional chains): the
      // declared types promise these fields, but real-world mails miss them.
      name: typeof attachment.filename === 'string' && attachment.filename !== '' ? attachment.filename : '(未命名)',
      contentType: typeof attachment.contentType === 'string' && attachment.contentType !== '' ? attachment.contentType : 'application/octet-stream',
      size: Buffer.isBuffer(attachment.content) ? attachment.content.byteLength : 0,
    })),
  }
}

/**
 * Render one parsed mail as the agent-facing text: a headline block followed
 * by the plain-text body. The agent plane never carries the HTML body —
 * markup is noise to the model, and the human channel renders it properly.
 * @param mail - the parsed mail.
 * @returns the text one `kb_read_resource` on an `.eml` answers with.
 */
export function renderEmlText(mail: EmlParsed): string {
  const head: string[] = []
  if (mail.subject !== undefined) head.push(`主题：${mail.subject}`)
  if (mail.from !== undefined) head.push(`发件人：${mail.from}`)
  if (mail.to !== undefined) head.push(`收件人：${mail.to}`)
  if (mail.date !== undefined) head.push(`日期：${mail.date}`)
  if (mail.attachments.length > 0) {
    head.push(`附件（${mail.attachments.length}）：${mail.attachments.map(item => `${item.name} (${item.contentType}, ${item.size} 字节)`).join('；')}`)
  }
  const body = mail.text ?? (mail.html !== undefined ? '(仅有 HTML 正文)' : '(无正文)')
  return head.length === 0 ? body : `${head.join('\n')}\n\n${body}`
}
