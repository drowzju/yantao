/**
 * The 配置 dialog: opened by the frame footer's bottom-left button, one
 * section — 模型 — editing the intranet gateway (display name, endpoint, API
 * key, model rows, default model). Pure view: it receives the load/save
 * callbacks built in the plugin body and renders their outcomes; the settings
 * and credentials namespaces stay out of here.
 *
 * The backdrop and card follow the ProposalCard idiom: a conditional sibling
 * of the frame root, not a `shell.overlay` entry (that seat belongs to the
 * upstream popup-select and is click-through by design).
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { ModelRow, ModelsConfigDraft, ModelsConfigSaveResult, ModelsConfigView } from './model-config.ts'
import { apiKeyIssue, draftIssue } from './model-config.ts'
import { useDialogModal } from './use-dialog-modal.ts'
import type { WorkbenchT } from './locales.ts'
import { remoteMessage } from './remote.ts'

const backdropStyle = {
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
  width: 'min(520px, 92vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: '0 12px 32px rgba(28, 26, 22, 0.25)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  // 卡自身接收初始焦点（tabIndex=-1）；轮廓交给卡内的真控件去画。
  outline: 'none',
} as const

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
} as const

const titleStyle = { fontSize: 'var(--yt-type-body)', fontWeight: 700 } as const

const sectionStyle = {
  margin: 0,
  fontSize: 'var(--yt-type-label)',
  fontWeight: 600,
  color: 'var(--yt-text-secondary)',
} as const

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--yt-type-label)' } as const

const inputStyle = {
  padding: '5px 8px',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  background: 'var(--yt-surface-primary)',
  color: 'inherit',
  fontSize: 'var(--yt-type-label)',
} as const

const hintStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const rowStyle = { display: 'flex', gap: 6, alignItems: 'center' } as const

const listStyle = { display: 'flex', flexDirection: 'column', gap: 6 } as const

const errorStyle = {
  margin: 0,
  padding: '6px 8px',
  borderRadius: 6,
  background: 'var(--yt-error-bg)',
  color: 'var(--yt-error)',
  fontSize: 'var(--yt-type-label)',
} as const

const okStyle = { margin: 0, color: 'var(--yt-accent, var(--yt-text-secondary))', fontSize: 'var(--yt-type-label)' } as const

const footerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  paddingTop: 8,
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

const buttonStyle = { padding: '5px 14px', minHeight: 'var(--yt-control-min-h)' } as const

const ghostStyle = { ...buttonStyle, background: 'transparent', border: '1px solid var(--yt-border-subtle)' } as const

export interface ConfigDialogProps {
  /** The bound dictionary, threaded from the frame. */
  readonly t: WorkbenchT
  /** Read the gateway's config view (the plugin body's seam). */
  readonly load: () => Promise<ModelsConfigView>
  /** Commit a draft (the plugin body's seam). */
  readonly save: (draft: ModelsConfigDraft) => Promise<ModelsConfigSaveResult>
  readonly onClose: () => void
}

/**
 * The workbench's 配置 dialog. Opens on the model section alone; further
 * sections join as peer blocks under the same backdrop.
 */
export function ConfigDialog(props: ConfigDialogProps): ReactElement {
  const { t, load, save, onClose } = props
  const [view, setView] = useState<ModelsConfigView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [rows, setRows] = useState<readonly ModelRow[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  // The load generation guards against a stale read racing a close: only the
  // latest mount's read may paint the form.
  const generation = useRef(0)
  // 模态纪律（2026-10-05 收敛）：与 ProposalCard 同一套——初始焦点进卡、
  // Tab 圈在卡里、Esc 关闭；保存在途（busy）时 Esc 不动，半途丢掉保存态
  // 会让「存到哪一步」变得不可知。
  const { cardRef, onPanelKeyDown } = useDialogModal({ busy, onClose })

  const applyView = useCallback((loaded: ModelsConfigView): void => {
    setView(loaded)
    setDisplayName(loaded.displayName)
    setBaseURL(loaded.baseURL)
    setRows(loaded.models.map(row => ({ ...row })))
    setDefaultModel(loaded.defaultModel)
    setKeyDraft('')
    setSaved(false)
  }, [])

  const reload = useCallback(async (): Promise<ModelsConfigView | null> => {
    const current = ++generation.current
    try {
      const loaded = await load()
      if (generation.current === current) applyView(loaded)
      return loaded
    } catch (failure) {
      if (generation.current === current) setError(`${t('config.loadFailed')}：${remoteMessage(failure)}`)
      return null
    }
  }, [load, applyView, t])

  useEffect(() => { void reload() }, [reload])

  const saveDraft = async (): Promise<void> => {
    if (view === null || busy) return
    const keyProblem = apiKeyIssue(keyDraft)
    if (keyProblem !== undefined) { setError(t('config.keyInvalid')); return }
    const draft: ModelsConfigDraft = {
      displayName,
      baseURL,
      apiKey: keyDraft,
      models: rows,
      defaultModel,
    }
    const problem = draftIssue(draft)
    if (problem === 'modelIdRequired') { setError(t('config.modelIdRequired')); return }
    if (problem === 'defaultMissing') { setError(t('config.defaultMissing')); return }
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const result = await save(draft)
      if (result.kind === 'saved') {
        setSaved(true)
        setKeyDraft('')
        setView(await load())
      } else if (result.kind === 'conflict') {
        setError(t('config.conflict'))
        await reload()
      } else {
        setError(result.message)
      }
    } catch (failure) {
      setError(remoteMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const modelOption = (row: ModelRow): string => row.name === '' || row.name === row.id ? row.id : `${row.id}（${row.name}）`

  return (
    <div style={backdropStyle} onClick={onClose} data-config-backdrop="true" onKeyDown={onPanelKeyDown}>
      <div style={cardStyle} role="dialog" aria-modal="true" aria-label={t('config.title')} tabIndex={-1} ref={cardRef} onClick={(event) => { event.stopPropagation() }}>
        <header style={headerStyle}>
          <span style={titleStyle}>{t('config.title')}</span>
          <button style={ghostStyle} onClick={onClose}>{t('config.close')}</button>
        </header>
        <h3 style={sectionStyle}>{t('config.section.models')}</h3>
        {error !== null ? <p style={errorStyle} role="alert">{error}</p> : null}
        {saved && error === null ? <p style={okStyle}>{t('config.saved')}</p> : null}
        {view === null
          ? <p style={hintStyle}>{t('config.loading')}</p>
          : <>
            <label style={fieldStyle}>
              {t('config.displayName')}
              <input style={inputStyle} value={displayName} placeholder={view.baseDisplayName}
                disabled={busy} onChange={(event) => { setDisplayName(event.target.value); setSaved(false) }} />
            </label>
            <label style={fieldStyle}>
              {t('config.baseUrl')}
              <input style={inputStyle} value={baseURL} placeholder={view.baseBaseURL}
                disabled={busy} onChange={(event) => { setBaseURL(event.target.value); setSaved(false) }} />
              <span style={hintStyle}>{t('config.baseUrlHint')}</span>
            </label>
            <label style={fieldStyle}>
              {t('config.apiKey')}
              <input style={inputStyle} type="password" autoComplete="off" value={keyDraft}
                disabled={busy || !view.keyWritable}
                placeholder={view.keyConfigured ? t('config.keyStored') : t('config.keyPlaceholder')}
                onChange={(event) => { setKeyDraft(event.target.value); setSaved(false) }} />
            </label>
            <fieldset style={{ ...listStyle, border: 'none', padding: 0, margin: 0 }}>
              <legend style={sectionStyle}>{t('config.models')}</legend>
              {rows.map((row, index) => (
                <div key={`${row.id}-${index}`} style={rowStyle}>
                  <input style={{ ...inputStyle, flex: 1 }} value={row.id} placeholder={t('config.modelId')}
                    aria-label={t('config.modelId')} disabled={busy}
                    onChange={(event) => { setRows(rows.map((candidate, at) => at === index
                      ? { ...candidate, id: event.target.value }
                      : candidate)) }} />
                  <input style={{ ...inputStyle, flex: 1 }} value={row.name} placeholder={t('config.modelName')}
                    aria-label={t('config.modelName')} disabled={busy}
                    onChange={(event) => { setRows(rows.map((candidate, at) => at === index
                      ? { ...candidate, name: event.target.value }
                      : candidate)) }} />
                  <button style={ghostStyle} disabled={busy} aria-label={t('config.modelRemove')}
                    onClick={() => { setRows(rows.filter((_, at) => at !== index)) }}>{t('config.modelRemove')}</button>
                </div>
              ))}
              <button style={ghostStyle} disabled={busy}
                onClick={() => { setRows([...rows, { id: '', name: '' }]) }}>{t('config.modelAdd')}</button>
            </fieldset>
            <label style={fieldStyle}>
              {t('config.defaultModel')}
              <select style={inputStyle} value={defaultModel} disabled={busy}
                onChange={(event) => { setDefaultModel(event.target.value); setSaved(false) }}>
                {defaultModel === '' ? <option value=""></option> : null}
                {rows.map(row => <option key={row.id} value={row.id}>{modelOption(row)}</option>)}
              </select>
            </label>
            <footer style={footerStyle}>
              <button style={buttonStyle} disabled={busy} onClick={() => { void saveDraft() }}>
                {busy ? t('config.saving') : t('config.save')}
              </button>
            </footer>
          </>}
      </div>
    </div>
  )
}
