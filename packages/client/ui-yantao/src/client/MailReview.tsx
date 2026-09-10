/**
 * The one confirmation window a mail analysis ends with (ADR-0019): four
 * blocks — 新人 / 建议待办 / 项目动态 / 值得留存的资源 — each row ticked
 * separately, with 全部接受 and 全部忽略 for the whole verdict.
 *
 * Nothing is written from here. The window only reports which rows the human
 * chose; {@link MailPanel} does the writing once, after confirmation.
 */
import { useState, type ReactElement } from 'react'
import type { MailAnalysis, MailPerson, MailProjectNote, MailResource, MailTodo } from './mail-analysis.ts'
import type { MailSelection } from './mail-apply.ts'

/** One block's rows and the tick state they share. */
interface Block<T> {
  /** The block's heading. */
  readonly title: string
  /** Its rows. */
  readonly rows: readonly T[]
  /** Render one row's detail. */
  readonly detail: (row: T) => string
  /** One row's label. */
  readonly label: (row: T) => string
}

const panelStyle = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(28, 26, 22, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
} as const

const cardStyle = {
  background: '#fffdf7',
  border: '1px solid #e6e2d8',
  borderRadius: 10,
  padding: 16,
  width: 'min(560px, 92vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 12px 32px rgba(28, 26, 22, 0.25)',
} as const

const blockTitleStyle = { margin: '12px 0 4px', fontSize: 12, fontWeight: 600, color: '#6b6455' } as const

const rowStyle = { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0' } as const

const detailStyle = { color: '#6b6455', fontSize: 12 } as const

const buttonStyle = { padding: '4px 10px' } as const

const footerStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginTop: 14,
  paddingTop: 10,
  borderTop: '1px solid #efeade',
} as const

/** The tick state of all four blocks, as index lists. */
export type ReviewSelection = {
  readonly [K in keyof MailSelection]: readonly number[]
}

/** Every row of every block, ticked. */
function allOf(analysis: MailAnalysis): ReviewSelection {
  return {
    people: analysis.people.map((_row, index) => index),
    todos: analysis.todos.map((_row, index) => index),
    projects: analysis.projects.map((_row, index) => index),
    resources: analysis.resources.map((_row, index) => index),
  }
}

/** The four blocks, in the order the window lists them. */
function blocks(analysis: MailAnalysis): readonly Block<unknown>[] {
  return [
    {
      title: '新人',
      rows: analysis.people,
      label: row => (row as MailPerson).name,
      detail: (row) => {
        const person = row as MailPerson
        return [person.relation, person.reason].filter(part => part !== '').join(' — ')
      },
    },
    {
      title: '建议待办',
      rows: analysis.todos,
      label: row => (row as MailTodo).title,
      detail: (row) => {
        const todo = row as MailTodo
        return [todo.due ?? '', todo.body].filter(part => part !== '').join(' — ')
      },
    },
    {
      title: '项目动态',
      rows: analysis.projects,
      label: row => (row as MailProjectNote).name,
      detail: row => (row as MailProjectNote).note,
    },
    {
      title: '值得留存的资源',
      rows: analysis.resources,
      label: row => (row as MailResource).name,
      detail: row => (row as MailResource).summary,
    },
  ]
}

/** How many rows the human has ticked. */
export function selectedCount(selection: ReviewSelection): number {
  return selection.people.length + selection.todos.length + selection.projects.length + selection.resources.length
}

/**
 * Render the confirmation window.
 * @param props - the verdict, the session's name, and the two callbacks.
 * @returns the window element.
 */
export function MailReview(props: {
  readonly analysis: MailAnalysis
  readonly sessionTitle: string
  readonly onConfirm: (selection: MailSelection) => void
  readonly onDismiss: () => void
}): ReactElement {
  const { analysis, sessionTitle } = props
  // Nothing is ticked to begin with: writing into a knowledge base is the one
  // action here that cannot be undone by looking again.
  const [ticked, setTicked] = useState<ReviewSelection>({ people: [], todos: [], projects: [], resources: [] })
  const keys: readonly (keyof MailSelection)[] = ['people', 'todos', 'projects', 'resources']

  /** Tick or untick one row of one block. */
  const toggle = (key: keyof MailSelection, index: number): void => {
    setTicked(state => ({
      ...state,
      [key]: state[key].includes(index)
        ? state[key].filter(entry => entry !== index)
        : [...state[key], index].sort((left, right) => left - right),
    }))
  }

  const nothing = blocks(analysis).every(block => block.rows.length === 0)

  return (
    <div style={panelStyle} data-mail-review="true">
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>邮件分析结果</div>
        <div style={{ ...detailStyle, marginTop: 2 }}>
          会话「{sessionTitle}」已保留，可以回去看它为什么这么判断。
        </div>
        {nothing && <div style={{ ...detailStyle, marginTop: 10 }}>这次没有发现值得进入知识库的内容。</div>}
        {blocks(analysis).map((block, at) => {
          const key = keys[at]
          if (key === undefined || block.rows.length === 0) return null
          return (
            <div key={block.title}>
              <div style={blockTitleStyle} data-review-block={key}>{block.title}</div>
              {block.rows.map((row, index) => (
                <div key={`${block.title}-${index}`} style={rowStyle} data-review-row={`${key}:${index}`}>
                  <input
                    type="checkbox"
                    aria-label={block.label(row)}
                    checked={ticked[key].includes(index)}
                    onChange={() => { toggle(key, index) }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div>{block.label(row)}</div>
                    {block.detail(row) !== '' && <div style={detailStyle}>{block.detail(row)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
        <div style={footerStyle}>
          <button type="button" style={buttonStyle} onClick={() => { setTicked(allOf(analysis)) }}>全部接受</button>
          <button type="button" style={buttonStyle} onClick={() => { setTicked({ people: [], todos: [], projects: [], resources: [] }) }}>
            全部忽略
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={buttonStyle} onClick={props.onDismiss}>取消</button>
          <button
            type="button"
            style={buttonStyle}
            disabled={selectedCount(ticked) === 0}
            onClick={() => { props.onConfirm(ticked) }}
          >
            确认写入（{selectedCount(ticked)}）
          </button>
        </div>
      </div>
    </div>
  )
}
