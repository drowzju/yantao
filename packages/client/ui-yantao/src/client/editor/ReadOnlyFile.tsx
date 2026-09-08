/**
 * The read-only file view: 资源 originals are shown, never edited (their
 * shadow note is the editable surface), so this pane has no textarea and no
 * save path at all — it only reads.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { FileReader } from '../remote.ts'
import { remoteMessage } from '../remote.ts'

/** Read-only view props. */
export interface ReadOnlyFileProps {
  /** KB-relative path of the shown file. */
  readonly path: string
  /** Read the file's content. */
  readonly read: FileReader
}

const wrapStyle = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 13,
} as const

const bannerStyle = { padding: '4px 8px', background: '#f1f0ec', color: '#6b6455' } as const

const errorStyle = { padding: '4px 8px', background: '#fbe9e7', color: '#b4453a' } as const

const preStyle = {
  flex: 1,
  minHeight: 0,
  margin: 0,
  padding: 8,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  fontFamily: 'ui-monospace, Consolas, monospace',
  fontSize: 12,
} as const

/**
 * Show one KB file read-only.
 * @param props - see {@link ReadOnlyFileProps}.
 * @returns the read-only element.
 */
export function ReadOnlyFile({ path, read }: ReadOnlyFileProps): ReactElement {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The loader is a fresh closure on every render (inject face), so the
  // mount-per-path effect reads it through a ref.
  const latest = useRef(read)
  latest.current = read

  useEffect(() => {
    let stale = false
    setContent(null)
    setError(null)
    latest.current(path).then(
      (text) => { if (!stale) setContent(text) },
      (failure: unknown) => { if (!stale) setError(remoteMessage(failure)) },
    )
    return () => {
      stale = true
    }
  }, [path])

  return (
    <div style={wrapStyle}>
      <div style={bannerStyle}>只读（原始资源不改写，编辑其影子笔记）</div>
      {error !== null && <div style={errorStyle}>{error}</div>}
      <pre style={preStyle} data-readonly="true">{content ?? ''}</pre>
    </div>
  )
}
