/**
 * The yantao workbench sidebar shell: brand row and collapse toggle on top,
 * the five-section KB tree as the browsing region, and the settings seat at
 * the foot. Geometry mirrors the shipped sidebar's contract (wide content
 * vs the 56px rail) without its slide/crossfade choreography.
 */
import clsx from 'clsx'
import { FishLogo, IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KbSidebarComponentProps } from './contract/slots.ts'
import type { KbSessionRow } from './KbTree.tsx'
import { KbTree } from './KbTree.tsx'
import css from './KbSidebar.module.css'

/**
 * Render the workbench sidebar column.
 * @param props - composed slot props (runtime share + injected callbacks + locale, contract/slots.ts).
 */
export function KbSidebar({
  collapsed,
  width,
  t,
  renderSlot,
  useWorkbench,
  useKbSessions,
  selectFile,
  refreshTree,
  openSession,
  newSession,
  toggleSidebar,
}: KbSidebarComponentProps) {
  const workbench = useWorkbench(snapshot => snapshot)
  const sessionState = useKbSessions(snapshot => snapshot)
  const sessions: readonly KbSessionRow[] = sessionState.ids.flatMap((id) => {
    const row = sessionState.byId[id]
    return row === undefined
      ? []
      : [{ id: row.id, displayTitle: row.displayTitle, running: row.running, current: sessionState.current === row.id }]
  })

  if (collapsed) {
    return (
      <div className={clsx(css.sidebar, css.sidebarRail)} style={{ width }}>
        <div className={css.brandRow}>{renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}</div>
        <button type="button" className={css.railButton} onClick={toggleSidebar} title={t('section.projects')}>
          <IconPanelLeftOutline16 />
        </button>
      </div>
    )
  }

  return (
    <div className={css.sidebar} style={{ width }}>
      <div className={css.brandRow}>
        {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}
        {renderSlot('sidebar.brand.name', {}, { fallback: <span className={css.brandFallback}>{t('section.projects')}</span> })}
        <button type="button" className={css.collapseButton} onClick={toggleSidebar} title="⟨">
          <IconPanelLeftOutline16 />
        </button>
      </div>
      <div className={css.treeScroll}>
        <KbTree
          tree={workbench.tree}
          treeError={workbench.treeError}
          selection={workbench.selection}
          sessions={sessions}
          t={t}
          onSelect={(path) => { selectFile(path) }}
          onRefresh={refreshTree}
          onOpenSession={openSession}
          onNewSession={newSession}
        />
      </div>
      <div className={css.foot}>{renderSlot('sidebar.settings', { wide: true })}</div>
    </div>
  )
}
