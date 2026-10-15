/**
 * The centre pane's tab model: open files as tabs beside one permanent 对话
 * tab. Pure — no React, no Remote — so the dedupe, the close-neighbour rule,
 * and the localStorage round-trip are pinned by unit tests instead of by a
 * rendered tree.
 * @module @deepseek-ai/dsh-client-ui-yantao/tabs
 */

/**
 * KB-relative directory holding one distilled log per workspace run.
 * Mirrored from the controller's `types.ts` on purpose: the client bundle
 * purity gate forbids value imports from controllers (type-only imports are
 * erased; constants are not), so the literal lives here too — the tabs spec
 * pins the two copies equal.
 */
export const WORKSPACE_RUN_LOG_DIR = 'sessions/workspace'

/** How a tab presents a file: `read` is the read-only resource view. */
export type TabMode = 'edit' | 'read'

/** One open file tab. */
export interface FileTab {
  /** KB-relative path; the tab's identity and its localStorage key. */
  readonly path: string
  /** Tab label: the file's display name. */
  readonly title: string
  /** Whether the tab edits the file or only shows it. */
  readonly mode: TabMode
}

/** Tab key of the permanent conversation tab — never closeable, never unmounted. */
export const CONVERSATION_TAB = 'conversation'

/** Tab key of the 任务 tab (ADR-0031). Flat since 2026-10-15: no more 任务
    hub with 提议/调度 sub-pages — each is its own centre tab. Closeable; the
    footer's 任务 switch reopens it. */
export const TASKS_TAB = 'tasks'

/** Tab key of the 提议 tab (ADR-0057's inbox; flat since 2026-10-15). Open by
    default and never closeable — the one fixed landing page beside 对话. */
export const INBOX_TAB = 'inbox'

/** Tab key of the 调度 tab (flat since 2026-10-15). Closeable; the footer's
    调度 switch reopens it. */
export const SCHEDULE_TAB = 'schedule'

/** Tab key of the 洞察 tab (ADR-0050; ADR-0057 merged 图谱 into it).
    Closeable since 2026-10-15: the footer's 洞察 switch reopens it. */
export const INSIGHTS_TAB = 'insights'

/** Which of the closeable fixed tabs (任务/调度/洞察) are open. 提议 is pinned
    open — it joins no persistence and offers no close button. */
export interface FixedTabsOpen {
  readonly tasks: boolean
  readonly schedule: boolean
  readonly insights: boolean
}

/** The fixed tabs a human may close — every fixed tab but the pinned 提议. */
export type ClosableFixedTab = Exclude<keyof FixedTabsOpen, never>

/** 任务/调度/洞察 all closed — the 2026-10-15 default: the boot lands on
    对话/提议 only; everything else opens from the footer on demand. */
export function defaultFixedTabs(): FixedTabsOpen {
  return { tasks: false, schedule: false, insights: false }
}

/** localStorage key for the fixed tabs' open state. New key on purpose: the
    old hubTabs preference recorded the opposite default (both open), so
    honouring it would fight this one. */
export const FIXED_TABS_STORAGE_KEY = 'yantao.center.fixedTabs'

/**
 * Read the persisted fixed-tab openness back. Persisted state is outside the
 * program: a hand-edited or older entry falls back to the all-closed default,
 * never fatal.
 * @param storage - the storage to read (defaults to `window.localStorage`).
 * @returns the open flags.
 */
export function restoreFixedTabs(storage: TabStorage = localStorage): FixedTabsOpen {
  const raw = storage.getItem(FIXED_TABS_STORAGE_KEY)
  if (raw === null) return defaultFixedTabs()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultFixedTabs()
  }
  if (typeof parsed !== 'object' || parsed === null) return defaultFixedTabs()
  const record = parsed as Record<string, unknown>
  return {
    tasks: typeof record.tasks === 'boolean' ? record.tasks : false,
    schedule: typeof record.schedule === 'boolean' ? record.schedule : false,
    insights: typeof record.insights === 'boolean' ? record.insights : false,
  }
}

/**
 * Persist the fixed tabs' open flags.
 * @param open - the flags to write.
 * @param storage - the storage to write (defaults to `window.localStorage`).
 */
export function persistFixedTabs(open: FixedTabsOpen, storage: TabStorage = localStorage): void {
  try {
    storage.setItem(FIXED_TABS_STORAGE_KEY, JSON.stringify(open))
  } catch {
    // Quota/private-mode failures swallow: a lost preference only costs the
    // default layout on the next boot.
  }
}

/**
 * KB-relative path of one run's distilled log — the mirror of the backend's
 * `runLogPath`, derived from the directory constant so the builder and the
 * {@link isRunLogPath} matcher cannot drift apart.
 */
export function WORKSPACE_RUN_LOG_PATH(runId: string): string {
  return `${WORKSPACE_RUN_LOG_DIR}/${runId}.log`
}

/**
 * Whether a path is a workspace run log — those tabs auto-follow while the
 * run is still appending (the file grows; polling stops when it settles).
 * @param path - KB-relative path.
 * @returns true when the file deserves the watch treatment.
 */
export function isRunLogPath(path: string): boolean {
  return path.startsWith(`${WORKSPACE_RUN_LOG_DIR}/`) && path.endsWith('.log')
}

/** The centre pane's tab state. */
export interface TabState {
  /** Open file tabs in open order. */
  readonly files: readonly FileTab[]
  /** The active tab key: a file path or {@link CONVERSATION_TAB}. */
  readonly active: string
}

/** localStorage key for the restored tab paths. */
export const TAB_STORAGE_KEY = 'yantao.center.tabs'

/** The slice of `window.localStorage` this module needs — a seam for tests. */
export interface TabStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The tab state with nothing open and the conversation active. */
export function emptyTabs(): TabState {
  return { files: [], active: CONVERSATION_TAB }
}

/**
 * The display name of one KB path: its basename, with the entity `.md`
 * suffix dropped the way the rails' rows already show it.
 * @param path - KB-relative path.
 * @returns the tab label.
 */
export function tabTitle(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.endsWith('.md') ? base.slice(0, -3) : base
}

/**
 * Whether a path is read-only for the workbench: 资源 originals are kept
 * byte-for-byte (ADR-0004's human channel still does not rewrite an original).
 * A `.md` note under `resources/` is not an original — a mail analysis saves
 * its resources that way — so it opens editable like any other note.
 * @param path - KB-relative path.
 * @returns true when the file opens read-only.
 */
export function readOnlyPath(path: string): boolean {
  if (path.endsWith('.md')) return false
  return path.startsWith('resources/') || path === 'resources'
}

/** Build one tab for a path, deriving its label and mode. */
export function tabFor(path: string, mode: TabMode): FileTab {
  return { path, title: tabTitle(path), mode }
}

/**
 * Open a file: an already-open path activates its existing tab instead of
 * earning a second one.
 * @param state - current tab state.
 * @param path - KB-relative path.
 * @param mode - whether the file opens editable.
 * @returns the next tab state.
 */
export function openTab(state: TabState, path: string, mode: TabMode): TabState {
  const existing = state.files.find(tab => tab.path === path)
  return existing === undefined
    ? { files: [...state.files, tabFor(path, mode)], active: path }
    : { files: state.files, active: path }
}

/**
 * Close one file tab. The conversation tab cannot be closed; closing the
 * active tab falls back to its left neighbour and finally to the conversation.
 * @param state - current tab state.
 * @param path - the file tab to close.
 * @returns the next tab state.
 */
export function closeTab(state: TabState, path: string): TabState {
  const index = state.files.findIndex(tab => tab.path === path)
  if (index < 0) return state
  const files = state.files.filter(tab => tab.path !== path)
  if (state.active !== path) return { files, active: state.active }
  const neighbour = files[index - 1]
  return { files, active: neighbour?.path ?? CONVERSATION_TAB }
}

/**
 * Activate one tab by key.
 * @param state - current tab state.
 * @param key - a file path or {@link CONVERSATION_TAB}.
 * @returns the next tab state.
 */
export function activateTab(state: TabState, key: string): TabState {
  return { files: state.files, active: key }
}

/**
 * The active file tab, when a file is active.
 * @param state - current tab state.
 * @returns the tab, or undefined while the conversation is active.
 */
export function activeFile(state: TabState): FileTab | undefined {
  return state.files.find(tab => tab.path === state.active)
}

/**
 * Read the persisted tab paths back.
 * @param storage - the storage to read (defaults to `window.localStorage`).
 * @returns the restored paths in order; a missing or unreadable entry yields none.
 */
export function restoreTabs(storage: TabStorage = localStorage): readonly string[] {
  const raw = storage.getItem(TAB_STORAGE_KEY)
  if (raw === null) return []
  // Persisted state is outside the program: a hand-edited or older entry is
  // dropped, never fatal.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Persist the open tab paths, one per tab, in open order.
 * @param state - current tab state.
 * @param storage - the storage to write (defaults to `window.localStorage`).
 */
export function persistTabs(state: TabState, storage: TabStorage = localStorage): void {
  storage.setItem(TAB_STORAGE_KEY, JSON.stringify(state.files.map(tab => tab.path)))
}
