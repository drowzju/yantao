/**
 * The yantao desktop shell (ADR-0016).
 *
 * It owns four things and nothing else:
 *
 * 1. **A window and a tray.** One icon, one window, no browser tab to lose it in.
 * 2. **The host process.** The dsh host runs as a *child* process on the system
 *    Node, not inside Electron — see `bootHost` for why.
 * 3. **The URL handoff.** The child prints `dsh web: http://…`; the shell waits
 *    for that line and loads it.
 * 4. **A restart affordance.** The host can be relaunched without tearing the
 *    window down, which is what makes editing the host bearable.
 * 5. **A notify bridge.** The renderer's one channel out (`preload.cjs`):
 *    while the window sits hidden in the tray, a finished background run (the
 *    mail analysis) can still reach the human as a system notification.
 *
 * The window appears immediately with a "启动中" page rather than after boot:
 * the boot is slow (see ADR-0016) and a blank desktop reads as a crash.
 *
 * What it deliberately does not do: no hotkeys, no auto-start, no signing, no
 * auto-update, no installer.
 * @module @deepseek-ai/dsh-yantao-desktop/main
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, session, Tray } from 'electron'

/**
 * Repository root. This file is `apps/yantao-desktop/src/main.ts`, so the
 * module URL's directory is `…/apps/yantao-desktop/src/` and the root is three
 * levels up — `../..` lands on `apps/`, which is one short.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url))

/** This file's own directory (`…/apps/yantao-desktop/src/`) — ESM has no `__dirname`. */
const HERE = fileURLToPath(new URL('.', import.meta.url))

/** The dsh launcher the shell spawns. */
const CLI = join(REPO, 'apps', 'cli', 'src', 'bin.ts')

/** Which profile the host runs. `yantao-web` keeps live patch reload (HMR). */
const PROFILE = 'yantao-web'

/** How long to wait for the host to print its URL before giving up. */
const HOST_BOOT_TIMEOUT_MS = 180_000

/** How long the workbench navigation may take before it is declared stuck. */
const WORKBENCH_LOAD_TIMEOUT_MS = 60_000

/**
 * The tray icon: the PARAP monogram on a warm-paper badge, rasterised from the
 * same geometry as `packages/client/ui-yantao/src/client/brand/YantaoMark.tsx`
 * by `scripts/gen-tray-icon.mjs` (analytic shapes + supersampling, PNG via
 * node:zlib). A badge rather than a bare glyph because the tray sits on dark
 * taskbars by default but light ones exist — ink on nothing vanishes on one of
 * the two. Regenerate and paste if the mark itself ever changes.
 */
const TRAY_ICON_16 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABGklEQVR42mNggAI9bTVGPW01YT1tNSU9bTVlHFgJqoaRARnoaatx7tq5tfn1q+cvfv/6/h8fBqkBqQXpgdsMEoAp+PH9y/+fP77+f/f2FRx///YZwyCoIYwgA4RhNj95fP+/jZXp/4jQgP962mpwbKin+T8nK+3/82ePUVwC0gsyQAkmeOLYYRSNIGxlbvTfQFcDzI4KD/7/6+c3uCEgvSADlPEZAPLClUvn/+vrqIP5V69cRDZAmSgD3rx+/t9IXwvMP3/uFGkGZGUk//dwcwSzXZxs/3/7+ok0A2AYpBnZdrwGONpZgdkwfO7sSRSbCRrg4erwn1CCQjZAiQIDlLAmpML87P/EJGlYQsJIysTYDk/KFGcmSrMzAH+zhC2FDZfeAAAAAElFTkSuQmCC'
const TRAY_ICON_32 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB40lEQVR42mNgGKxAT1uNSU9bTVBPW01BT1tNmUysADWDiSSLmxtrbS6cP7361ctnz3/++Pr396/v/8nBIL0gM0Bmgcwk6BA9bTX23bu2tX77+uknuZbiwiAzQWaD7MDpc5ACaluMjqGOwAwJUBDh8vnH92/+//r57f+P71/+v3v7CicmNiRAdmH4HhRP6Io/f3r/Pz0l4b+ettp/DzfH/8uWLACzcWFrC+P/FaWF/2/euIrXESC7UEIBlFJBiQVd4Ypli1AssLUyw+sAGDYx1Pm/ZtUynA4A2QWyE9kBCthS+9TJ/URZiA0b6Gr8P7h/N87cAbIT2QHK2BQS44Agf+//IUG+/y3MDDHkvD2cQZZhdQTITqo4AJb4vnz+8L+kKA9D/uiRA/RxAAi/f/f6v5G+For83NnT6ecAELYyN0KRnzZlAv0csHvnNgz5jetX09YBoLJh3ZqV/7s7W/+bGumiyBkbaP9/8fwxbR2AD7e3NuIsC2jugOiIEHBJSncHGOpp/m9pqsNrOdkO8HB1AIvhwqC08PzZY6IqJbIckBgfRbVqedQBg84BRFXH1HIAtuqYqAZJQV4WVRyArUFCVJOMUFOLWIzRJCO2UUqt5jlGo3RQNMsHvGMyKLpmg6JzSm8AALYjupHDj46WAAAAAElFTkSuQmCC'

/** The page shown while the host boots. */
const LOADING_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<html><body style="margin:0;display:flex;align-items:center;justify-content:center;'
  + 'height:100vh;background:#fbfaf7;color:#6b6455;font:14px system-ui,\'Microsoft YaHei\',sans-serif">'
  + '正在启动 yantao 工作台…</body></html>',
)

let tray: Tray | undefined
let window: BrowserWindow | undefined
let host: ChildProcess | undefined

/**
 * Set once `app.quit()` is underway. The close handler folds the window into
 * the tray during everyday life, but `preventDefault` on close also cancels a
 * quit — without this flag a boot failure's `app.quit()` leaves a zombie shell
 * hiding behind the tray instead of exiting (seen 2026-09-22).
 */
let quitting = false

/**
 * The Node to run the host with.
 *
 * `process.execPath` is Electron itself, and spawning that would start a second
 * Electron (and a second window). So when it is not a Node binary we fall back
 * to `node` and let PATH resolve it.
 * @returns the program to spawn.
 */
function nodeProgram(): string {
  const exe = process.execPath
  return basename(exe).toLowerCase().startsWith('node') ? exe : 'node'
}

/**
 * Start the dsh host as a child process and resolve the workbench URL it prints.
 *
 * Why a child process and not `runProfile()` in here:
 *
 * - **Native modules.** The host's `session-persistence-jsonl` loads `fs-ext`,
 *   which is compiled against the *system* Node's ABI. Inside Electron it has to
 *   be rebuilt against Electron's ABI instead — and then the CLI (a documented
 *   everyday command) breaks with the mirror-image error. One `.node` file
 *   cannot serve two Node versions, so in-process makes the CLI and the shell
 *   mutually exclusive.
 * - **Live reload.** The `yantao-web` profile is `patchReload: 'live'`, which
 *   mounts the host HMR row, which needs Node's `--expose-internals`. Electron
 *   never forwards node flags to its main process (passing
 *   `electron --expose-internals .` does nothing), so in-process loses HMR. A
 *   child process gets the flag.
 *
 * It costs roughly 200–300 MB of resident memory and does not change boot time:
 * measured, the CLI boots in 22.6 s and the in-process shell in 22.2 s.
 * @returns the spawned child and a promise for its URL.
 */
function bootHost(): { child: ChildProcess; url: Promise<string> } {
  const child = spawn(
    nodeProgram(),
    // `--expose-internals` is what lets the profile's HMR row load; without it
    // the host fails with "--expose-internals is required for HMR service".
    ['--import', 'tsx/esm', '--expose-internals', CLI, '--profile', PROFILE, '--port', '0', '--no-open'],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )

  const url = new Promise<string>((resolve, reject) => {
    let settled = false
    let buffered = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('yantao: the host did not print a workbench URL in time'))
    }, HOST_BOOT_TIMEOUT_MS)

    const finish = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }

    // Not optional-chained: `stdio` is `pipe`, so both streams exist by type.
    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8')
      const line = buffered.split(/\r?\n/).find(candidate => /^dsh web: http/.test(candidate))
      if (line === undefined) return
      const found = /^dsh web: (\S+)/.exec(line)?.[1]
      if (found === undefined) return
      settled = true
      clearTimeout(timer)
      resolve(found)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[host] ${chunk.toString('utf8')}`)
    })
    child.on('error', (error: Error) => {
      finish(new Error(`yantao: could not start the host (${error.message}). Is node on PATH?`))
    })
    child.on('exit', (code: number | null) => {
      finish(new Error(`yantao: the host exited before it printed a URL (code ${code ?? 'unknown'})`))
    })
  })

  return { child, url }
}

/** Stop the host child, if one is running. */
function stopHost(): void {
  if (host === undefined || host.exitCode !== null) return
  hostExitExpected = true
  host.kill()
  host = undefined
}

/**
 * Set when the host's exit is our own doing (`stopHost`), so the death watch
 * stays quiet about planned shutdowns and restarts.
 */
let hostExitExpected = false

/**
 * Complain loudly once the host dies after its URL was handed over.
 *
 * `bootHost`'s own exit handler only guards the boot window: once the URL
 * promise has settled, a later host death reaches nobody — the window keeps
 * pointing at a dead server (seen 2026-09-22). Arming right after the URL
 * resolves closes that gap; recovery is the human's move via the tray, so the
 * shell never restarts a host on its own.
 * @param started the running host and its URL promise.
 */
function armHostDeathWatch(started: { child: ChildProcess; url: Promise<string> }): void {
  void started.url.then(() => {
    started.child.on('exit', () => {
      if (hostExitExpected) {
        hostExitExpected = false
        return
      }
      console.error('yantao: the host exited unexpectedly — use the tray\'s 重启宿主')
      const notice = new Notification({ title: 'yantao 宿主已退出', body: '工作台的后端进程意外退出，请右键托盘图标选择「重启宿主」。' })
      notice.show()
    })
  }).catch(() => { /* boot failed; bootHost's own error path covers it */ })
}

/**
 * The auth cookie's name prefix — `COOKIE_PREFIX` in
 * `packages/client/connection/src/browser-auth.ts`. Duplicated as a literal so
 * the shell keeps zero workspace dependencies.
 */
const AUTH_COOKIE_PREFIX = 'dsh-auth-'

/**
 * Drop the auth cookies left over by earlier host boots, before the workbench
 * is loaded.
 *
 * Every boot runs the host on a random port (`--port 0`), and the cookie name
 * embeds that port, so each boot mints a brand-new persistent cookie that no
 * later boot overwrites or expires. The jar grows by one cookie per boot until
 * the Cookie header crosses the server's request-header cap and the workbench
 * index is refused with 431 — an empty, purely white page (hit on 2026-09-22
 * with 70 accumulated cookies, a 15,958-byte header). The navigation that
 * follows authenticates via the URL's launch token and mints one fresh cookie,
 * so dropping the stale ones costs nothing.
 * @returns when the jar holds no stale auth cookies.
 */
async function purgeStaleAuthCookies(): Promise<void> {
  const jar = session.defaultSession.cookies
  const stale = (await jar.get({})).filter(cookie => cookie.name.startsWith(AUTH_COOKIE_PREFIX))
  if (stale.length === 0) return
  for (const cookie of stale) {
    await jar.remove(`http://${cookie.domain}${cookie.path}`, cookie.name)
  }
  console.log(`yantao: dropped ${stale.length} stale auth cookie${stale.length === 1 ? '' : 's'}`)
}

/**
 * Load the workbench URL with a deadline.
 *
 * `loadURL` resolves on any HTTP response — and can pend forever when the
 * renderer's network service wedges at birth, leaving a white window while the
 * shell waits on the await below (seen 2026-09-22). A deadline turns that
 * silent hang into a surfaced failure.
 * @param target the window to navigate.
 * @param url the workbench URL printed by the host.
 * @returns when the navigation settled (any HTTP status included).
 */
async function loadWorkbench(target: BrowserWindow, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`yantao: the workbench page did not finish loading in ${WORKBENCH_LOAD_TIMEOUT_MS / 1000}s — navigation stuck`))
    }, WORKBENCH_LOAD_TIMEOUT_MS)
    target.loadURL(url).then(
      () => { clearTimeout(timer); resolve() },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

function buildTray(onRestart: () => void): void {
  tray?.destroy()
  // Both densities ride one image: 16px at scale 1, 32px as its scale-2 twin,
  // so HiDPI trays pick the sharp one instead of upscaling the small.
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 1, dataURL: TRAY_ICON_16 })
  image.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_32 })
  tray = new Tray(image)
  tray.setToolTip('yantao')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开', click: () => { window?.show() } },
    // Editing the host (or rebuilding client bundles) needs a host restart;
    // doing it here keeps the window and the tray alive.
    { label: '重启宿主', click: onRestart },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit() } },
  ]))
  tray.on('click', () => { window?.show() })
}

function ensureWindow(): BrowserWindow {
  if (window !== undefined) return window
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'yantao 工作台',
    show: false,
    // The host is loopback-only and hands out its own launch token; nothing here
    // needs Node in the renderer, and keeping it out is the point of the trust
    // boundary. The preload adds exactly one channel back out: `yantao.notify`.
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Plain JavaScript: the preload loads in the renderer directly, outside
      // the tsx loader that runs this file.
      preload: join(HERE, 'preload.cjs'),
    },
  })
  window.on('closed', () => {
    window = undefined
  })
  // Closing the window minimises to the tray; 退出 in the tray menu is the way
  // out. A workbench that quits when you close its window loses your tabs.
  // A genuine quit (tray 退出, boot failure) passes through: see `quitting`.
  window.on('close', (event) => {
    if (quitting || tray === undefined) return
    event.preventDefault()
    window?.hide()
  })
  window.once('ready-to-show', () => { window?.show() })
  return window
}

/** Boot the host again and point the existing window at the new URL. */
async function restartHost(): Promise<void> {
  stopHost()
  const target = ensureWindow()
  await target.loadURL(LOADING_PAGE)
  const started = bootHost()
  host = started.child
  armHostDeathWatch(started)
  await purgeStaleAuthCookies()
  try {
    await loadWorkbench(target, await started.url)
    console.log('yantao: host restarted')
  } catch (error: unknown) {
    console.error('yantao: host restart failed', error)
  }
}

async function main(): Promise<void> {
  await app.whenReady()

  // The notify bridge's other half. Only a hidden window earns a system
  // notification — a visible one shows the run in place, and doubling it up
  // would train the human to ignore the pop-ups. Clicking brings the window
  // back, which is the whole point: something is waiting there.
  ipcMain.on('yantao:notify', (_event, message: unknown) => {
    if (window === undefined || window.isVisible()) return
    const title = (message as { title?: unknown } | null)?.title
    const body = (message as { body?: unknown } | null)?.body
    if (typeof title !== 'string' || typeof body !== 'string' || title === '') return
    const notice = new Notification({ title, body })
    notice.on('click', () => {
      window?.show()
      window?.focus()
    })
    notice.show()
  })

  // Electron 默认挂一条 File/Edit/View/Window/Help 菜单栏，工作台用不上（顺带
  // 也失去了 F12 调试入口）；托盘已经够用。
  Menu.setApplicationMenu(null)

  // A refused main frame (401, 431, …) renders as a blank page; without this
  // the shell logs «ready» for a page the server rejected (seen 2026-09-22 as
  // a cookie-jar-overflow 431 — an all-white window with zero complaints).
  session.defaultSession.webRequest.onCompleted((details) => {
    if (details.resourceType === 'mainFrame' && details.statusCode >= 400) {
      console.error(`yantao: the workbench page was refused (HTTP ${details.statusCode}): ${details.url}`)
    }
  })

  const target = ensureWindow()
  await target.loadURL(LOADING_PAGE)
  target.show()

  buildTray(() => {
    void restartHost()
  })

  const started = bootHost()
  host = started.child
  armHostDeathWatch(started)
  await purgeStaleAuthCookies()
  await loadWorkbench(target, await started.url)
  console.log('yantao: workbench ready')
}

app.on('before-quit', () => {
  quitting = true
  stopHost()
})

void main().catch((error: unknown) => {
  console.error('yantao: desktop shell failed to start', error)
  app.quit()
})
