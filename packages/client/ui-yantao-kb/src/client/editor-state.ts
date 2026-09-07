/**
 * Pure editor state transitions and KB path rules. Kept free of React and
 * services so the package's unit tests drive them directly (the sanctioned
 * zero-machinery path).
 * @module @deepseek-ai/dsh-client-ui-yantao-kb/editor-state
 */

/** The editor's saved/draft pair behind the dirty flag. */
export interface EditorState {
  /** The content as last loaded or saved. */
  readonly saved: string
  /** The content as currently edited. */
  readonly draft: string
}

/** A fresh state for freshly loaded content.
 * @param content - the content as loaded from disk.
 * @returns a clean state whose saved baseline and draft both equal the content.
 */
export function initialEditorState(content: string): EditorState {
  return { saved: content, draft: content }
}

/** Whether the draft diverges from the saved content.
 * @param state - the editor's saved/draft pair.
 * @returns true when the draft differs from the saved baseline.
 */
export function isDirty(state: EditorState): boolean {
  return state.draft !== state.saved
}

/** Replace the draft, keeping the saved baseline.
 * @param state - the editor's saved/draft pair.
 * @param draft - the new draft text.
 * @returns the state with the draft replaced.
 */
export function withDraft(state: EditorState, draft: string): EditorState {
  return { ...state, draft }
}

/** Mark the current draft as the saved baseline.
 * @param state - the editor's saved/draft pair.
 * @returns the state with the draft promoted to the saved baseline.
 */
export function withSaved(state: EditorState): EditorState {
  return { saved: state.draft, draft: state.draft }
}

/**
 * Whether a KB-relative path names a read-only original: `resources/`
 * originals are never rewritten (the KB's own contract), while their `.md`
 * shadow notes are editable.
 * @param path - KB-relative path with forward slashes.
 * @returns true when the path is a `resources/` original that the editor must not save.
 */
export function isReadOnlyKbPath(path: string): boolean {
  return path.startsWith('resources/') && !path.endsWith('.md')
}

/** The five tree section ids in display order, mapped to their dictionary keys. */
export const SECTION_LABEL_KEYS = {
  resources: 'section.resources',
  projects: 'section.projects',
  areas: 'section.areas',
  people: 'section.people',
  sessions: 'section.sessions',
} as const
