/**
 * The CLI dialog: opened by the frame footer's bottom-right CLI button — the
 * workspace runtime's headless CLI configuration (2026-10-23). Three fields —
 * API key, default model (the controller parses the installed CLI's own
 * model menu), network environment — plus a 测试连接 probe that fires one
 * bounded headless call through the controller. Pure view: it receives the
 * load/save/test callbacks built in the plugin body; the settings,
 * credentials, and yantaoKb namespaces stay out of here.
 *
 * The backdrop and card follow the ProposalCard idiom, same as ConfigDialog.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  WorkspaceCliConfigDraft, WorkspaceCliConfigView, WorkspaceCliSaveResult, WorkspaceCliTestResult,
} from './workspace-cli-config.ts'
import { useDialogModal } from './use-dialog-modal.ts'
import { SettingsSummary, apiKeyFieldLabel, diffLabels } from './settings-summary.tsx'
import { primaryButtonStyle } from './buttons.ts'
import type { WorkbenchT } from './locales.ts'
import { remoteMessage } from './remote.ts'

const backdropStyle = {
  position: 'absolute',
  inset: 0,
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
  width: 'min(480px, 92vw)',
  maxHeight: '80vh',
  overflow: 'auto',
  boxShadow: 'var(--yt-shadow-overlay)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--yt-space-2)',
  outline: 'none',
} as const

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
} as const

const titleStyle = { fontSize: 'var(--yt-type-title)', fontWeight: 600 } as const

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-1)', fontSize: 'var(--yt-type-label)' } as const

const inputStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  background: 'var(--yt-surface-primary)',
  color: 'inherit',
  fontSize: 'var(--yt-type-body)',
} as const

const hintStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const errorStyle = {
  margin: 0,
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderRadius: 6,
  background: 'var(--yt-error-bg)',
  color: 'var(--yt-error)',
  fontSize: 'var(--yt-type-label)',
} as const

// 2026-10-23 评审 P2：保存成功是状态，不是「选中」——§2.5 成功走 success，
// accent 是链接/主操作。三个对话框此前各抄了一遍 accent 版本。
const okStyle = { margin: 0, color: 'var(--yt-success-text)', fontSize: 'var(--yt-type-label)' } as const

const footerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 'var(--yt-space-2)',
  paddingTop: 'var(--yt-space-2)',
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

const buttonStyle = { padding: 'var(--yt-space-1) var(--yt-space-3)', minHeight: 'var(--yt-control-min-h)' } as const

const ghostStyle = { ...buttonStyle, background: 'transparent', border: '1px solid var(--yt-border-subtle)' } as const

/** The network environments the CodeBuddy editions answer to (SDK docs, 2026-10-23). */
const INTERNET_ENVIRONMENTS = ['', 'cloudhosted', 'ioa', 'internal', 'selfhosted'] as const

export interface WorkspaceCliDialogProps {
  /** The bound dictionary, threaded from the frame. */
  readonly t: WorkbenchT
  /** Read the CLI's config view (the plugin body's seam). */
  readonly load: () => Promise<WorkspaceCliConfigView>
  /** Commit a draft (the plugin body's seam). */
  readonly save: (draft: WorkspaceCliConfigDraft) => Promise<WorkspaceCliSaveResult>
  /** Fire one bounded probe call against the current draft (the plugin body's seam). */
  readonly test: (draft: WorkspaceCliConfigDraft) => Promise<WorkspaceCliTestResult>
  readonly onClose: () => void
}

/**
 * The workbench's CLI dialog: key, default model, network environment, and
 * the 测试连接 probe.
 */
export function WorkspaceCliDialog(props: WorkspaceCliDialogProps): ReactElement {
  const { t, load, save, test, onClose } = props
  const [view, setView] = useState<WorkspaceCliConfigView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [model, setModel] = useState('')
  const [internetEnvironment, setInternetEnvironment] = useState('')
  const [probe, setProbe] = useState<WorkspaceCliTestResult | null>(null)
  const [probing, setProbing] = useState(false)
  // The load generation guards against a stale read racing a close: only the
  // latest mount's read may paint the form.
  const generation = useRef(0)
  // 模态纪律：与 ConfigDialog 同一套——初始焦点进卡、Tab 圈在卡里、Esc 关闭；
  // 保存或探测在途（busy）时 Esc 不动。
  const { cardRef, onPanelKeyDown } = useDialogModal({ busy: busy || probing, onClose })

  const applyView = useCallback((loaded: WorkspaceCliConfigView): void => {
    setView(loaded)
    setModel(loaded.model)
    setInternetEnvironment(loaded.internetEnvironment)
    setKeyDraft('')
    setSaved(false)
  }, [])

  const reload = useCallback(async (): Promise<WorkspaceCliConfigView | null> => {
    const current = ++generation.current
    try {
      const loaded = await load()
      if (generation.current === current) applyView(loaded)
      return loaded
    } catch (failure) {
      if (generation.current === current) setError(`${t('wscli.loadFailed')}：${remoteMessage(failure)}`)
      return null
    }
  }, [load, applyView, t])

  useEffect(() => { void reload() }, [reload])

  const saveDraft = async (): Promise<void> => {
    if (view === null || busy) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const result = await save({ model, internetEnvironment, apiKey: keyDraft })
      if (result.kind === 'saved') {
        setSaved(true)
        setKeyDraft('')
        setView(await load())
      } else if (result.kind === 'conflict') {
        setError(t('wscli.conflict'))
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

  // 改动摘要（2026-10-23 评审裁决 ②）：落盘前把将要改变的字段报出来。空密钥
  // 表示「保持已存」，不算改动。
  const changedFields = view === null
    ? []
    : diffLabels([
      keyDraft === '' ? null : apiKeyFieldLabel(t, view.keyConfigured),
      model !== view.model ? t('wscli.model') : null,
      internetEnvironment !== view.internetEnvironment ? t('wscli.internetEnv') : null,
    ])

  const runProbe = async (): Promise<void> => {
    if (probing) return
    setProbing(true)
    setProbe(null)
    setError(null)
    try {
      setProbe(await test({ model, internetEnvironment, apiKey: keyDraft }))
    } catch (failure) {
      setProbe({ ok: false, detail: remoteMessage(failure), durationMs: 0 })
    } finally {
      setProbing(false)
    }
  }

  return (
    <div style={backdropStyle} onClick={onClose} data-wscli-backdrop="true" onKeyDown={onPanelKeyDown}>
      <div style={cardStyle} role="dialog" aria-modal="true" aria-label={t('wscli.title')} tabIndex={-1} ref={cardRef} onClick={(event) => { event.stopPropagation() }}>
        <header style={headerStyle}>
          <span style={titleStyle}>{t('wscli.title')}</span>
          <button data-hover="true" style={ghostStyle} onClick={onClose}>{t('wscli.close')}</button>
        </header>
        {error !== null ? <p style={errorStyle} role="alert">{error}</p> : null}
        {saved && error === null ? <p style={okStyle}>{t('wscli.saved')}</p> : null}
        {view === null
          ? <p style={hintStyle}>{t('wscli.loading')}</p>
          : <>
            <label style={fieldStyle}>
              {t('wscli.apiKey')}
              <input style={inputStyle} type="password" autoComplete="off" value={keyDraft}
                disabled={busy || !view.keyWritable}
                placeholder={view.keyConfigured ? t('wscli.keyStored') : t('wscli.keyPlaceholder')}
                onChange={(event) => { setKeyDraft(event.target.value); setSaved(false) }} />
              <span style={hintStyle}>{t('wscli.apiKeyHint')}</span>
            </label>
            <label style={fieldStyle}>
              {t('wscli.model')}
              <select style={inputStyle} value={model} disabled={busy}
                onChange={(event) => { setModel(event.target.value); setSaved(false) }}>
                <option value="">{t('wscli.modelDefault')}</option>
                {view.models.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
              <span style={hintStyle}>{t('wscli.modelHint')}</span>
            </label>
            <label style={fieldStyle}>
              {t('wscli.internetEnv')}
              <select style={inputStyle} value={internetEnvironment} disabled={busy}
                onChange={(event) => { setInternetEnvironment(event.target.value); setSaved(false) }}>
                {INTERNET_ENVIRONMENTS.map(id => (
                  <option key={id} value={id}>{id === '' ? t('wscli.internetEnvDefault') : id}</option>
                ))}
              </select>
            </label>
            {probe !== null ? (
              probe.ok
                ? <p style={okStyle}>{t('wscli.testOk')}（{probe.durationMs} ms）</p>
                : <p style={errorStyle} role="alert">{t('wscli.testFailed')}：{probe.detail}</p>
            ) : null}
            <SettingsSummary t={t} fields={changedFields} />
            <footer style={footerStyle}>
              <button data-hover="true" style={ghostStyle} disabled={busy || probing} onClick={() => { void runProbe() }}>
                {probing ? t('wscli.testing') : t('wscli.test')}
              </button>
              <button style={primaryButtonStyle} data-hover="primary" disabled={busy || probing} onClick={() => { void saveDraft() }}>
                {busy ? t('wscli.saving') : t('wscli.save')}
              </button>
            </footer>
          </>}
      </div>
    </div>
  )
}
