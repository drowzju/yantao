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
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'

/**
 * Repository root. This file is `apps/yantao-desktop/src/main.ts`, so the
 * module URL's directory is `…/apps/yantao-desktop/src/` and the root is three
 * levels up — `../..` lands on `apps/`, which is one short.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url))

/** The dsh launcher the shell spawns. */
const CLI = join(REPO, 'apps', 'cli', 'src', 'bin.ts')

/** Which profile the host runs. `yantao-web` keeps live patch reload (HMR). */
const PROFILE = 'yantao-web'

/** How long to wait for the host to print its URL before giving up. */
const HOST_BOOT_TIMEOUT_MS = 180_000

/**
 * A 1×1 placeholder. There is no icon yet; a tray with no image fails to
 * construct on some builds, so an empty pixel beats a crash.
 */
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
  host.kill()
  host = undefined
}

function buildTray(onRestart: () => void): void {
  tray?.destroy()
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON))
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
    // boundary.
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  window.on('closed', () => {
    window = undefined
  })
  // Closing the window minimises to the tray; 退出 in the tray menu is the way
  // out. A workbench that quits when you close its window loses your tabs.
  window.on('close', (event) => {
    if (tray === undefined) return
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
  try {
    await target.loadURL(await started.url)
    console.log('yantao: host restarted')
  } catch (error: unknown) {
    console.error('yantao: host restart failed', error)
  }
}

async function main(): Promise<void> {
  await app.whenReady()

  // Electron 默认挂一条 File/Edit/View/Window/Help 菜单栏，工作台用不上（顺带
  // 也失去了 F12 调试入口）；托盘已经够用。
  Menu.setApplicationMenu(null)

  const target = ensureWindow()
  await target.loadURL(LOADING_PAGE)
  target.show()

  buildTray(() => {
    void restartHost()
  })

  const started = bootHost()
  host = started.child
  await target.loadURL(await started.url)
  console.log('yantao: workbench ready')
}

app.on('before-quit', () => {
  stopHost()
})

void main().catch((error: unknown) => {
  console.error('yantao: desktop shell failed to start', error)
  app.quit()
})
