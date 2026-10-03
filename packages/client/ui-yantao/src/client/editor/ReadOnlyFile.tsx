/**
 * The read-only file view: 资源 originals are shown, never edited (ADR-0020:
 * a resource is dumb raw material — thinking happens in entities), so this
 * pane has no textarea and no save path at all — it only reads.
 *
 * Since ADR-0046 the renderer is picked from the host's `readResourceView`
 * discriminator instead of sniffing extensions again client-side: plain text
 * keeps the `<pre>`, raw HTML renders in a scripting-but-powerless sandbox
 * iframe (opaque origin — no `allow-same-origin`), a PDF's base64 bytes
 * become a Blob URL for the built-in PDFium viewer, and a parsed `.eml`
 * renders headline fields, its HTML body under the same sandbox, and the
 * attachment listing (names only — content never crosses the RPC).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { KbResourceView } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { ResourceViewReader } from '../remote.ts'
import { remoteMessage } from '../remote.ts'
import type { WorkbenchT } from '../locales.ts'

/** Read-only view props. */
export interface ReadOnlyFileProps {
  /** KB-relative path of the shown file. */
  readonly path: string
  /** Load the file's render view (ADR-0046 决定 3). */
  readonly readView: ResourceViewReader
  readonly t: WorkbenchT
}

const wrapStyle = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 'var(--yt-type-body)',
} as const

const bannerStyle = {
  padding: '4px 8px',
  background: 'var(--yt-surface-secondary)',
  color: 'var(--yt-text-secondary)',
} as const

const errorStyle = { padding: '4px 8px', background: 'var(--yt-error-bg)', color: 'var(--yt-error)' } as const

const preStyle = {
  flex: 1,
  minHeight: 0,
  margin: 0,
  padding: 8,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  fontFamily: 'ui-monospace, Consolas, monospace',
  fontSize: 'var(--yt-type-label)',
} as const

const frameStyle = {
  flex: 1,
  minHeight: 0,
  border: 0,
  backgroundColor: '#ffffff',
} as const

const headGridStyle = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--yt-border-subtle)',
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  gap: '2px 10px',
  background: 'var(--yt-surface-secondary)',
  // A long 收件人 list folds into dozens of lines; uncapped it swallows the
  // pane and squeezes the body iframe (flex:1, minHeight:0) to zero height —
  // the mail shows headers but no body (ADR-0046 落地勘误之二). Scroll instead.
  maxHeight: 160,
  overflowY: 'auto',
} as const

const headKeyStyle = { color: 'var(--yt-text-secondary)' } as const

const attachmentRowStyle = {
  padding: '2px 8px',
  borderBottom: '1px solid var(--yt-border-subtle)',
  display: 'flex',
  gap: 8,
  alignItems: 'baseline',
} as const

/**
 * Decode one base64 payload into bytes (the PDF view's transport encoding).
 */
function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Turn one view's payload into the Blob the iframe consumes, or null while
 * the view is not of a Blob-backed kind. The HTML flavours carry an explicit
 * `charset=utf-8`: a sandboxed iframe sits on an opaque origin and inherits
 * no encoding from the workbench, so an untagged document would fall back to
 * the OS locale's legacy codepage (GBK on zh systems) and render mojibake
 * (ADR-0046 落地勘误).
 */
function blobOf(view: KbResourceView): Blob | null {
  switch (view.kind) {
    case 'pdf':
      return new Blob([base64Bytes(view.base64)], { type: 'application/pdf' })
    case 'html':
      return new Blob([view.content], { type: 'text/html;charset=utf-8' })
    case 'eml':
      return view.html === undefined ? null : new Blob([view.html], { type: 'text/html;charset=utf-8' })
    default:
      return null
  }
}

/** The sandbox for active-content frames: scripts run, privileges stay zero (ADR-0046 决定 3). */
const ACTIVE_CONTENT_SANDBOX = 'allow-scripts allow-popups allow-forms'

/** One headline row of a parsed mail's header block. */
function HeadRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <>
      <span style={headKeyStyle}>{label}</span>
      <span>{value}</span>
    </>
  )
}

/**
 * Show one KB file read-only.
 * @param props - see {@link ReadOnlyFileProps}.
 * @returns the read-only element.
 */
export function ReadOnlyFile({ path, readView, t }: ReadOnlyFileProps): ReactElement {
  const [view, setView] = useState<KbResourceView | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The loader is a fresh closure on every render (inject face), so the
  // mount-per-path effect reads it through a ref.
  const latest = useRef(readView)
  latest.current = readView

  useEffect(() => {
    let stale = false
    setView(null)
    setError(null)
    latest.current(path).then(
      (loaded) => { if (!stale) setView(loaded) },
      (failure: unknown) => { if (!stale) setError(remoteMessage(failure)) },
    )
    return () => {
      stale = true
    }
  }, [path])

  // The Blob URL lifecycle: created per view change, revoked on the way out.
  const blob = useMemo(() => view === null ? null : blobOf(view), [view])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (blob === null) {
      setUrl(null)
      return undefined
    }
    const created = URL.createObjectURL(blob)
    setUrl(created)
    return () => {
      URL.revokeObjectURL(created)
      setUrl(null)
    }
  }, [blob])

  return (
    <div style={wrapStyle}>
      <div style={bannerStyle}>
        <span>{t('readonly.note')}</span>
      </div>
      {error !== null && <div style={errorStyle}>{error}</div>}
      {view?.kind === 'pdf' && url !== null && (
        <iframe title={path} src={url} style={frameStyle} />
      )}
      {view?.kind === 'html' && url !== null && (
        <iframe title={path} src={url} sandbox={ACTIVE_CONTENT_SANDBOX} style={frameStyle} />
      )}
      {view?.kind === 'eml' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={headGridStyle}>
            {view.subject !== undefined && <HeadRow label="主题" value={view.subject} />}
            {view.from !== undefined && <HeadRow label="发件人" value={view.from} />}
            {view.to !== undefined && <HeadRow label="收件人" value={view.to} />}
            {view.date !== undefined && <HeadRow label="日期" value={view.date} />}
          </div>
          {view.attachments.length > 0 && (
            <div style={{ borderBottom: '1px solid var(--yt-border-subtle)' }}>
              <div style={{ ...attachmentRowStyle, color: 'var(--yt-text-secondary)' }}>{t('readonly.attachments')}</div>
              {view.attachments.map(attachment => (
                <div key={`${attachment.name}:${attachment.size}`} style={attachmentRowStyle}>
                  <span>{attachment.name}</span>
                  <span style={{ color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' }}>
                    {attachment.contentType} · {attachment.size} 字节
                  </span>
                </div>
              ))}
            </div>
          )}
          {view.html !== undefined && url !== null
            ? <iframe title={`${path} 正文`} src={url} sandbox={ACTIVE_CONTENT_SANDBOX} style={frameStyle} />
            : (
              <pre style={preStyle} data-readonly="true">{view.text ?? t('readonly.noBody')}</pre>
            )}
        </div>
      )}
      {view?.kind === 'text' && <pre style={preStyle} data-readonly="true">{view.content}</pre>}
    </div>
  )
}
