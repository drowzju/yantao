/**
 * The refine run's question round (ADR-0030): the model asked before it could
 * propose, so the run paused. One input per question — the `why` rides along
 * as the hint — and two ways onward: the answers continue the same session
 * (one more turn lands the final verdict), 放弃本次提炼 ends the run with
 * nothing written. Nothing here talks to the session; the frame owns the
 * continuation.
 */
import { useState, type ReactElement } from 'react'
import type { RefineQuestion } from './refine.ts'
import type { WorkbenchT } from './locales.ts'

/**
 * The dialog reads only the question-round face of a run — refine's
 * (ADR-0030) and validate's (ADR-0035) both satisfy it — so neither runner's
 * full type leaks in here.
 */
export interface QuestionRun {
  readonly reason: string
  readonly questions?: readonly RefineQuestion[]
  readonly continueWithAnswers?: (answers: readonly string[]) => Promise<unknown>
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
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 10,
  padding: 16,
  width: 'min(560px, 92vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 12px 32px rgba(28, 26, 22, 0.25)',
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  fontSize: 'var(--yt-type-body)',
} as const

const questionStyle = { margin: '12px 0 2px', fontWeight: 600 } as const

const whyStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)', marginBottom: 4 } as const

const inputStyle = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 8px',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
} as const

const footerStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginTop: 14,
  paddingTop: 10,
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

const buttonStyle = { padding: '4px 10px' } as const

/**
 * Render the question dialog.
 * @param props - the paused run (its `questions` drive the form), the two
 *   callbacks, and whether the continuation is already in flight.
 * @returns the dialog element.
 */
export function QuestionDialog(props: {
  readonly run: QuestionRun
  readonly busy?: boolean
  readonly onSubmit: (answers: readonly string[]) => void
  readonly onAbort: () => void
  readonly t: WorkbenchT
}): ReactElement {
  const { run, busy, onSubmit, onAbort, t } = props
  const questions = run.questions ?? []
  const [answers, setAnswers] = useState<readonly string[]>(() => questions.map(() => ''))
  const settled = busy === true
  return (
    <div style={panelStyle} data-question-dialog="true">
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t('workbench.questionTitle')}</div>
        {run.reason !== '' && <div style={{ ...whyStyle, marginTop: 2 }}>{run.reason}</div>}
        {questions.map((question, index) => (
          <div key={index}>
            <div style={questionStyle}>{question.question}</div>
            {question.why !== '' && <div style={whyStyle}>{question.why}</div>}
            <input
              type="text"
              style={inputStyle}
              placeholder={t('workbench.questionPlaceholder')}
              data-question-input={String(index)}
              disabled={settled}
              value={answers[index] ?? ''}
              onChange={(event) => {
                setAnswers(previous => previous.map((answer, at) => (at === index ? event.target.value : answer)))
              }}
            />
          </div>
        ))}
        <div style={footerStyle}>
          <button type="button" style={buttonStyle} disabled={settled} onClick={onAbort}>
            {t('workbench.questionAbort')}
          </button>
          <span style={{ flex: 1 }} />
          {settled && <span style={{ color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' }}>{t('workbench.questionBusy')}</span>}
          <button
            type="button"
            style={buttonStyle}
            disabled={settled}
            data-question-submit="true"
            onClick={() => { onSubmit(questions.map((_, index) => answers[index] ?? '')) }}
          >
            {t('workbench.questionSubmit')}
          </button>
        </div>
      </div>
    </div>
  )
}
