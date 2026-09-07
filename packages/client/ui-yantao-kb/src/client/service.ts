/**
 * The workbench's cross-scope service: which KB file is selected, the tree
 * payload behind the sidebar, and the read/write actions over the yantaoKb
 * Remote. Kept as one cordis service because the sidebar (root scope) and
 * the editor (session scope) may not share a store handle; both consume this
 * service's observable source and callbacks through their own inject faces.
 * @module @deepseek-ai/dsh-client-ui-yantao-kb/service
 */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { KbFileContent, KbTree, KbWriteResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'

/** The yantaoKb namespace's callable surface, structurally satisfied by the mounted contribution. */
export interface KbRpc {
  tree(): Promise<RemoteResult<KbTree>>
  read(path: string): Promise<RemoteResult<KbFileContent>>
  write(path: string, content: string): Promise<RemoteResult<KbWriteResult>>
}

/** The workbench's published state. */
export interface KbWorkbenchSnapshot {
  /** The KB-relative path open in the editor, or null. */
  readonly selection: string | null
  /** The latest tree payload, or null before the first successful load. */
  readonly tree: KbTree | null
  /** The last tree-load failure's message, or null. */
  readonly treeError: string | null
}

const INITIAL: KbWorkbenchSnapshot = { selection: null, tree: null, treeError: null }

/**
 * Selection, tree data, and file actions for the yantao workbench. The
 * snapshot reference only changes on publication, and every publication
 * notifies subscribers in the same step — the renderer's hook binding can
 * cache by both identities.
 */
export class KbWorkbench {
  private snapshot: KbWorkbenchSnapshot = INITIAL
  private readonly listeners = new Set<() => void>()

  /** The bare observable the renderer binds to `useWorkbench`. */
  readonly source: ObservableSnapshot<KbWorkbenchSnapshot> = {
    getSnapshot: () => this.snapshot,
    subscribe: (fn) => {
      this.listeners.add(fn)
      return () => {
        this.listeners.delete(fn)
      }
    },
  }

  constructor(private readonly rpc: KbRpc) {}

  private publish(next: Partial<KbWorkbenchSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }

  /** Select one file for the editor (null clears). */
  readonly select = (path: string | null): void => {
    if (this.snapshot.selection === path) return
    this.publish({ selection: path })
  }

  /** Load (or reload) the tree, recording a failure without discarding the last good payload. */
  readonly refreshTree = async (): Promise<void> => {
    const result = await this.rpc.tree()
    if (!result.ok) {
      this.publish({ treeError: result.error.message })
      return
    }
    this.publish({ tree: result.value, treeError: null })
  }

  /**
   * Read one file's complete content.
   * @throws the Remote failure (callers branch on `code`).
   */
  readonly readFile = async (path: string): Promise<string> => {
    const result = await this.rpc.read(path)
    if (!result.ok) throw result.error
    return result.value.content
  }

  /**
   * Write one file's complete content, then refresh the tree so a newly
   * created file surfaces.
   * @throws the Remote failure (callers branch on `code`).
   */
  readonly writeFile = async (path: string, content: string): Promise<void> => {
    const result = await this.rpc.write(path, content)
    if (!result.ok) throw result.error
    await this.refreshTree()
  }
}
