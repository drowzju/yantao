/**
 * The KB markdown editor: source textarea and MarkdownText preview behind a
 * view toggle, with a saved/draft dirty flag and save. Content state is
 * component-local (only the editor knows it); the selection and file actions
 * arrive through the inject face. `resources/` originals render read-only —
 * the KB's own contract keeps originals immutable; their shadow notes are
 * the editable surface.
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KbEditorComponentProps } from './contract/slots.ts'
import { initialEditorState, isDirty, isReadOnlyKbPath, withDraft, withSaved, type EditorState } from './editor-state.ts'
import css from './KbEditor.module.css'

/** Load phase of the selected file. */
type Phase = 'empty' | 'loading' | 'ready' | 'error'

/** Render the KB editor panel. */
export function KbEditor({ useWorkbench, loadFile, saveFile, t }: KbEditorComponentProps) {
  const selection = useWorkbench(snapshot => snapshot.selection)
  const [phase, setPhase] = useState<Phase>('empty')
  const [state, setState] = useState<EditorState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'source' | 'preview'>('source')
  const [saving, setSaving] = useState(false)

  // Load on selection change; the ticket discards a stale resolve when the
  // selection moves again before the read settles.
  useEffect(() => {
    if (selection === null) {
      setPhase('empty')
      setState(null)
      setError(null)
      return
    }
    let stale = false
    setPhase('loading')
    setError(null)
    loadFile(selection).then(
      (content) => {
        if (stale) return
        setState(initialEditorState(content))
        setPhase('ready')
      },
      (failure: unknown) => {
        if (stale) return
        setError(failure instanceof Error ? failure.message : String(failure))
        setPhase('error')
      },
    )
    return () => {
      stale = true
    }
  }, [selection, loadFile])

  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  const readOnly = selection !== null && isReadOnlyKbPath(selection)
  const dirty = state !== null && isDirty(state)

  const save = (): void => {
    if (selection === null || state === null || readOnly || !dirty || saving) return
    setSaving(true)
    saveFile(selection, state.draft).then(
      () => {
        setState(current => current === null ? null : withSaved(current))
        setSaving(false)
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure))
        setSaving(false)
      },
    )
  }

  return (
    <div className={css.editor}>
      <div className={css.header}>
        <span className={css.pathLabel}>{selection ?? ''}</span>
        <div className={css.actions}>
          <button
            type="button"
            className={clsx(css.viewButton, view === 'source' && css.viewButtonActive)}
            onClick={() => { setView('source') }}
          >
            {t('editor.source')}
          </button>
          <button
            type="button"
            className={clsx(css.viewButton, view === 'preview' && css.viewButtonActive)}
            onClick={() => { setView('preview') }}
          >
            {t('editor.preview')}
          </button>
          {!readOnly && (
            <button
              type="button"
              className={css.saveButton}
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? '…' : t('editor.save')}
            </button>
          )}
          <span className={clsx(css.dirtyFlag, dirty ? css.dirtyOn : css.dirtyOff)}>
            {dirty ? t('editor.dirty') : t('editor.saved')}
          </span>
        </div>
      </div>
      {readOnly && <div className={css.banner}>{t('editor.readonly')}</div>}
      {error !== null && <div className={css.banner}>{t('editor.saveFailed')}：{error}</div>}
      <div className={css.body}>
        {phase === 'empty' && <div className={css.placeholder}>{t('editor.empty')}</div>}
        {phase === 'loading' && <div className={css.placeholder}>{t('editor.loading')}</div>}
        {phase === 'error' && <div className={css.placeholder}>{t('editor.loadFailed')}</div>}
        {phase === 'ready' && state !== null && view === 'source' && (
          <textarea
            className={css.textarea}
            value={state.draft}
            readOnly={readOnly}
            onChange={(event) => { setState(current => current === null ? null : withDraft(current, event.target.value)) }}
          />
        )}
        {phase === 'ready' && state !== null && view === 'preview' && (
          <div className={css.preview}>
            <MarkdownText text={state.draft} labels={labels} />
          </div>
        )}
      </div>
    </div>
  )
}
