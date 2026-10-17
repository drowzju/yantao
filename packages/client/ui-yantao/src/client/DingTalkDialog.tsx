/**
 * The 钉钉 dialog (ADR-0060 决定 2): opened by the frame footer's 钉钉
 * button. 基础区四项——启用开关、Client ID、Client Secret、机器人名称；
 * 代理与调试日志沉进「高级」折叠区（公司网关是环境特例，不占普通人的
 * 视线）。Pure view: it receives the load/save callbacks built in the
 * plugin body and renders their outcomes; the settings and credentials
 * namespaces stay out of here.
 *
 * The backdrop and card follow the ConfigDialog idiom: a conditional sibling
 * of the frame root, not a `shell.overlay` entry.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { DingTalkConfigDraft, DingTalkConfigView, DingTalkSaveResult } from './dingtalk-config.ts'
import { useDialogModal } from './use-dialog-modal.ts'
import { primaryButtonStyle } from './buttons.ts'
import type { WorkbenchT } from './locales.ts'
import { remoteMessage } from './remote.ts'

const backdropStyle = {
  position: 'absolute',
  inset: 0,
  // 幕布随主题取色（--yt-scrim）——见 ConfigDialog 同款注释。
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
  width: 'min(520px, 92vw)',
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

const sectionStyle = {
  margin: 0,
  fontSize: 'var(--yt-type-label)',
  fontWeight: 600,
  color: 'var(--yt-text-secondary)',
} as const

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

const checkLabelStyle = { display: 'flex', alignItems: 'center', gap: 'var(--yt-space-1)', fontSize: 'var(--yt-type-body)' } as const

const errorStyle = {
  margin: 0,
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderRadius: 6,
  background: 'var(--yt-error-bg)',
  color: 'var(--yt-error)',
  fontSize: 'var(--yt-type-label)',
} as const

const okStyle = { margin: 0, color: 'var(--yt-accent, var(--yt-text-secondary))', fontSize: 'var(--yt-type-label)' } as const

const footerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  paddingTop: 'var(--yt-space-2)',
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

const buttonStyle = { padding: 'var(--yt-space-1) var(--yt-space-3)', minHeight: 'var(--yt-control-min-h)' } as const

const ghostStyle = { ...buttonStyle, background: 'transparent', border: '1px solid var(--yt-border-subtle)' } as const

export interface DingTalkDialogProps {
  /** The bound dictionary, threaded from the frame. */
  readonly t: WorkbenchT
  /** Read the connector's config view (the plugin body's seam). */
  readonly load: () => Promise<DingTalkConfigView>
  /** Commit a draft (the plugin body's seam). */
  readonly save: (draft: DingTalkConfigDraft) => Promise<DingTalkSaveResult>
  readonly onClose: () => void
}

/**
 * The workbench's 钉钉 dialog. Saving hot-applies: the 启用 switch rides the
 * connector's lifecycle reconciler, the rest re-seat through the plugin
 * remount — no restart either way (ADR-0060 决定 3).
 */
export function DingTalkDialog(props: DingTalkDialogProps): ReactElement {
  const { t, load, save, onClose } = props
  const [view, setView] = useState<DingTalkConfigView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [clientId, setClientId] = useState('')
  const [secretDraft, setSecretDraft] = useState('')
  const [robotName, setRobotName] = useState('')
  const [proxy, setProxy] = useState('')
  const [debug, setDebug] = useState(false)
  // The load generation guards against a stale read racing a close: only the
  // latest mount's read may paint the form.
  const generation = useRef(0)
  // 模态纪律：与 ConfigDialog 同一套——初始焦点进卡、Tab 圈在卡里、
  // Esc 关闭；保存在途（busy）时 Esc 不动。
  const { cardRef, onPanelKeyDown } = useDialogModal({ busy, onClose })

  const applyView = useCallback((loaded: DingTalkConfigView): void => {
    setView(loaded)
    setEnabled(loaded.enabled)
    setClientId(loaded.clientId)
    setRobotName(loaded.robotName)
    setProxy(loaded.proxy)
    setDebug(loaded.debug)
    setSecretDraft('')
    setSaved(false)
  }, [])

  const reload = useCallback(async (): Promise<DingTalkConfigView | null> => {
    const current = ++generation.current
    try {
      const loaded = await load()
      if (generation.current === current) applyView(loaded)
      return loaded
    } catch (failure) {
      if (generation.current === current) setError(`${t('dingtalk.loadFailed')}：${remoteMessage(failure)}`)
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
      const result = await save({ enabled, clientId, robotName, proxy, debug, secret: secretDraft })
      if (result.kind === 'saved') {
        setSaved(true)
        setSecretDraft('')
        setView(await load())
      } else if (result.kind === 'conflict') {
        setError(t('dingtalk.conflict'))
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

  return (
    <div style={backdropStyle} onClick={onClose} data-dingtalk-backdrop="true" onKeyDown={onPanelKeyDown}>
      <div style={cardStyle} role="dialog" aria-modal="true" aria-label={t('dingtalk.title')} tabIndex={-1} ref={cardRef} onClick={(event) => { event.stopPropagation() }}>
        <header style={headerStyle}>
          <span style={titleStyle}>{t('dingtalk.title')}</span>
          <button data-hover="true" style={ghostStyle} onClick={onClose}>{t('dingtalk.close')}</button>
        </header>
        {error !== null ? <p style={errorStyle} role="alert">{error}</p> : null}
        {saved && error === null ? <p style={okStyle}>{t('dingtalk.saved')}</p> : null}
        {view === null
          ? <p style={hintStyle}>{t('dingtalk.loading')}</p>
          : <>
            <label style={checkLabelStyle}>
              <input type="checkbox" checked={enabled} disabled={busy} data-dingtalk-enabled="true"
                onChange={(event) => { setEnabled(event.target.checked); setSaved(false) }} />
              {t('dingtalk.enabled')}
            </label>
            <span style={hintStyle}>{t('dingtalk.enabledHint')}</span>
            <label style={fieldStyle}>
              {t('dingtalk.clientId')}
              <input style={inputStyle} value={clientId} disabled={busy} data-dingtalk-client-id="true"
                onChange={(event) => { setClientId(event.target.value); setSaved(false) }} />
              <span style={hintStyle}>{t('dingtalk.clientIdHint')}</span>
            </label>
            <label style={fieldStyle}>
              {t('dingtalk.clientSecret')}
              <input style={inputStyle} type="password" autoComplete="off" value={secretDraft}
                disabled={busy || !view.secretWritable} data-dingtalk-secret="true"
                placeholder={view.secretConfigured ? t('dingtalk.secretStored') : t('dingtalk.secretPlaceholder')}
                onChange={(event) => { setSecretDraft(event.target.value); setSaved(false) }} />
            </label>
            <label style={fieldStyle}>
              {t('dingtalk.robotName')}
              <input style={inputStyle} value={robotName} disabled={busy} data-dingtalk-robot-name="true"
                onChange={(event) => { setRobotName(event.target.value); setSaved(false) }} />
            </label>
            {/* 高级折叠区（ADR-0060 决定 2）：公司网关特例不占普通人的视线。 */}
            <details>
              <summary style={{ ...sectionStyle, cursor: 'pointer' }}>{t('dingtalk.advanced')}</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-2)', paddingTop: 'var(--yt-space-2)' }}>
                <label style={fieldStyle}>
                  {t('dingtalk.proxy')}
                  <input style={inputStyle} value={proxy} disabled={busy} data-dingtalk-proxy="true"
                    placeholder="http://host:port"
                    onChange={(event) => { setProxy(event.target.value); setSaved(false) }} />
                  <span style={hintStyle}>{t('dingtalk.proxyHint')}</span>
                </label>
                <label style={checkLabelStyle}>
                  <input type="checkbox" checked={debug} disabled={busy} data-dingtalk-debug="true"
                    onChange={(event) => { setDebug(event.target.checked); setSaved(false) }} />
                  {t('dingtalk.debug')}
                </label>
              </div>
            </details>
            <footer style={footerStyle}>
              <button style={primaryButtonStyle} data-hover="primary" disabled={busy} onClick={() => { void saveDraft() }}>
                {busy ? t('dingtalk.saving') : t('dingtalk.save')}
              </button>
            </footer>
          </>}
      </div>
    </div>
  )
}
