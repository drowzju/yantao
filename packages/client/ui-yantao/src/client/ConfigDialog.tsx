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
import { SettingsSummary, apiKeyFieldLabel, diffLabels } from './settings-summary.tsx'
import { primaryButtonStyle } from './buttons.ts'
import type { WorkbenchT } from './locales.ts'
import { remoteMessage } from './remote.ts'

const backdropStyle = {
  position: 'absolute',
  inset: 0,
  // 幕布随主题取色（--yt-scrim，2026-10-09）：裸 rgba 值在此前的四处模态
  // 各写一份，暗色下压不出层次。
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
  // 2026-10-24 用户反馈：模型行扩到四格后 520px 太挤、纵向溢出要滚动——
  // 加宽到 720px 并收紧间距，常规窗口整卡放下，不再依赖滚动条。
  width: 'min(720px, 94vw)',
  maxHeight: '86vh',
  overflow: 'auto',
  boxShadow: 'var(--yt-shadow-overlay)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--yt-space-2)',
  // 卡自身接收初始焦点（tabIndex=-1）；轮廓交给卡内的真控件去画。
  outline: 'none',
} as const

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
} as const

// 2026-10-09 第四轮评审：对话框标题回归 --yt-type-title（16px）档；
// 输入类控件是正文面（DESIGN.md 第 3 节「正文、列表、表格、输入」），
// 不为密度缩字号——此前 12px 的 inputStyle 违反该条。
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

const rowStyle = { display: 'flex', gap: 'var(--yt-space-1)', alignItems: 'center' } as const

/** 两列并排的字段对（2026-10-24）：纵向省两行，整卡免滚动。 */
const pairStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--yt-space-2)' } as const

/** 模型表的列头行：与下方输入行同宽分布，标签用次要文字色。 */
const columnHeaderStyle = {
  display: 'flex',
  gap: 'var(--yt-space-1)',
  alignItems: 'center',
  color: 'var(--yt-text-secondary)',
  fontSize: 'var(--yt-type-label)',
} as const

const listStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--yt-space-1)' } as const

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
  paddingTop: 'var(--yt-space-2)',
  borderTop: '1px solid var(--yt-border-subtle)',
} as const

const buttonStyle = { padding: 'var(--yt-space-1) var(--yt-space-3)', minHeight: 'var(--yt-control-min-h)' } as const

const ghostStyle = { ...buttonStyle, background: 'transparent', border: '1px solid var(--yt-border-subtle)' } as const

/** Whether the draft's model rows differ from the stored ones (order, labels, capacities). */
function modelsChanged(draft: readonly ModelRow[], stored: readonly ModelRow[]): boolean {
  return draft.length !== stored.length
    || draft.some((row, at) => {
      const storedRow = stored[at]
      return storedRow === undefined || row.id !== storedRow.id || row.name !== storedRow.name
        || row.contextWindow !== storedRow.contextWindow || row.maxTokens !== storedRow.maxTokens
    })
}

/**
 * One capacity keystroke: a number parses in, an emptied field drops the
 * override (reverting to the composition base's declaration). Rebuilds the
 * row object without the key rather than holding `undefined` — keeps the
 * draft honest for the diff and the ops.
 */
function withCapacity(
  rows: readonly ModelRow[], index: number,
  key: 'contextWindow' | 'maxTokens', raw: string,
): ModelRow[] {
  return rows.map((candidate, at) => {
    if (at !== index) return candidate
    const { [key]: _dropped, ...rest } = candidate
    return raw === '' ? rest : { ...rest, [key]: Number(raw) }
  })
}

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
    if (problem === 'modelNumbersInvalid') { setError(t('config.modelNumbersInvalid')); return }
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

  // 改动摘要（2026-10-23 评审裁决 ②）：落盘前把将要改变的字段报出来。空密钥
  // 表示「保持已存」，不算改动；清空显示名/接口地址表示回落到合成基值，与已
  // 解析值不同即算改动。
  const changedFields = view === null
    ? []
    : diffLabels([
      displayName !== view.displayName ? t('config.displayName') : null,
      baseURL !== view.baseURL ? t('config.baseUrl') : null,
      keyDraft === '' ? null : apiKeyFieldLabel(t, view.keyConfigured),
      modelsChanged(rows, view.models) ? t('config.models') : null,
      defaultModel !== view.defaultModel ? t('config.defaultModel') : null,
    ])

  return (
    <div style={backdropStyle} onClick={onClose} data-config-backdrop="true" onKeyDown={onPanelKeyDown}>
      <div style={cardStyle} role="dialog" aria-modal="true" aria-label={t('config.title')} tabIndex={-1} ref={cardRef} onClick={(event) => { event.stopPropagation() }}>
        <header style={headerStyle}>
          <span style={titleStyle}>{t('config.title')}</span>
          <button data-hover="true" style={ghostStyle} onClick={onClose}>{t('config.close')}</button>
        </header>
        <h3 style={sectionStyle}>{t('config.section.models')}</h3>
        {error !== null ? <p style={errorStyle} role="alert">{error}</p> : null}
        {saved && error === null ? <p style={okStyle}>{t('config.saved')}</p> : null}
        {view === null
          ? <p style={hintStyle}>{t('config.loading')}</p>
          : <>
            <div style={pairStyle}>
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
            </div>
            <div style={pairStyle}>
              <label style={fieldStyle}>
                {t('config.apiKey')}
                <input style={inputStyle} type="password" autoComplete="off" value={keyDraft}
                  disabled={busy || !view.keyWritable}
                  placeholder={view.keyConfigured ? t('config.keyStored') : t('config.keyPlaceholder')}
                  onChange={(event) => { setKeyDraft(event.target.value); setSaved(false) }} />
              </label>
              <label style={fieldStyle}>
                {t('config.defaultModel')}
                <select style={inputStyle} value={defaultModel} disabled={busy}
                  onChange={(event) => { setDefaultModel(event.target.value); setSaved(false) }}>
                  {defaultModel === '' ? <option value=""></option> : null}
                  {rows.map(row => <option key={row.id} value={row.id}>{modelOption(row)}</option>)}
                </select>
              </label>
            </div>
            <fieldset style={{ ...listStyle, border: 'none', padding: 0, margin: 0 }}>
              <legend style={sectionStyle}>{t('config.models')}</legend>
              {/* 列头行（2026-10-24 用户反馈）：四格各自是什么，一眼可读。 */}
              <div style={columnHeaderStyle} aria-hidden="true">
                <span style={{ flex: 1 }}>{t('config.modelId')}</span>
                <span style={{ flex: 1 }}>{t('config.modelName')}</span>
                <span style={{ width: '6.5em', flexShrink: 0 }}>{t('config.modelContextWindow')}</span>
                <span style={{ width: '6.5em', flexShrink: 0 }}>{t('config.modelMaxTokens')}</span>
                <span style={{ width: '2.6em', flexShrink: 0 }} />
              </div>
              {rows.map((row, index) => (
                <div key={`${row.id}-${index}`} style={rowStyle}>
                  <input style={{ ...inputStyle, flex: 1 }} value={row.id}
                    aria-label={t('config.modelId')} disabled={busy}
                    onChange={(event) => { setRows(rows.map((candidate, at) => at === index
                      ? { ...candidate, id: event.target.value }
                      : candidate)) }} />
                  <input style={{ ...inputStyle, flex: 1 }} value={row.name}
                    aria-label={t('config.modelName')} disabled={busy}
                    onChange={(event) => { setRows(rows.map((candidate, at) => at === index
                      ? { ...candidate, name: event.target.value }
                      : candidate)) }} />
                  {/* 容量两格（2026-10-24）：数字留空 = 回落组合层声明；改动热生效。 */}
                  <input style={{ ...inputStyle, width: '6.5em', flexShrink: 0 }} type="number" min={1} step={1}
                    value={row.contextWindow ?? ''}
                    aria-label={t('config.modelContextWindow')} disabled={busy}
                    onChange={(event) => { setRows(withCapacity(rows, index, 'contextWindow', event.target.value)); setSaved(false) }} />
                  <input style={{ ...inputStyle, width: '6.5em', flexShrink: 0 }} type="number" min={1} step={1}
                    value={row.maxTokens ?? ''}
                    aria-label={t('config.modelMaxTokens')} disabled={busy}
                    onChange={(event) => { setRows(withCapacity(rows, index, 'maxTokens', event.target.value)); setSaved(false) }} />
                  <button data-hover="true" style={ghostStyle} disabled={busy} aria-label={t('config.modelRemove')}
                    onClick={() => { setRows(rows.filter((_, at) => at !== index)) }}>{t('config.modelRemove')}</button>
                </div>
              ))}
              <button data-hover="true" style={ghostStyle} disabled={busy}
                onClick={() => { setRows([...rows, { id: '', name: '' }]) }}>{t('config.modelAdd')}</button>
              <span style={hintStyle}>{t('config.modelLimitsHint')}</span>
            </fieldset>
            <SettingsSummary t={t} fields={changedFields} />
            <footer style={footerStyle}>
              <button style={primaryButtonStyle} data-hover="primary" disabled={busy} onClick={() => { void saveDraft() }}>
                {busy ? t('config.saving') : t('config.save')}
              </button>
            </footer>
          </>}
      </div>
    </div>
  )
}
