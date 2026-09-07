/**
 * The five-section KB tree: 资源/项目/领域/人物/会话. Pure presentation —
 * every fact arrives as plain data and every action as a callback, per the
 * package's props-share discipline.
 */
import clsx from 'clsx'
import type { KbTree as KbTreePayload, KbTreeSectionId } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { SECTION_LABEL_KEYS } from './editor-state.ts'
import type { YantaoKbKey } from './locales.ts'
import css from './KbTree.module.css'

/** One live chat-session row for the 会话 section. */
export interface KbSessionRow {
  readonly id: string
  readonly displayTitle: string
  readonly running: boolean
  readonly current: boolean
}

/** Presentational props of the KB tree. */
export interface KbTreeProps {
  /** The latest tree payload, or null while the first load is outstanding. */
  readonly tree: KbTreePayload | null
  /** The last tree-load failure's message, or null. */
  readonly treeError: string | null
  /** The selected KB-relative path, or null. */
  readonly selection: string | null
  /** Live chat sessions rendered at the top of the 会话 section. */
  readonly sessions: readonly KbSessionRow[]
  /** Dictionary seat. */
  readonly t: (key: YantaoKbKey) => string
  /** Select one file for the editor. */
  readonly onSelect: (path: string) => void
  /** Reload the tree. */
  readonly onRefresh: () => void
  /** Open one chat session. */
  readonly onOpenSession: (id: string) => void
  /** Start a new chat session. */
  readonly onNewSession: () => void
}

/** The five sections in display order. */
const SECTION_ORDER: readonly KbTreeSectionId[] = ['resources', 'projects', 'areas', 'people', 'sessions']

/** Render the five-section KB tree. */
export function KbTree({ tree, treeError, selection, sessions, t, onSelect, onRefresh, onOpenSession, onNewSession }: KbTreeProps) {
  return (
    <div className={css.tree}>
      <div className={css.toolbar}>
        <button type="button" className={css.toolButton} onClick={onRefresh} title={t('tree.refresh')}>
          ⟳ {t('tree.refresh')}
        </button>
      </div>
      {treeError !== null && <div className={css.errorRow}>{t('tree.loadFailed')}：{treeError}</div>}
      {SECTION_ORDER.map((sectionId) => {
        const section = tree?.sections.find(entry => entry.id === sectionId)
        return (
          <section key={sectionId} className={css.section}>
            <h3 className={css.sectionTitle}>{t(SECTION_LABEL_KEYS[sectionId])}</h3>
            {sectionId === 'sessions' && (
              <div className={css.sessionBlock}>
                <button type="button" className={css.newSessionButton} onClick={onNewSession}>
                  ＋ {t('session.new')}
                </button>
                {sessions.map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className={clsx(css.fileRow, row.current && css.fileRowActive)}
                    onClick={() => { onOpenSession(row.id) }}
                  >
                    <span className={css.fileName}>{row.displayTitle}</span>
                    {row.running && <span className={css.badge}>{t('session.live')}</span>}
                  </button>
                ))}
              </div>
            )}
            {section !== undefined && section.files.length === 0 && sectionId !== 'sessions' && (
              <div className={css.emptyRow}>{t('tree.empty')}</div>
            )}
            {section?.files.map(file => (
              <button
                key={file.path}
                type="button"
                className={clsx(css.fileRow, selection === file.path && css.fileRowSelected)}
                onClick={() => { onSelect(file.path) }}
              >
                <span className={css.fileName}>{file.name}</span>
                {file.archived === true && <span className={css.badge}>{t('badge.archived')}</span>}
                {file.notePath !== undefined && <span className={css.badge}>{t('badge.note')}</span>}
                {file.relation !== undefined && <span className={css.badge}>{file.relation}</span>}
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}
