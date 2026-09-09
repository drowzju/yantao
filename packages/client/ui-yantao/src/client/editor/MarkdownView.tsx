/**
 * The reading view of one KB markdown file (ADR-0014).
 *
 * The workbench opens a file here rather than in the raw textarea: the human
 * reads rendered markdown, and the YAML envelope — machine-written metadata,
 * not prose — folds into a one-line summary that opens into a small table.
 * Editing still happens in {@link FileEditor}, so nothing here owns a draft or
 * a write: this is a view over content someone else loaded.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { frontmatterSummary, splitFrontmatter } from '../markdown.ts'

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

const bodyStyle = { flex: 1, minHeight: 0, padding: '8px 12px' } as const

/** The fence and footnote chrome `MarkdownText` needs; stable across renders. */
const LABELS: MarkdownLabels = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/** Props: the file's content, already loaded. */
export interface MarkdownViewProps {
  /** The file's full content, envelope included. */
  readonly content: string
}

/**
 * Render one markdown file for reading.
 * @param props - see {@link MarkdownViewProps}.
 * @returns the reading view.
 */
export function MarkdownView({ content }: MarkdownViewProps): ReactElement {
  const [open, setOpen] = useState(false)
  const split = useMemo(() => splitFrontmatter(content), [content])
  const summary = useMemo(() => frontmatterSummary(split.fields), [split.fields])

  return (
    <div style={wrapStyle}>
      {split.hasFrontmatter && (
        <div style={barStyle}>
          <button
            type="button"
            style={toggleStyle}
            aria-expanded={open}
            onClick={() => { setOpen(current => !current) }}
          >
            {open ? '收起属性' : '属性'}
          </button>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary === '' ? '（无内容）' : summary}
          </span>
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
      <div style={bodyStyle}>
        <MarkdownText text={split.body} labels={LABELS} />
      </div>
    </div>
  )
}
