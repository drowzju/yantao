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
import type { KbDingtalkBindingRow } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { DingTalkConfigDraft, DingTalkConfigView, DingTalkSaveResult } from './dingtalk-config.ts'
import type { DetailItem, SessionDetailLoader } from './session-detail.ts'
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

// 只读镜像（ADR-0061 决定 3）：气泡样式沿用「详情」抽屉（SessionDetailDrawer）
// 的同一套——说话人身份靠底色差与侧边描边，工具调用一行摘要，不展开。
const mirrorBoxStyle = {
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  background: 'var(--yt-surface-primary)',
  maxHeight: 320,
  overflowY: 'auto',
  padding: 'var(--yt-space-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--yt-space-1)',
} as const

const mirrorNoteStyle = {
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-label)',
} as const

const mirrorBubbleStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  borderRadius: 6,
  fontSize: 'var(--yt-type-label)',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const

const mirrorUserStyle = {
  ...mirrorBubbleStyle,
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-accent-border)',
} as const

const mirrorInjectedStyle = {
  ...mirrorBubbleStyle,
  background: 'transparent',
  border: '1px dashed var(--yt-border-subtle)',
  color: 'var(--yt-text-secondary)',
} as const

const mirrorAssistantStyle = { ...mirrorBubbleStyle, background: 'transparent' } as const

const mirrorToolStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  fontSize: 'var(--yt-type-label)',
  color: 'var(--yt-text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

export interface DingTalkDialogProps {
  /** The bound dictionary, threaded from the frame. */
  readonly t: WorkbenchT
  /** Read the connector's config view (the plugin body's seam). */
  readonly load: () => Promise<DingTalkConfigView>
  /** Commit a draft (the plugin body's seam). */
  readonly save: (draft: DingTalkConfigDraft) => Promise<DingTalkSaveResult>
  /** Read every conversation→session binding (ADR-0061 决定 2); fetched lazily on expand. */
  readonly loadBindings: () => Promise<readonly KbDingtalkBindingRow[]>
  /**
   * Rewire one conversation's binding (ADR-0062 决定 3)：`sessionId` 指向
   * 工作台会话即并入，`null` 还原独立会话。连接器下一条消息即生效。
   */
  readonly mergeBinding: (conversationId: string, sessionId: string | null) => Promise<void>
  /** The session the main column is showing — the merge gesture's target (ADR-0062 决定 4). */
  readonly mergeTarget: () => string | undefined
  /** Jump to one bound session in the workspace (opens it and swings the tab). */
  readonly openSession: (sessionId: string) => void
  /**
   * Read one session's transcript back (ADR-0061 决定 3) — the 任务 drawer's
   * same `sessionDetail` loader, reused verbatim for the read-only mirror.
   */
  readonly loadTranscript: SessionDetailLoader
  readonly onClose: () => void
}

/**
 * The workbench's 钉钉 dialog. Saving hot-applies: the 启用 switch rides the
 * connector's lifecycle reconciler, the rest re-seat through the plugin
 * remount — no restart either way (ADR-0060 决定 3).
 */
export function DingTalkDialog(props: DingTalkDialogProps): ReactElement {
  const { t, load, save, loadBindings, mergeBinding, mergeTarget, openSession, loadTranscript, onClose } = props
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
  // 绑定会话（ADR-0061 决定 2）：展开时懒读一次，之后留在内存里。
  const [bindings, setBindings] = useState<readonly KbDingtalkBindingRow[] | null>(null)
  const [bindingsError, setBindingsError] = useState(false)
  // 只读镜像（ADR-0061 决定 3）：点某行的「对话」展开该会话的实录；
  // 再点一次收起，点另一行换目标。切换/关闭都走 effect 清理里的 abort。
  const [mirrorSession, setMirrorSession] = useState<string | null>(null)
  const [mirrorItems, setMirrorItems] = useState<readonly DetailItem[] | null>(null)
  const [mirrorError, setMirrorError] = useState(false)
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

  const loadBindingsOnce = useCallback(async (): Promise<void> => {
    if (bindings !== null) return
    try {
      setBindings(await loadBindings())
      setBindingsError(false)
    } catch {
      setBindingsError(true)
    }
  }, [bindings, loadBindings])

  // 镜像装载（ADR-0061 决定 3）：目标一变就重读；换行/关闭时上一个读取
  // 被 abort——与「详情」抽屉同一套取消纪律。失败只标记，不打断对话框。
  useEffect(() => {
    if (mirrorSession === null) return
    const controller = new AbortController()
    setMirrorItems(null)
    setMirrorError(false)
    loadTranscript(mirrorSession, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setMirrorItems(loaded.items)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setMirrorError(true)
      })
    return () => { controller.abort() }
  }, [mirrorSession, loadTranscript])

  const toggleMirror = useCallback((sessionId: string): void => {
    setMirrorSession(current => (current === sessionId ? null : sessionId))
  }, [])

  // 并入手势（ADR-0062 决定 4）：把这条钉钉会话接进当前打开的工作台会话，
  // 或还原独立。成功后刷新绑定列表（sessionId 变了，行内显示跟着换）。
  const [mergeNote, setMergeNote] = useState<string | null>(null)
  const [mergeBusy, setMergeBusy] = useState<string | null>(null)

  const mergeOrRestore = useCallback(async (row: KbDingtalkBindingRow): Promise<void> => {
    if (mergeBusy !== null) return
    const target = mergeTarget()
    const next = target === row.sessionId ? null : target
    if (next === undefined) {
      setMergeNote(t('dingtalk.bindings.noTarget'))
      return
    }
    setMergeBusy(row.conversationId)
    setMergeNote(null)
    try {
      await mergeBinding(row.conversationId, next)
      setMergeNote(next === null ? t('dingtalk.bindings.restored') : t('dingtalk.bindings.merged'))
      setBindings(await loadBindings())
    } catch {
      setMergeNote(`${t('dingtalk.bindings.mergeFailed')}：${row.conversationId}`)
    } finally {
      setMergeBusy(null)
    }
  }, [mergeBinding, mergeTarget, mergeBusy, loadBindings, t])

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
            {/* 绑定会话（ADR-0061 决定 2）：钉钉群聊落在哪些会话里，从这里一眼看清、一键跳过去。 */}
            <details onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) void loadBindingsOnce() }}>
              <summary style={{ ...sectionStyle, cursor: 'pointer' }}>{t('dingtalk.bindings')}</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-1)', paddingTop: 'var(--yt-space-2)' }}>
                <span style={hintStyle}>{t('dingtalk.bindings.hint')}</span>
                {mergeNote !== null && <span style={hintStyle}>{mergeNote}</span>}
                {bindingsError ? <span style={hintStyle}>{t('dingtalk.bindings.loadFailed')}</span>
                  : bindings !== null && bindings.length === 0 ? <span style={hintStyle}>{t('dingtalk.bindings.empty')}</span>
                    : bindings !== null && bindings.map(row => (
                      <div key={`${row.kind}:${row.owner}:${row.conversationId}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-space-2)', fontSize: 'var(--yt-type-label)' }}>
                        <span style={{ flexShrink: 0, color: 'var(--yt-text-secondary)' }}>
                          {row.kind === 'robot' ? t('dingtalk.bindings.robot') : t('dingtalk.bindings.employee')}
                          {' · '}
                          {row.owner}
                        </span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--yt-text-secondary)' }}>
                          {row.conversationId}
                        </span>
                        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', gap: 'var(--yt-space-1)' }}>
                          {/* 并入手势（ADR-0062 决定 4）：把这条钉钉会话接进当前
                              打开的会话流；已在当前会话里则提供还原。 */}
                          <button data-hover="true" type="button"
                            disabled={mergeBusy !== null}
                            style={{ ...ghostStyle, minHeight: 24, padding: '0 var(--yt-space-2)' }}
                            onClick={() => { void mergeOrRestore(row) }}>
                            {mergeBusy === row.conversationId ? '…'
                              : mergeTarget() === row.sessionId ? t('dingtalk.bindings.restore') : t('dingtalk.bindings.merge')}
                          </button>
                          <button data-hover="true" type="button"
                            style={{ ...ghostStyle, minHeight: 24, padding: '0 var(--yt-space-2)', ...(mirrorSession === row.sessionId ? { borderColor: 'var(--yt-accent-border)', color: 'var(--yt-accent, inherit)' } : {}) }}
                            aria-expanded={mirrorSession === row.sessionId}
                            onClick={() => { toggleMirror(row.sessionId) }}>
                            {t('dingtalk.bindings.read')}
                          </button>
                          <button data-hover="true" type="button" style={{ ...ghostStyle, flexShrink: 0, minHeight: 24, padding: '0 var(--yt-space-2)' }}
                            onClick={() => { onClose(); openSession(row.sessionId) }}>
                            {t('dingtalk.bindings.open')}
                          </button>
                        </span>
                      </div>
                    ))}
                {/* 只读镜像（ADR-0061 决定 3）：选中行的会话实录就地展开——
                    工作台看得见钉钉那边聊了什么，但回复永远回钉钉去发。 */}
                {mirrorSession !== null && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-1)' }} data-dingtalk-mirror="true">
                    <span style={mirrorNoteStyle}>{t('dingtalk.mirror.note')}</span>
                    {mirrorError ? <span style={mirrorNoteStyle}>{t('dingtalk.mirror.loadFailed')}</span>
                      : mirrorItems === null ? <span style={mirrorNoteStyle}>{t('dingtalk.mirror.loading')}</span>
                        : mirrorItems.length === 0 ? <span style={mirrorNoteStyle}>{t('dingtalk.mirror.empty')}</span>
                          : (
                            <div style={mirrorBoxStyle}>
                              {mirrorItems.map((item) => {
                                if (item.kind === 'user') {
                                  return item.injected
                                    ? <div key={item.seq} style={mirrorInjectedStyle}>{item.text}</div>
                                    : <div key={item.seq} style={mirrorUserStyle}>{item.text}</div>
                                }
                                if (item.kind === 'assistant') {
                                  return <div key={item.seq} style={mirrorAssistantStyle}>{item.text}</div>
                                }
                                const digest = item.args.length > 60 ? `${item.args.slice(0, 60)}…` : item.args
                                return (
                                  <div key={item.seq} style={mirrorToolStyle}>
                                    {`▸ ${item.name} ${digest}${item.error !== null ? ` — ${item.error}` : ''}`}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                  </div>
                )}
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
