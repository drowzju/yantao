/**
 * The 快捷键 dialog: a read-only directory of the workbench's registered
 * keyboard commands, opened from the frame footer. Rows stream live from the
 * shortcuts registry's catalog (filtered to this plugin's `yantao.*` ids), so
 * the keycaps always match what the dispatch layer honours — user rebindings
 * and platform differences ride along for free. Editing lives upstream
 * (ui-shortcuts); this face exists to make the bindings discoverable
 * (2026-10-09 第四轮评审 P1：8 条热键注册后全 UI 无处可见).
 *
 * The backdrop and card follow the ConfigDialog idiom: a conditional sibling
 * of the frame root sharing the same use-dialog-modal discipline.
 */
import { useSyncExternalStore, type ReactElement } from 'react'
import { ShortcutKeys } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import { useDialogModal } from './use-dialog-modal.ts'
import type { WorkbenchT } from './locales.ts'

/** The catalog slice of the shortcuts service, typed structurally (no store dep). */
export interface ShortcutCatalogFace {
  readonly getSnapshot: () => readonly ShortcutCatalogEntry[]
  readonly subscribe: (listener: () => void) => () => void
}

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
  padding: 16,
  width: 'min(420px, 92vw)',
  maxHeight: '70vh',
  overflow: 'auto',
  boxShadow: 'var(--yt-shadow-overlay)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  outline: 'none',
} as const

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
} as const

const titleStyle = { margin: 0, fontSize: 'var(--yt-type-title)', fontWeight: 600 } as const

const listStyle = { display: 'flex', flexDirection: 'column', gap: 0, margin: 0, padding: 0, listStyle: 'none' } as const

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '7px 0',
} as const

const rowBorderStyle = { borderBottom: '1px solid var(--yt-border-subtle)' } as const

const labelStyle = { fontSize: 'var(--yt-type-body)' } as const

const emptyStyle = { margin: 0, color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-body)' } as const

const unboundStyle = { color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)' } as const

const closeButtonStyle = {
  padding: '2px 10px',
  minHeight: 'var(--yt-control-min-h)',
  boxSizing: 'border-box',
  background: 'transparent',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
} as const

export interface ShortcutsDialogProps {
  /** The bound dictionary, threaded from the frame. */
  readonly t: WorkbenchT
  /** The shortcuts registry's live catalog (the plugin body threads the service face). */
  readonly catalog: ShortcutCatalogFace
  readonly onClose: () => void
}

/**
 * The workbench's 快捷键 directory: every `yantao.*` command with its
 * effective keycaps. Read-only — rebinding belongs to the upstream
 * shortcut editor, not to this face.
 */
export function ShortcutsDialog({ t, catalog, onClose }: ShortcutsDialogProps): ReactElement {
  const rows = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
    .filter(row => row.id.startsWith('yantao.'))
  const { cardRef, onPanelKeyDown } = useDialogModal({ onClose })
  return (
    <div style={backdropStyle} onClick={onClose} data-shortcuts-backdrop="true" onKeyDown={onPanelKeyDown}>
      <div style={cardStyle} role="dialog" aria-modal="true" aria-label={t('shortcuts.title')} tabIndex={-1} ref={cardRef} onClick={(event) => { event.stopPropagation() }}>
        <header style={headerStyle}>
          <h2 style={titleStyle}>{t('shortcuts.title')}</h2>
          <button data-hover="true" style={closeButtonStyle} onClick={onClose}>{t('shortcuts.close')}</button>
        </header>
        {rows.length === 0
          ? <p style={emptyStyle}>{t('shortcuts.empty')}</p>
          : <ul style={listStyle}>
            {rows.map((row, index) => (
              <li key={row.id} style={index === rows.length - 1 ? rowStyle : { ...rowStyle, ...rowBorderStyle }}>
                <span style={labelStyle}>{row.label}</span>
                {row.keys.length === 0
                  ? <span style={unboundStyle}>{t('shortcuts.unbound')}</span>
                  : <ShortcutKeys keys={row.keys} />}
              </li>
            ))}
          </ul>}
      </div>
    </div>
  )
}
