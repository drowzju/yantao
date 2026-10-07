/**
 * The minimal `ctx.sidebarRight` provider (ADR-0011 取舍的收尾).
 *
 * Upstream 0.2.1 焊死了 ui-chat / ui-reference 对 `sidebarRight` 的 inject：
 * 不提供该服务，这两个插件就永远 pending。上游的提供者
 * ui-sidebar-right 依赖插件 ui-layout —— 正是 ADR-0011 特意移除的框架，
 * 不能回流。好在 roster 内的实际消费面只有一招：`openResource(地址)`，
 * 把 `dsh-resource://file/...` 打开成右栏标签页。本适配器把它映射到
 * 工作台自己的中栏文件 tab；`openTab('browser')` 不实现——ui-chat 在
 * `sidebarRightTabs` 缺席时本来就回退 `window.open`，行为不变。
 */

import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The face the mounted frame fills; earlier calls are silent no-ops. */
export interface SidebarRightFileSeat {
  /** Open a KB-relative path in the centre pane's file tab. */
  openFile(path: string): void
}

/** A seat whose member is a no-op until the frame claims it. */
export function createSidebarRightFileSeat(): SidebarRightFileSeat {
  return { openFile: () => {} }
}

/** Strip `prefix` from `path` case-insensitively (Windows drive letters). */
function stripRoot(path: string, prefix: string): string | undefined {
  if (prefix === '' || !path.toLowerCase().startsWith(prefix.toLowerCase())) return undefined
  const rest = path.slice(prefix.length).replace(/^[\\/]+/, '')
  return rest === '' ? undefined : rest
}

/**
 * The `sidebarRight` face the workbench provides: file addresses open as
 * centre-pane tabs. A session-scoped relative path is KB-relative as-is
 * (ADR-0013 aligned the session cwd to the KB root); an absolute path is
 * accepted only inside the KB root, and is stripped to its KB-relative
 * spelling. The `line` navigation parameter upstream threads through
 * `openResource` options is dropped — the reading view has heading anchors,
 * not line anchors (ADR-0048 一期).
 */
export class WorkbenchSidebarRight {
  readonly #seat: SidebarRightFileSeat
  readonly #kbRoot: () => Promise<string>

  /** @param seat - the mutable seat the frame fills on mount. @param kbRoot - absolute KB root resolver. */
  constructor(seat: SidebarRightFileSeat, kbRoot: () => Promise<string>) {
    this.#seat = seat
    this.#kbRoot = kbRoot
  }

  /**
   * Open one file address in the workbench. Unrecognized addresses and paths
   * outside the KB root are reported and dropped: a broken citation must not
   * throw into the caller's click handler.
   * @param address - a `dsh-resource://file/...` address.
   * @param options - upstream's navigation options; only `params.line` may
   *   appear and it is ignored (see module comment).
   */
  openResource(address: string, options?: { params?: { line?: number } }): void {
    void options
    void this.#open(address).catch((reason: unknown) => {
      console.warn('sidebarRight: failed to open', address, reason)
    })
  }

  async #open(address: string): Promise<void> {
    const parsed = parseFileAddress(address)
    if (parsed === undefined) {
      console.warn('sidebarRight: unrecognized file address', address)
      return
    }
    const raw = parsed.path.replace(/\\/g, '/')
    if (parsed.scope === 'session' && !/^([A-Za-z]:[/\\]|\/)/.test(raw)) {
      this.#seat.openFile(raw)
      return
    }
    // The host root carries native separators (`C:\…` on Windows); parsed
    // addresses are always `/`-separated, so compare in one spelling.
    const root = (await this.#kbRoot()).replace(/\\/g, '/')
    const relative = stripRoot(raw, root)
    if (relative === undefined) {
      console.warn('sidebarRight: path outside the KB root is not openable here', raw)
      return
    }
    this.#seat.openFile(relative)
  }
}
