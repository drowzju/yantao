/**
 * The reading view of one KB markdown file (ADR-0014).
 *
 * The workbench opens a file here rather than in the raw textarea: the human
 * reads rendered markdown, and the YAML envelope — machine-written metadata,
 * not prose — folds into a one-line summary that opens into a small table.
 *
 * v2 makes two things in the reading view active:
 *
 * - **Task checkboxes.** `MarkdownText` renders them `disabled`, and a click on
 *   a disabled control is not dispatched at all, so the view re-enables them
 *   after each render and handles the click itself: the Nth rendered checkbox
 *   is the Nth `- [ ]` line of the source, and flipping it hands the whole new
 *   content to {@link MarkdownViewProps.onEdit}. The write is not this
 *   component's to make — the editor owns the draft and the conflict check.
 * - **Headings.** A collapsible outline that scrolls to a heading, matched by
 *   the same document-order rule.
 *
 * - **`[[…]]` links (v3).** Resolved targets render as links and open the file
 *   they name; unresolved ones keep their brackets, so a link that did not take
 *   is visible as such. What links *into* this file is listed in a 反向链接
 *   panel. Resolution itself is host-side (`yantaoKb.links`) — the client
 *   neither scans the KB nor guesses what a name means.
 *
 * - **Empty sections (v4).** A template-declared section with no text yet
 *   collapses to a `**name**（空）` placeholder line instead of a full-weight
 *   heading over nothing (docs/yantao/design.md §1), and headings pull onto
 *   the design ladder via `MarkdownView.module.css`. The outline is computed
 *   from the same collapsed text the body renders.
 *
 * - **Local images (v5, ADR-0048 一期).** `![…](…)` destinations that name
 *   files next to the document resolve like Obsidian's: the view collects the
 *   references, fetches each through `resolveImage` (base64 over the host RPC,
 *   ADR-0046's transport), and hands the renderer object URLs through the
 *   `imageSources` hook — the sanitizer stays byte-for-byte untouched, so a
 *   `blob:` URL can never ride the markdown path itself.
 *
 * - **Diagrams (v5, ADR-0048 决定 4).** A ```mermaid fence renders live once
 *   the message settles, through `MermaidBlock`'s lazy-loaded library and
 *   opaque-origin frame; while streaming it stays an honest code fence.
 *
 * Both ordinal mappings (checkboxes, headings) refuse when the counts disagree
 * rather than acting on the wrong line.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownDiagrams, MarkdownImageSources, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KbLinksResult, KbResourceBinary } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { MermaidBlock } from './MermaidView.tsx'
import {
  collapseEmptySections, fileDirOf, frontmatterSummary, headingOutline, linkPath, localImageRefs, renderWikiLinks,
  resolveLocalImagePath, restoreTableBreaks, splitFrontmatter, taskLines, toggleTask,
} from '../markdown.ts'
import type { WorkbenchT } from '../locales.ts'
import css from './MarkdownView.module.css'

/** Wrapping and typography, matching the editor's own column. */
const wrapStyle = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  fontFamily: 'var(--yt-font-ui)',
  fontSize: 'var(--yt-type-body)',
  overflowY: 'auto',
} as const

const barStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  borderBottom: '1px solid var(--yt-border-subtle)',
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-label)',
} as const

const toggleStyle = {
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-label)',
  padding: '1px 6px',
} as const

const tableStyle = {
  margin: '4px 8px 8px',
  borderCollapse: 'collapse',
  fontSize: 'var(--yt-type-label)',
} as const

const cellStyle = {
  borderBottom: '1px solid var(--yt-border-subtle)',
  padding: '2px 8px 2px 0',
  textAlign: 'left',
  verticalAlign: 'top',
  whiteSpace: 'pre-wrap',
} as const

/** The outline panel: pinned to the reading column's top-right corner. */
const outlineStyle = {
  position: 'absolute',
  top: 4,
  right: 8,
  maxHeight: '60%',
  overflowY: 'auto',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  padding: '4px 6px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  maxWidth: 220,
} as const

const outlineItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  borderWidth: 0,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-label)',
  padding: '1px 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const bodyStyle = { position: 'relative', flex: 1, minHeight: 0, padding: '8px 12px' } as const

/**
 * Loaded local images: KB path → object URL (ADR-0048 一期). Module-scoped so
 * every reading view shares one cache — reopening a tab must not re-fetch,
 * and eviction revokes the URL so the blob does not outlive its welcome.
 */
const imageUrlCache = new Map<string, string>()

/** Local images whose fetch already failed; never retried, keeping the preload effect loop-free. */
const failedImages = new Set<string>()

/** The image cache's FIFO ceiling. */
const IMAGE_CACHE_LIMIT = 128

/**
 * Decode one base64 payload into bytes — ADR-0046's transport encoding, the
 * same shape `ReadOnlyFile` decodes for PDFs (kept local: five lines, and the
 * two views evolve on different ADRs).
 */
function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Props: the file's content, and the one edit this view performs itself. */
export interface MarkdownViewProps {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** The file's full content, envelope included. */
  readonly content: string
  /**
   * Flip one task checkbox: receives the whole new content. The caller owns the
   * write (and the conflict check that goes with it).
   */
  readonly onEdit?: (content: string) => void
  /**
   * The checkbox-to-source mapping did not hold — callers fall back to the
   * source view rather than risk writing to the wrong line.
   */
  readonly onUnresolved?: () => void
  /** This file's `[[…]]` graph, computed host-side; absent until it arrives. */
  readonly links?: KbLinksResult | undefined
  /** Open another KB file (a link target, or a file that links here). */
  readonly onOpen?: (path: string) => void
  /** Hand this file to the desktop's own editor — "在 Obsidian 中打开" (ADR-0017). */
  readonly onOpenExternal?: () => void
  /**
   * The archive gesture (ADR-0041 决定 7) — the detail view's button, present
   * for entity files only: 归档 on an active entity, 还原 on an archived one.
   * Absent for every other file.
   */
  readonly archive?: {
    /** The flag now in effect; the button offers the opposite direction. */
    readonly archived: boolean
    /** True while the flip is in flight. */
    readonly busy: boolean
    /** Flip the flag through the host's RPC. */
    readonly onToggle: () => void
  } | undefined
  /**
   * This file's KB-relative path — the anchor local image references resolve
   * against (ADR-0048 一期). Absent in standalone use, and images stay
   * unresolved there.
   */
  readonly path?: string | undefined
  /**
   * Fetch one local image's bytes (ADR-0048 一期): KB-relative path in, base64
   * payload out. Absent when the embedder has no yantaoKb face.
   */
  readonly resolveImage?: ((kbPath: string) => Promise<KbResourceBinary>) | undefined
}

/**
 * Render one markdown file for reading.
 * @param props - see {@link MarkdownViewProps}.
 * @returns the reading view.
 */
/**
 * Render one markdown file for reading.
 * @param props - see {@link MarkdownViewProps}.
 * @returns the reading view.
 */
export function MarkdownView({
  t, content, onEdit, onUnresolved, links, onOpen, onOpenExternal, archive, path, resolveImage,
}: MarkdownViewProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [backlinksOpen, setBacklinksOpen] = useState(false)
  // Bumped whenever the image cache gains an entry (or a fetch definitively
  // fails): the `imageSources` memo below depends on it so freshly landed
  // URLs reach the renderer.
  const [imageEpoch, setImageEpoch] = useState(0)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const split = useMemo(() => splitFrontmatter(content), [content])
  const summary = useMemo(() => frontmatterSummary(split.fields), [split.fields])
  // Only the host knows what a target means; the view just renders its answer.
  // Empty template sections collapse first (design.md §1), and the outline is
  // taken from the same collapsed text the body renders — its ordinal-to-DOM
  // mapping must describe what is actually on screen.
  const body = useMemo(() => {
    let linked = split.body
    if (links !== undefined) {
      const resolved = new Map(links.outgoing
        .filter(link => link.path !== null)
        .map(link => [link.target, link.path as string]))
      linked = renderWikiLinks(split.body, target => resolved.get(target) ?? null)
    }
    return collapseEmptySections(restoreTableBreaks(linked))
  }, [split.body, links])
  const outline = useMemo(() => headingOutline(body), [body])

  // Preload the document's local images (ADR-0048 一期): each reference the
  // collector finds and the resolver normalizes gets one fetch through the
  // host RPC — cached or already-failed paths skip, so the effect stays
  // loop-free however often it reruns.
  useEffect(() => {
    if (path === undefined || resolveImage === undefined) return
    const dir = fileDirOf(path)
    let live = true
    for (const ref of localImageRefs(split.body)) {
      const kbPath = resolveLocalImagePath(dir, ref)
      if (kbPath === null || imageUrlCache.has(kbPath) || failedImages.has(kbPath)) continue
      resolveImage(kbPath).then((binary) => {
        if (!live) return
        imageUrlCache.set(kbPath, URL.createObjectURL(new Blob([base64Bytes(binary.base64)], { type: binary.mime })))
        while (imageUrlCache.size > IMAGE_CACHE_LIMIT) {
          const oldest = imageUrlCache.keys().next().value
          if (oldest === undefined) break
          URL.revokeObjectURL(imageUrlCache.get(oldest) ?? '')
          imageUrlCache.delete(oldest)
        }
        setImageEpoch(epoch => epoch + 1)
      }).catch(() => {
        if (!live) return
        failedImages.add(kbPath)
        setImageEpoch(epoch => epoch + 1)
      })
    }
    return () => { live = false }
  }, [path, resolveImage, split.body])

  // The renderer's image hook: a destination as written goes through the same
  // resolver the preloader used, so the two sides can never disagree about
  // what a reference names. Epoch in deps: a fresh cache entry must yield a
  // fresh object or MarkdownText's memo would keep the image-less render.
  const imageSources = useMemo<MarkdownImageSources | undefined>(() => {
    if (path === undefined) return undefined
    const dir = fileDirOf(path)
    return {
      resolve: (url) => {
        const kbPath = resolveLocalImagePath(dir, url)
        return kbPath === null ? undefined : imageUrlCache.get(kbPath)
      },
    }
  }, [path, imageEpoch])

  // ```mermaid fences go live on the settled pass; the hook object is a
  // constant so MarkdownText's memo never churns because of it.
  const diagrams = useMemo<MarkdownDiagrams>(() => ({ mermaid: MermaidBlock }), [])


  // MarkdownText renders task checkboxes disabled, and browsers do not
  // dispatch clicks on disabled controls — so the reading view would never see
  // one. Re-enable them after every render; React leaves the attribute alone
  // until the element itself is replaced.
  useEffect(() => {
    const root = bodyRef.current
    if (root === null) return
    for (const box of root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
      box.disabled = false
      box.style.cursor = 'pointer'
    }
  }, [content])

  const flip = (ordinal: number): void => {
    const next = toggleTask(content, ordinal)
    if (next === null || next === content) {
      onUnresolved?.()
      return
    }
    onEdit?.(next)
  }

  const onClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target
    // A rendered `[[…]]`: take it back from the browser and open the file.
    if (target instanceof HTMLAnchorElement) {
      const path = linkPath(target.getAttribute('href') ?? '')
      if (path !== null) {
        event.preventDefault()
        onOpen?.(path)
      }
      return
    }
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return
    const boxes = Array.from(bodyRef.current?.querySelectorAll('input[type=checkbox]') ?? [])
    const ordinal = boxes.indexOf(target)
    // The ordinal is only trustworthy when the rendered boxes and the source's
    // task lines agree one for one.
    if (ordinal < 0 || ordinal >= taskLines(content).length || boxes.length !== taskLines(content).length) {
      onUnresolved?.()
      return
    }
    flip(ordinal)
  }

  const gotoHeading = (ordinal: number): void => {
    const headings = bodyRef.current?.querySelectorAll('h1,h2,h3,h4,h5,h6')
    const target = headings?.[ordinal]
    if (target === undefined || headings === undefined || headings.length !== outline.length) {
      onUnresolved?.()
      return
    }
    target.scrollIntoView({ block: 'start' })
  }

  return (
    <div style={wrapStyle}>
      {(split.hasFrontmatter || outline.length > 1 || (links?.incoming.length ?? 0) > 0
        || onOpenExternal !== undefined || archive !== undefined) && (
        <div style={barStyle}>
          {split.hasFrontmatter && (
            <button
              type="button"
              style={toggleStyle}
              aria-expanded={open}
              onClick={() => { setOpen(current => !current) }}
            >
              {open ? t('md.collapseProps') : t('md.props')}
            </button>
          )}
          {split.hasFrontmatter && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {summary === '' ? t('md.empty') : summary}
            </span>
          )}
          {outline.length > 1 && (
            <button
              type="button"
              style={{ ...toggleStyle, marginLeft: split.hasFrontmatter ? undefined : 'auto' }}
              aria-expanded={outlineOpen}
              onClick={() => { setOutlineOpen(current => !current) }}
            >
              {outlineOpen ? t('md.collapseOutline') : t('md.outline')}
            </button>
          )}
          {onOpenExternal !== undefined && (
            <button
              type="button"
              style={{ ...toggleStyle, marginLeft: (links?.incoming.length ?? 0) > 0 ? undefined : 'auto' }}
              title={t('md.openExternallyTitle')}
              onClick={() => { onOpenExternal() }}
            >
              {t('md.openInObsidian')}
            </button>
          )}
          {archive !== undefined && (
            <button
              type="button"
              style={toggleStyle}
              disabled={archive.busy}
              data-archive-toggle="true"
              onClick={() => { archive.onToggle() }}
            >
              {archive.archived ? t('workbench.restore') : t('workbench.archive')}
            </button>
          )}
          {(links?.incoming.length ?? 0) > 0 && (
            <button
              type="button"
              style={{ ...toggleStyle, marginLeft: onOpenExternal === undefined ? 'auto' : undefined }}
              aria-expanded={backlinksOpen}
              onClick={() => { setBacklinksOpen(current => !current) }}
            >
              {backlinksOpen ? t('md.collapseBacklinks') : `${t('md.backlinks')} ${links?.incoming.length ?? 0}`}
            </button>
          )}
        </div>
      )}
      {split.hasFrontmatter && open && (
        <table style={tableStyle}>
          <tbody>
            {split.fields.map(field => (
              <tr key={field.key}>
                <th style={{ ...cellStyle, fontWeight: 600, color: 'var(--yt-text-secondary)' }}>{field.key}</th>
                <td style={cellStyle}>{field.value === '' ? '—' : field.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={bodyStyle} className={css.body} ref={bodyRef} onClick={onClick} data-markdown-body="true">
        {backlinksOpen && (links?.incoming.length ?? 0) > 0 && (
          <div style={{ ...outlineStyle, left: 8, right: 'auto' }} data-backlinks="true">
            {links?.incoming.map(entry => (
              <button
                key={`${entry.from}-${entry.target}`}
                type="button"
                style={outlineItemStyle}
                title={entry.target}
                onClick={() => { onOpen?.(entry.from) }}
              >
                {entry.from}
              </button>
            ))}
          </div>
        )}
        {outlineOpen && outline.length > 1 && (
          <div style={outlineStyle} data-outline="true">
            {outline.map((entry, index) => (
              <button
                key={`${entry.text}-${index}`}
                type="button"
                style={{ ...outlineItemStyle, paddingLeft: (entry.level - 1) * 10 }}
                onClick={() => { gotoHeading(index) }}
              >
                {entry.text}
              </button>
            ))}
          </div>
        )}
        <MarkdownText
          text={body}
          labels={{ code: { copyLabel: t('md.copy'), copiedLabel: t('md.copied') }, footnotes: t('md.footnotes') } satisfies MarkdownLabels}
          imageSources={imageSources}
          diagrams={diagrams}
        />
      </div>
    </div>
  )
}
