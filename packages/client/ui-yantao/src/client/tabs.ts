/**
 * The centre pane's tab model: open files as tabs beside one permanent 对话
 * tab. Pure — no React, no Remote — so the dedupe, the close-neighbour rule,
 * and the localStorage round-trip are pinned by unit tests instead of by a
 * rendered tree.
 * @module @deepseek-ai/dsh-client-ui-yantao/tabs
 */

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
 * byte-for-byte (ADR-0004's human channel still does not rewrite an original),
 * everything else is editable.
 * @param path - KB-relative path.
 * @returns true when the file opens read-only.
 */
export function readOnlyPath(path: string): boolean {
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
