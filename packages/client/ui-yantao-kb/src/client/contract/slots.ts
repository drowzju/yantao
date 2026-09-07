/**
 * Slot contract for the yantao workbench plugin: the registrant-side props
 * compositions for the layout-owned `sidebar` and `details` slots. The
 * plugin occupies `sidebar` (ui-sidebar is disabled in the yantao-web
 * roster, freeing the brand/settings declarations it re-declares) and
 * shadows `details` with the KB editor.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls ui-layout's SlotMap merge ('sidebar' and 'details' entries)
// and ui-sidebar's merges for the brand/settings holes this plugin re-declares.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { KbWorkbenchSnapshot } from '../service.ts'

/** Injected share of the sidebar occupant: workbench data, session list, and shell callbacks. */
export interface KbSidebarInjected {
  hooks: {
    /** Selection, tree payload, and tree error. */
    workbench: ObservableSnapshot<KbWorkbenchSnapshot>
    /** Live chat-session rows for the 会话 section. */
    kbSessions: ObservableSnapshot<SessionListState>
  }
  /** Select one KB file for the editor (null clears). */
  selectFile: (path: string | null) => void
  /** Reload the tree from the host. */
  refreshTree: () => void
  /** Open one chat session in the conversation column. */
  openSession: (id: string) => void
  /** Start a new chat session (current, then recent workspace). */
  newSession: () => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
}

/** Full props of the KB sidebar shell. */
export type KbSidebarComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<'sidebar.brand.mark' | 'sidebar.brand.name' | 'sidebar.settings'>
  & InjectFace<KbSidebarInjected>
  & PropsLocale<'yantao-kb'>

/** Injected share of the details (editor) occupant. */
export interface KbEditorInjected {
  hooks: {
    /** Selection, tree payload, and tree error. */
    workbench: ObservableSnapshot<KbWorkbenchSnapshot>
  }
  /** Load one file's complete content; throws the Remote failure. */
  loadFile: (path: string) => Promise<string>
  /** Save one file's complete content; throws the Remote failure. */
  saveFile: (path: string, content: string) => Promise<void>
}

/** Full props of the KB editor panel. */
export type KbEditorComponentProps =
  PropsRuntime<'details'>
  & InjectFace<KbEditorInjected>
  & PropsLocale<'yantao-kb'>
