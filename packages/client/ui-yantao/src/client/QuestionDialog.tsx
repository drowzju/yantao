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
import { useDialogModal } from './use-dialog-modal.ts'
import { ghostButtonStyle, primaryButtonStyle } from './buttons.ts'
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
  // 幕布随主题取色（--yt-scrim，2026-10-09）——见 ConfigDialog 同款注释。
  background: 'var(--yt-scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
} as const

const cardStyle = {
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 10,
  padding: 'var(--yt-space-4)',
  width: 'min(560px, 92vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: 'var(--yt-shadow-overlay)',
  fontFamily: 'var(--yt-font-ui)',
  fontSize: 'var(--yt-type-body)',
  // 卡自身接收初始焦点（tabIndex=-1）；轮廓交给卡内的真控件去画。
  outline: 'none',
} as const

const questionStyle = { margin: 'var(--yt-space-3) 0 var(--yt-space-1)', fontWeight: 600 } as const

const whyStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)', marginBottom: 'var(--yt-space-1)' } as const

const inputStyle = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'var(--yt-type-body)',
} as const

const footerStyle = {
  display: 'flex',
  gap: 'var(--yt-space-2)',
  alignItems: 'center',
  marginTop: 'var(--yt-space-3)',
  paddingTop: 'var(--yt-space-2)',
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

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
  // 模态纪律（2026-10-05 收敛）：与 ProposalCard 同一套——初始焦点进卡、
  // Tab 圈在卡里、Esc 走 放弃本次提炼；续跑在途（settled）时 Esc 不动。
  const { cardRef, onPanelKeyDown } = useDialogModal({ busy: settled, onClose: onAbort })
  return (
    <div style={panelStyle} data-question-dialog="true" onKeyDown={onPanelKeyDown}>
      <div style={cardStyle} role="dialog" aria-modal="true" aria-label={t('workbench.questionTitle')} tabIndex={-1} ref={cardRef}>
        <div style={{ fontSize: 'var(--yt-type-body)', fontWeight: 600 }}>{t('workbench.questionTitle')}</div>
        {run.reason !== '' && <div style={{ ...whyStyle, marginTop: 'var(--yt-space-1)' }}>{run.reason}</div>}
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
          <button data-hover="true" type="button" style={ghostButtonStyle} disabled={settled} onClick={onAbort}>
            {t('workbench.questionAbort')}
          </button>
          <span style={{ flex: 1 }} />
          {settled && <span style={{ color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' }}>{t('workbench.questionBusy')}</span>}
          <button
            type="button"
            style={primaryButtonStyle}
            data-hover="primary"
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
