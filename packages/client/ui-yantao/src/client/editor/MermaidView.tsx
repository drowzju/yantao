/**
 * One ```mermaid fence rendered live (ADR-0048 决定 4).
 *
 * The library rides a dynamic import, so it lands in its own chunk and a
 * document without diagrams never pays for it — the ~3.5 MB objection that
 * once deferred mermaid support died with the lazy boundary. Rendering runs
 * inside a sandboxed iframe on an opaque origin (ADR-0046's frame
 * architecture): the SVG mermaid emits under `securityLevel: 'strict'` is
 * escaped markup, but the frame keeps whatever slips through away from the
 * workbench's origin, and the measuring script inside can post nothing but
 * its own height.
 *
 * Height negotiation: the frame reports `scrollHeight` through postMessage
 * (ResizeObserver catches re-layouts), the parent clamps it to sane bounds
 * and sizes the iframe. Without a script inside there is no honest way to
 * size a diagram, hence `allow-scripts` — same trade ADR-0046 决定 3 struck
 * for HTML previews, and the origin is opaque either way.
 *
 * Theme: the library renders in the workbench's scheme — dark when the
 * presenter's `body[data-ds-dark-theme]` toggle is on (ADR-0048 落地注记),
 * watched through a MutationObserver so a live scheme switch re-renders every
 * mounted diagram. The old drawing stays visible until the redraw lands.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Mermaid } from 'mermaid'
import { DARK_ATTRIBUTE } from '../frame/theme-presenter.ts'

/**
 * Whether the workbench is currently in its dark scheme, per the one body
 * attribute the theme presenter owns.
 * @returns true when the dark palette is active.
 */
function isDarkScheme(): boolean {
  return typeof document !== 'undefined' && document.body.hasAttribute(DARK_ATTRIBUTE)
}

/** The sandbox: scripts run for the measurer, privileges stay zero (opaque origin). */
const MERMAID_SANDBOX = 'allow-scripts allow-popups allow-forms'

/** The message type the frame's measurer posts; anything else is ignored. */
const HEIGHT_MESSAGE = 'yantao:mermaid-height'

/** Height clamps: tall enough for a one-node graph, short enough to scroll honestly. */
const MIN_HEIGHT = 60
const MAX_HEIGHT = 4000

/** The dynamically-imported library, imported once per session. */
let mermaidPromise: Promise<Mermaid> | null = null

/**
 * Load mermaid on first use and pin its config to the current scheme.
 * `initialize` is idempotent and cheap, so every call re-pins — a scheme
 * switch between renders lands on the next `render`.
 * @param dark - whether the workbench's dark palette is active.
 * @returns The initialized library face.
 */
function loadMermaid(dark: boolean): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then(module => module.default)
  return mermaidPromise.then((mermaid) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
    return mermaid
  })
}

/** Render ids must be unique per call; a monotonic counter is enough. */
let renderSeq = 0

/** The frame's document: the SVG plus the height reporter. */
function frameDocument(svg: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'html,body{margin:0;padding:0;background:transparent}',
    'svg{max-width:100%;height:auto;display:block;margin:0 auto}',
    '</style></head><body>', svg,
    '<script>',
    'var post=function(){parent.postMessage({type:', JSON.stringify(HEIGHT_MESSAGE),
    ',height:document.documentElement.scrollHeight},"*")};',
    'if(typeof ResizeObserver==="function"){new ResizeObserver(post).observe(document.documentElement)}',
    'post()',
    '</script></body></html>',
  ].join('')
}

/** Props: the fence's code, exactly as the grammar handed it over. */
export interface MermaidBlockProps {
  /** The mermaid source to render. */
  readonly code: string
}

/**
 * Render one mermaid diagram in place of its fence.
 * @param props - see {@link MermaidBlockProps}.
 * @returns The framed diagram, the pending source, or the failure with its source.
 */
export function MermaidBlock({ code }: MermaidBlockProps): ReactElement {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  // The scheme flips when the presenter toggles its body attribute; the
  // subscription lives below, next to the render effect that consumes it.
  const [dark, setDark] = useState(isDarkScheme)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  // Track the presenter's palette toggle so a live scheme switch re-renders.
  useEffect(() => {
    const observer = new MutationObserver(() => { setDark(isDarkScheme()) })
    observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
    return () => { observer.disconnect() }
  }, [])

  // One render attempt per (source, scheme); a stale answer never lands.
  // The previous SVG stays on screen while the redraw runs — clearing it
  // would flash raw source at every scheme switch.
  useEffect(() => {
    let stale = false
    setError(null)
    loadMermaid(dark).then(mermaid => mermaid.render(`yantao-mermaid-${renderSeq++}`, code)).then((result) => {
      if (!stale) setSvg(result.svg)
    }).catch((failure: unknown) => {
      if (!stale) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => {
      stale = true
    }
  }, [code, dark])

  // Height negotiation: accept only messages from this frame, of our type,
  // carrying a finite number — then clamp.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      // postMessage data is attacker-shaped: cast wide, then narrow strictly.
      const data = event.data as { type?: unknown; height?: unknown } | null | undefined
      if (data?.type !== HEIGHT_MESSAGE || typeof data.height !== 'number' || !Number.isFinite(data.height)) return
      setHeight(Math.min(Math.max(Math.ceil(data.height), MIN_HEIGHT), MAX_HEIGHT))
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [])

  // The frame document rebuilds only with the SVG, not with every height tick.
  const doc = useMemo(() => svg === null ? null : frameDocument(svg), [svg])

  if (error !== null) {
    // A diagram that does not parse keeps its source visible — the author
    // must be able to see both the complaint and what drew it.
    return (
      <div data-mermaid-error="true" style={{ margin: '4px 0' }}>
        <div role="alert" style={{
          color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-body)', marginBottom: 2,
        }}>
          mermaid: {error}
        </div>
        <pre style={{
          margin: 0, padding: '6px 8px', overflowX: 'auto', borderRadius: 4,
          background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)',
          fontSize: 'var(--yt-type-label)', whiteSpace: 'pre-wrap',
        }}>{code}</pre>
      </div>
    )
  }
  if (doc === null) {
    // While the chunk loads, the fence shows as plain source — never blank.
    return (
      <pre data-mermaid-pending="true" style={{
        margin: '4px 0', padding: '6px 8px', overflowX: 'auto', borderRadius: 4,
        background: 'var(--yt-surface-raised)', border: '1px solid var(--yt-border-subtle)',
        fontSize: 'var(--yt-type-label)', whiteSpace: 'pre-wrap',
      }}>{code}</pre>
    )
  }
  return (
    <iframe
      ref={frameRef}
      title="mermaid"
      srcDoc={doc}
      sandbox={MERMAID_SANDBOX}
      style={{
        display: 'block', width: '100%', border: 0, margin: '4px 0',
        height: height ?? MIN_HEIGHT,
      }}
    />
  )
}
