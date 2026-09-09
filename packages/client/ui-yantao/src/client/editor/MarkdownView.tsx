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
 * Both ordinal mappings (checkboxes, headings) refuse when the counts disagree
 * rather than acting on the wrong line.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KbLinksResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import {
  frontmatterSummary, headingOutline, linkPath, renderWikiLinks, splitFrontmatter, taskLines, toggleTask,
} from '../markdown.ts'

/** Wrapping and typography, matching the editor's own column. */
const wrapStyle = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 13,
  overflowY: 'auto',
} as const

const barStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  borderBottom: '1px solid #e6e2d8',
  color: '#6b6455',
  fontSize: 12,
} as const

const toggleStyle = {
  border: '1px solid #e6e2d8',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '1px 6px',
} as const

const tableStyle = {
  margin: '4px 8px 8px',
  borderCollapse: 'collapse',
  fontSize: 12,
} as const

const cellStyle = {
  borderBottom: '1px solid #f0ece2',
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
  background: '#fff',
  border: '1px solid #e6e2d8',
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
  fontSize: 12,
  padding: '1px 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const bodyStyle = { position: 'relative', flex: 1, minHeight: 0, padding: '8px 12px' } as const

/** The fence and footnote chrome `MarkdownText` needs; stable across renders. */
const LABELS: MarkdownLabels = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/** Props: the file's content, and the one edit this view performs itself. */
export interface MarkdownViewProps {
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
}

/**
 * Render one markdown file for reading.
 * @param props - see {@link MarkdownViewProps}.
 * @returns the reading view.
 */
export function MarkdownView({
  content, onEdit, onUnresolved, links, onOpen,
}: MarkdownViewProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [backlinksOpen, setBacklinksOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const split = useMemo(() => splitFrontmatter(content), [content])
  const summary = useMemo(() => frontmatterSummary(split.fields), [split.fields])
  const outline = useMemo(() => headingOutline(split.body), [split.body])
  // Only the host knows what a target means; the view just renders its answer.
  const body = useMemo(() => {
    if (links === undefined) return split.body
    const resolved = new Map(links.outgoing
      .filter(link => link.path !== null)
      .map(link => [link.target, link.path as string]))
    return renderWikiLinks(split.body, target => resolved.get(target) ?? null)
  }, [split.body, links])

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
      {(split.hasFrontmatter || outline.length > 1 || (links?.incoming.length ?? 0) > 0) && (
        <div style={barStyle}>
          {split.hasFrontmatter && (
            <button
              type="button"
              style={toggleStyle}
              aria-expanded={open}
              onClick={() => { setOpen(current => !current) }}
            >
              {open ? '收起属性' : '属性'}
            </button>
          )}
          {split.hasFrontmatter && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {summary === '' ? '（无内容）' : summary}
            </span>
          )}
          {outline.length > 1 && (
            <button
              type="button"
              style={{ ...toggleStyle, marginLeft: split.hasFrontmatter ? undefined : 'auto' }}
              aria-expanded={outlineOpen}
              onClick={() => { setOutlineOpen(current => !current) }}
            >
              {outlineOpen ? '收起大纲' : '大纲'}
            </button>
          )}
          {(links?.incoming.length ?? 0) > 0 && (
            <button
              type="button"
              style={{ ...toggleStyle, marginLeft: 'auto' }}
              aria-expanded={backlinksOpen}
              onClick={() => { setBacklinksOpen(current => !current) }}
            >
              {backlinksOpen ? '收起反向链接' : `反向链接 ${links?.incoming.length ?? 0}`}
            </button>
          )}
        </div>
      )}
      {split.hasFrontmatter && open && (
        <table style={tableStyle}>
          <tbody>
            {split.fields.map(field => (
              <tr key={field.key}>
                <th style={{ ...cellStyle, fontWeight: 600, color: '#6b6455' }}>{field.key}</th>
                <td style={cellStyle}>{field.value === '' ? '—' : field.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={bodyStyle} ref={bodyRef} onClick={onClick}>
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
        <MarkdownText text={body} labels={LABELS} />
      </div>
    </div>
  )
}
