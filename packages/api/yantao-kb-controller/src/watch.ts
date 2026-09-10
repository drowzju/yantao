/**
 * A revision counter over the KB root (ADR-0017).
 *
 * The UI polls `yantaoKb.revision()` instead of subscribing to pushed events.
 * Pushing would mean adding `yantao-kb/changed` to the upstream allowlist in
 * `packages/api/remotes/src/remote-events.ts`, which sits outside the merge
 * surface — and the merge surface is the upgrade cost. One counter and a poll
 * answers the only question the UI actually has: "did anything change?"
 *
 * A debounce keeps one save (editor temp file + rename + write) from reporting
 * three revisions, and keeps `linksOf`'s full-KB re-read from running per event.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/watch
 */
import { watch, type FSWatcher } from 'chokidar'

/** How long the counter waits for a burst of filesystem events to settle. */
export const REVISION_DEBOUNCE_MS = 150

/** How deep below the root changes are watched; the KB is `entities/<kind>/<file>.md`. */
const WATCH_DEPTH = 4

/** Options of {@link KbRevision}. */
export interface KbRevisionOptions {
  /** Overrides {@link REVISION_DEBOUNCE_MS}; tests pass a short one. */
  readonly debounceMs?: number
}

/**
 * One debounced change counter over one directory.
 *
 * `follow` is idempotent for the directory already watched, so it can be called
 * on every poll: the KB root is mutable (`setRoot`), and a watcher that never
 * re-points would silently watch a directory nobody edits any more.
 */
export class KbRevision {
  private watcher: FSWatcher | undefined
  private timer: NodeJS.Timeout | undefined
  private followed: string | undefined
  private counter = 0

  /**
   * @param options - debounce override.
   */
  constructor(private readonly options: KbRevisionOptions = {}) {}

  /** The counter's current value; it only ever grows while one root is followed. */
  get revision(): number {
    return this.counter
  }

  /** The directory currently watched, or undefined after {@link close}. */
  get root(): string | undefined {
    return this.followed
  }

  /**
   * Watch `root`, replacing the previous watcher when the root moved.
   * @param root - absolute directory path.
   */
  follow(root: string): void {
    if (this.followed === root) return
    this.close()
    this.followed = root
    this.watcher = watch(root, { ignoreInitial: true, depth: WATCH_DEPTH })
    this.watcher.on('all', () => {
      this.bump()
    })
    this.watcher.on('error', () => {
      // A watch that dies is a degraded refresh, not a broken workbench: the
      // UI keeps whatever revision it last saw and the next poll re-follows.
      this.close()
    })
  }

  /** Stop watching and drop the pending debounce. */
  close(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    void this.watcher?.close()
    this.watcher = undefined
    this.followed = undefined
  }

  /** Schedule one counter bump; a burst collapses into a single one. */
  private bump(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.counter += 1
    }, this.options.debounceMs ?? REVISION_DEBOUNCE_MS)
    // Never hold the process open for a pending bump.
    this.timer.unref()
  }
}
