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
 * What it deliberately does not do: no hotkeys beyond the reload chord
 * (Ctrl+Shift+R, the escape hatch for a wedged page), no auto-start, no signing,
 * no auto-update, no installer.
 * @module @deepseek-ai/dsh-yantao-desktop/main
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Notification, session, Tray } from 'electron'

/**
 * The user-data folder is named after the app, and the scoped package name
 * would bury it under `@deepseek-ai/`. Set it before anything asks for a path.
 */
app.setName('yantao-workbench')

/** This file's own directory (`…/apps/yantao-desktop/src/`; packaged: `…/dist/`). */
const HERE = fileURLToPath(new URL('.', import.meta.url))

/**
 * Write one line to the shell's own log beside the app's data, and to stdout.
 *
 * A packaged Electron app has no console — a GUI subsystem process writes its
 * `console.log` into nothing — so a boot that fails before the host is up
 * leaves no trace at all. This file is what the human can send back.
 * @param line - what happened, in one line.
 */
function log(line: string): void {
  console.log(line)
  try {
    const directory = app.getPath('userData')
    mkdirSync(directory, { recursive: true })
    appendFileSync(join(directory, 'shell.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // Logging must never be the reason a boot fails.
  }
}

/**
 * Repository root — for the development build this is the checkout the shell
 * was started from. Three sources, first match wins:
 *
 * 1. `YANTAO_REPO` environment override (a moved checkout);
 * 2. `repo-path.txt` beside this module — written by pack-win at pack time,
 *    because an asar has no repository three levels above it;
 * 3. three levels up from this file — the development layout
 *    (`apps/yantao-desktop/src/main.ts` → repo root).
 *
 * The release build never calls this: it ships its own runtime tree and
 * `REPO` resolves to that instead (see {@link PACKAGED}).
 */
function resolveRepo(): string {
  const override = process.env.YANTAO_REPO
  if (override !== undefined && existsSync(join(override, 'apps', 'cli', 'src', 'bin.ts'))) return override
  const marker = join(HERE, 'repo-path.txt')
  if (existsSync(marker)) {
    const recorded = readFileSync(marker, 'utf8').trim()
    if (recorded !== '' && existsSync(join(recorded, 'apps', 'cli', 'src', 'bin.ts'))) return recorded
  }
  return fileURLToPath(new URL('../../..', import.meta.url))
}

/**
 * The runtime tree a release build ships beside the exe.
 *
 * `electron .` from the checkout has no such tree; the release archive has
 * `resources/runtime`, materialized by `scripts/pack-release.mjs`. Its
 * presence — not `app.isPackaged` alone — decides the mode, so a development
 * launch of a packed shell still behaves like development.
 */
const RUNTIME = join(process.resourcesPath, 'runtime')

/** Whether this process runs the shipped runtime instead of the checkout. */
const PACKAGED = app.isPackaged && existsSync(join(RUNTIME, 'apps', 'cli', 'lib', 'bin.js'))

/** Where the host's code lives: the shipped tree, or the checkout. */
const REPO = PACKAGED ? RUNTIME : resolveRepo()

/**
 * The dsh launcher the shell spawns.
 *
 * Development runs the TypeScript entry through tsx (live patch reload, HMR).
 * The release build runs the compiled entry with plain node — no tsx in the
 * archive and no `.ts` sources — so the tree it boots is exactly what was
 * packed.
 */
const CLI = PACKAGED ? join(RUNTIME, 'apps', 'cli', 'lib', 'bin.js') : join(REPO, 'apps', 'cli', 'src', 'bin.ts')

/** tsx is a development loader; the compiled entry needs no import hook. */
const CLI_LOADER = PACKAGED ? [] : ['--import', 'tsx/esm']

/**
 * Which profile the host runs. `yantao-web` in both modes: the profile
 * template is compiled into app-boot, so a fresh home initializes it on first
 * launch. What differs is the home itself — see {@link hostEnv}.
 */
const PROFILE = 'yantao-web'

/**
 * The host child's environment.
 *
 * Development shares `~/.dsh` with everything else on the machine. A release
 * build keeps its own home under the app's userData: the profile, the session
 * store and the credentials belong to the human who installed it, never to the
 * builder.
 * @returns the environment to spawn the host with.
 */
function hostEnv(): NodeJS.ProcessEnv {
  if (!PACKAGED) return process.env
  return { ...process.env, DSH_HOME: join(app.getPath('userData'), 'dsh-home') }
}

/** How long to wait for the host to print its URL before giving up. */
const HOST_BOOT_TIMEOUT_MS = 180_000

/** How long the workbench navigation may take before it is declared stuck. */
const WORKBENCH_LOAD_TIMEOUT_MS = 60_000

/**
 * The tray/window icon: the YT monogram — ink letters on a white badge,
 * rasterised by `scripts/gen-tray-icon.mjs` (analytic strokes + supersampling,
 * PNG via node:zlib). A badge rather than bare letters because the tray sits
 * on dark taskbars by default but light ones exist — ink on nothing vanishes
 * on one of the two. Regenerate and paste if the mark itself ever changes.
 */
const TRAY_ICON_16 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABH0lEQVR42mNggAI9bTVGPW01YT1tNSU9bTVlHFgJqoaRARnoaatx7t2zu/n9u3cv/hMAIDUgtSA9cJtBAv9JBFBDGEEGCBNjMzaXgPSCDFACCWzdsun/x48f4Qp+/vz5f/WqFXgNAekFGaAM4pQWF/zPy8n4/+/fP7Bka0vj/5jI0P/Tpkz6b21hgoJTk+JhBijDDfj8+dN/bw+X//PmzPq/beuW/3bWZv+fP3v2/9Onj/9vXL/2v6+n839yYiyY/eLFc0wDQAAkaWFq8N/SzPD/4cMHUZy7ZNGC//m5WeheQDUABHq7O/4XF+Zi+JdoA6ZPnfy/prqcvgYoIQvevHH9/9kzpzEMePDg/v/jx45ijUaKExJlSZnizERpdgYAHGvS5YlC4DMAAAAASUVORK5CYII='
const TRAY_ICON_32 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB/klEQVR42mNgGKxAT1uNSU9bTVBPW01BT1tNmUysADWDiSSLW5sbbC5fvrT63du3z//+/fv3P5kApBdkBsgskJkEHaKnrca+b+/u1l+/fv38T2UAMhNkNsgOnD4HKfhPYwB1BGZIgIKIFj7HFhIguzB8D4qn/3QCILtQQgGUUkGJhV4OANkFshPZAQqUpHZycgfITmQHKMMkp0+b/N/G0uT/iRPHcBrw6uXL/96erv/TUxPJdgTITqwOqCgrBkn+d7C1/P/y5QsMjX/+/PkfHxsJVuPmbP//w4cP/2Ojwv57uDnixZ5uTv9XLF9K2AGvX7/+7+xoA7YAZNHv379RHNDb3QGWM9TT/H/m9Kn/N29cB/OJwYX5OYQdAAJnzpwCWwDS1NPVDhffu2fXf30ddbD4vDmz4OIXzp8D5W84BoUeSE1HWzNcbP++PeDQIsoBIDB/7mywISALQRY/evTwv7WFCVgsLyfj/79//3DGLyjIQeo2blhHehqAAZAFeTmZYIOszI3/B/l7g9mguPz48SPeBEYVB4AAyCIvd2d4HJoY6vy/evUKwRRONQeAAMhCmAOWLFpAVBajqgOgisH49KmTow4YdcDAOCArPeW/t4cLSkmGD7S1NIFLw4cPHhDtgAGvjge8QTKwTbIBb5QOimb5gHdMBkXXbFB0TukNAN3I9GAvXknOAAAAAElFTkSuQmCC'
const TRAY_ICON_64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAD0ElEQVR42u2b208TQRSHgfjmX9BHQlI1CwUF5SpVYghGTb2ERES5iIJUUBOjJiqB4C0SQAlKEXwwKuqDQoX4YhSEclVBuemTscAD1CJyNQgtx5wNIu2UUrrbsu3OL5kHmNmZc765ndnOenhQUVHZIxkj9ZQx0rUyRiqRMVJvGSP1cXLynm8bbfB0mtPyiGDJq5rq1N7eHvXQ4OC331NTk7BKwrbRBrQFbULbHAJDxkg9FHtiJM1NjfnjY2N6EKjQNrQRbUWb+XLeq7xMtffn8HAfuIjQVrQZbefq/JqaavX5mZmZP+BiQpvRdvTB7p7HCgwGgwFcVGj7PASvFc95HEKu2POWRsL8dLAdAC4irjTnbVkT0CebtzpcScHNhD7ZtEXiXirkrY7LFom+LQsAAwpwU6Fvyw5/jKrcFQD6ZnUaYFyNoaW7AkDf0EdrACSrGds74+yAPloD4A1uLvTRGgAf8weMRgNczc2GyPAtEB8XC31aLScD7hYXwbatobBfsQu6uzpXA4DPigC8VFfiQwtJsTsGJiftmyXPnlYQdQkeQHlZqYnRmM6dPbPihnu6uyBoo69JPZs3+S3kV1U+h9SUJDiadJhzwnrUVS/4AaDVfofgIH8CwpOKRzY7Pzo6Cjujo4g6rl3JYfMb6uuIPD5So6aBOwBUTbWaqDwwgLFpDs/NzUGGMpV4PvaAAqanp9kyqpJihwDAenkBgMrNySIaiN4hZ3vXmu6Xk1MoLDgQ+vv/n7U62j+Cv+86Xp0P8FsPnzra+QOAvXUwdh/RkDLtGNvLlvThfRsE+G0wKY+Ovn3zmiir0dRDdtZFuHzpgsWEsM3hL1UW62lq1PCzBizWwEA/RIQGERDKSkuIsnq9HqLkYUTZ/Lwbdq3epzOVJvXg307ZBcxVV/uGGK7Yy62tzSaxQ3JiPOF84pE4mJ2ddW0AqMKCPMK57ZGh8EOnY/NvF+YT+Rj86HRDdu/fggKArwmTE8geTko4xM5vSyOkpaWJUwAjKAAo7G1LcxxXX/P/larucI7gBAcA1dbaQqzy5ik9LQWMRqN7AmBD5XuqJZ3HrerXyAgvMbxgAWAMoDxx3GKk2Nn5mbdDjGAB/Iv18WCz2EDcCfiUoAGgwkNMA6THDx9QABQABUABUAAUAAVAAVAAogCAb3kXG/iurpZXAHk3r/Pyas1hAL5+6WUhyCNCoOhWwZIvSu0VnjcyT6axI+1URjpMTIw7BIDofxwV/c/jor8gIe4rMqK/JEWvydGLkvSqLL0sTa/L0w8m6Ccz9KMp+tkc/XCSikos+gvFQCwQM3DWiAAAAABJRU5ErkJggg=='

/**
 * The page shown while the host boots — 20 s and up, measured.
 *
 * Two things a static line cannot get right:
 *
 * - **Scheme.** The window is up before the workbench's theme snapshot exists,
 *   so this page cannot read the app's CSS variables: the four colours below
 *   are copies of `--yt-surface-primary`, `--yt-text-secondary`,
 *   `--yt-border-subtle` and `--yt-accent` from
 *   `packages/client/ui-yantao/src/client/frame/yt-tokens.ts`. Keep them equal
 *   by hand — this page is the one surface outside the token system, and a
 *   dark-theme boot that flashes warm white is exactly what that costs.
 * - **Liveness.** A frozen line reads as a hang. The bar is deliberately
 *   indeterminate: the host reports no progress, so a percentage would be a
 *   lie, but standing still is a worse one.
 * @returns the `data:` URL to load.
 */
function loadingPage(): string {
  const dark = nativeTheme.shouldUseDarkColors
  const surface = dark ? '#1b1916' : '#fbfaf7'
  const ink = dark ? '#a8a296' : '#6b6455'
  const track = dark ? '#35322d' : '#e6e2d8'
  const bar = dark ? '#7ba3e0' : '#4a7fd4'
  const html = `<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
background:${surface};color:${ink};font:14px system-ui,'Microsoft YaHei',sans-serif}
.track{width:180px;height:2px;border-radius:2px;background:${track};overflow:hidden}
.bar{width:40%;height:100%;border-radius:2px;background:${bar};animation:slide 1.4s ease-in-out infinite}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(350%)}}
@media (prefers-reduced-motion: reduce){.bar{animation:none;width:100%;opacity:.5}}
</style></head><body><div>正在启动 yantao 工作台…</div><div class="track"><div class="bar"></div></div></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

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
    [...CLI_LOADER, '--expose-internals', CLI, '--profile', PROFILE, '--port', '0', '--no-open'],
    {
      cwd: REPO,
      // Dev shares ~/.dsh; the release build gets its own home under userData.
      env: hostEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
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

/**
 * Whether a usable `node` answers on PATH.
 *
 * The release build deliberately does not carry a Node runtime (the installer
 * is a zip, the dependency is common, and the native modules bind to the
 * system ABI). Failing here is a first-launch condition, not a bug — it gets
 * its own page rather than a dead window.
 * @returns whether the host has a runtime to spawn.
 */
function nodeAvailable(): boolean {
  const result = spawnSync(nodeProgram(), ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
  return result.status === 0 && /^v\d+\./u.test((result.stdout ?? '').trim())
}

/**
 * The page shown when Node is missing — the one failure the human can fix
 * without touching the app.
 * @returns the `data:` URL to load.
 */
function missingNodePage(): string {
  const dark = nativeTheme.shouldUseDarkColors
  const surface = dark ? '#1b1916' : '#fbfaf7'
  const ink = dark ? '#e8e4dc' : '#2e2b26'
  const muted = dark ? '#a8a296' : '#6b6455'
  const accent = dark ? '#7ba3e0' : '#4a7fd4'
  const html = `<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
background:${surface};color:${ink};font:14px system-ui,'Microsoft YaHei',sans-serif;text-align:center;padding:32px}
h1{font-size:16px;font-weight:600;margin:0}
p{margin:0;color:${muted};line-height:1.7;max-width:34em}
a{color:${accent}}
</style></head><body>
<h1>缺少 Node.js</h1>
<p>工作台的后端需要一个 Node.js 运行时。请安装 Node.js 20 或更高版本（<a href="https://nodejs.org">nodejs.org</a>），
安装完成后关闭这个窗口再重新打开。</p>
<p>如果已经装过，先在命令行里跑一次 node --version：装完没重启的话，PATH 可能还没生效。</p>
</body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

/**
 * Replay the runtime's link manifest (release builds only).
 *
 * The archive carries no links: a zip cannot hold a junction, and every
 * recorded target is an absolute path. `scripts/pack-release.mjs` writes
 * `link-manifest.json` with runtime-relative paths; this rebuilds them under
 * whatever directory the exe was extracted to. Idempotent — a stamp beside the
 * app records the root it was built for, and a matching stamp plus one working
 * probe link skips the whole pass (every launch but the first, and after a
 * move).
 */
function restoreRuntimeLinks(): void {
  if (!PACKAGED) return
  const manifestPath = join(RUNTIME, 'link-manifest.json')
  if (!existsSync(manifestPath)) return
  const { links } = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    links: { path: string; target: string; directory: boolean }[]
  }
  if (links.length === 0) return
  const first = links[0]
  if (first === undefined) return
  const probe = join(RUNTIME, ...first.path.split('/'))
  const stamp = `${RUNTIME}\n${links.length}`
  const stampPath = join(app.getPath('userData'), 'runtime-links.json')
  if (existsSync(stampPath) && readFileSync(stampPath, 'utf8') === stamp) {
    try {
      realpathSync(probe)
      return
    } catch {
      // The tree moved or was replaced: fall through and rebuild.
    }
  }
  /**
   * Create one link.
   *
   * `retry` is not a failure: pnpm nests links (a package link points through
   * another link into the virtual store), so a target may not exist until the
   * pass that creates it. `failed` means the destination is a real directory
   * we must not delete.
   */
  const ensure = (link: { path: string; target: string; directory: boolean }): 'done' | 'retry' | 'failed' => {
    const destination = join(RUNTIME, ...link.path.split('/'))
    const target = join(RUNTIME, ...link.target.split('/'))
    let present = false
    try {
      // lstat, not exists: a dangling junction must still be replaced.
      lstatSync(destination)
      present = true
    } catch {
      present = false
    }
    if (present) {
      try {
        if (realpathSync(destination) === target) return 'done'
      } catch {
        // Dangling or unreadable: fall through and replace it.
      }
      try {
        unlinkSync(destination)
      } catch {
        return 'failed'
      }
    }
    // A junction needs its target to exist; a link through another link needs
    // that link first. Defer and come back after the next pass.
    if (!existsSync(target)) return 'retry'
    mkdirSync(dirname(destination), { recursive: true })
    try {
      if (link.directory) {
        // Junctions need no privilege on Windows; file symlinks do.
        symlinkSync(target, destination, 'junction')
      } else {
        // A hard link is a real file with no elevation and no second copy.
        linkSync(target, destination)
      }
      return 'done'
    } catch {
      try {
        copyFileSync(target, destination)
        return 'done'
      } catch {
        return 'retry'
      }
    }
  }

  let made = 0
  let pending = links
  for (let pass = 0; pass < 6 && pending.length > 0; pass += 1) {
    const deferred = []
    const failed = []
    for (const link of pending) {
      const outcome = ensure(link)
      if (outcome === 'done') made += 1
      else if (outcome === 'retry') deferred.push(link)
      else failed.push(link)
    }
    if (failed.length > 0) log(`yantao: ${failed.length} link(s) could not be replaced (a real directory sits in the way)`)
    if (deferred.length === pending.length) break
    pending = deferred
  }
  if (pending.length > 0) {
    // An incomplete farm must be retried on the next launch: leaving the stamp
    // would let the probe link (which does exist) short-circuit the rebuild.
    log(`yantao: ${pending.length} link(s) still unresolved — the host will report what is missing`)
    try {
      unlinkSync(stampPath)
    } catch {
      // No stamp yet is the normal case for a first launch.
    }
  } else {
    mkdirSync(dirname(stampPath), { recursive: true })
    writeFileSync(stampPath, stamp)
  }
  log(`yantao: restored ${made} runtime link(s) under ${RUNTIME}`)
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
    // A wedged page needs a reload, not a host restart (2026-10-24 评审 P2):
    // the host is fine, and restarting it costs a 20 s boot.
    { label: '重新加载页面', click: () => { reloadWorkbench('托盘') } },
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
    // The taskbar/title-bar icon: without this the window wears Electron's
    // default. Same YT badge as the tray, at taskbar density.
    icon: nativeImage.createFromDataURL(TRAY_ICON_64),
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
  // 启动即最大化（2026-10-15 用户指示）：1440×900 只是 maximizable 之前的
  // 兜底尺寸。托盘「打开」只 show 不 maximize——还原窗口不该强行放大。
  window.maximize()
  // Closing the window minimises to the tray; 退出 in the tray menu is the way
  // out. A workbench that quits when you close its window loses your tabs.
  // A genuine quit (tray 退出, boot failure) passes through: see `quitting`.
  window.on('close', (event) => {
    if (quitting || tray === undefined) return
    event.preventDefault()
    window?.hide()
  })
  window.once('ready-to-show', () => { window?.show() })
  armRendererRecovery(window)
  armManualReload(window)
  return window
}

/**
 * Reload budget for the renderer self-heal below: at most two reloads per
 * minute, so a genuinely broken page (a torn client bundle, a missing dist)
 * fails loudly instead of spinning in a reload loop.
 */
const RECOVERY_LIMIT = 2
const RECOVERY_WINDOW_MS = 60_000
let recoveryReloads = 0
let recoveryWindowStart = 0

/**
 * Heal a renderer that died or failed its main-frame navigation (2026-10-24).
 *
 * The packaged shell runs the repository's source and serves the repository's
 * built artifacts from disk, so a rebuild happening under a live window can
 * kill the renderer process or 404 the page mid-navigation — both used to end
 * as a white window with no way back (the app menu, and with it Ctrl+R, is
 * removed). Recovery is a plain reload, skipped while the host is down (a
 * reload would just 404 again) and bounded by {@link RECOVERY_LIMIT}.
 * @param target - the window whose web contents to watch.
 */
function armRendererRecovery(target: BrowserWindow): void {
  const reload = (reason: string): void => {
    if (quitting) return
    if (host === undefined || host.exitCode !== null) return
    const now = Date.now()
    if (now - recoveryWindowStart > RECOVERY_WINDOW_MS) {
      recoveryWindowStart = now
      recoveryReloads = 0
    }
    if (recoveryReloads >= RECOVERY_LIMIT) {
      console.error(`yantao: renderer recovery gave up after ${RECOVERY_LIMIT} reloads (${reason}) — use the tray's 重启宿主`)
      return
    }
    recoveryReloads += 1
    console.warn(`yantao: renderer recovery #${recoveryReloads} (${reason}) — reloading`)
    target.webContents.reload()
  }

  target.webContents.on('render-process-gone', (_event, details) => {
    reload(`renderer gone: ${details.reason}`)
  })
  target.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED: a superseded navigation (a reload racing a redirect),
    // not a failure worth healing.
    if (!isMainFrame || code === -3) return
    reload(`main frame failed: ${String(code)} ${description} (${url})`)
  })
  // A page that finished loading is healthy again: refund the budget.
  target.webContents.on('did-finish-load', () => {
    recoveryReloads = 0
    recoveryWindowStart = 0
  })
}

/**
 * The human's escape hatch (2026-10-24 评审 P2).
 *
 * Self-healing covers a renderer that died and a main frame that failed to
 * navigate. It does not cover a page that is alive but wedged — a React tree
 * that never settles, an await that never resolves — because neither event
 * fires. Before this, the only door was the tray's 重启宿主, which also kills
 * the host and costs a 20 s boot; a reload costs nothing.
 *
 * Skipped while the host is down: the reload would land on a 404 and turn a
 * recoverable window into a white one. The tray's 重启宿主 is the move there.
 * @param reason - who asked (keystroke or tray), for the log line.
 */
function reloadWorkbench(reason: string): void {
  if (window === undefined || quitting) return
  if (host === undefined || host.exitCode !== null) {
    console.warn(`yantao: reload requested (${reason}) but the host is down — use the tray's 重启宿主`)
    return
  }
  log(`yantao: reloading the workbench (${reason})`)
  // A hard reload: the gesture is Ctrl+Shift+R, and a plain reload may reuse a
  // cached index.html whose hashed assets no longer match the build on disk.
  window.webContents.reloadIgnoringCache()
}

/**
 * Bind Ctrl+Shift+R (Cmd+Shift+R) to that reload.
 *
 * `Menu.setApplicationMenu(null)` removed the menu accelerators, and with them
 * Ctrl+R and F12; the shell has to carry the one that matters itself. Match on
 * `code`, not `key`: with Shift held, `key` is an uppercase R on some layouts
 * and a different letter entirely on others.
 * @param target - the window whose web contents to watch.
 */
function armManualReload(target: BrowserWindow): void {
  target.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (!(input.control || input.meta) || !input.shift || input.code !== 'KeyR') return
    event.preventDefault()
    reloadWorkbench('Ctrl+Shift+R')
  })
}

/** Boot the host again and point the existing window at the new URL. */
async function restartHost(): Promise<void> {
  stopHost()
  const target = ensureWindow()
  await target.loadURL(loadingPage())
  const started = bootHost()
  host = started.child
  armHostDeathWatch(started)
  await purgeStaleAuthCookies()
  try {
    await loadWorkbench(target, await started.url)
    log('yantao: host restarted')
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
  await target.loadURL(loadingPage())
  target.show()

  // A release build restores its link farm before anything can import from it;
  // the loading page is already up, so the first launch's few seconds of
  // junction creation look like booting rather than like nothing happening.
  restoreRuntimeLinks()

  // The one first-launch condition the human can fix without the app.
  if (PACKAGED && !nodeAvailable()) {
    log('yantao: no node on PATH — showing the install page')
    await target.loadURL(missingNodePage())
    return
  }

  log(`yantao: booting host (${PACKAGED ? 'packaged runtime' : 'checkout'}) — ${CLI}`)

  buildTray(() => {
    void restartHost()
  })

  const started = bootHost()
  host = started.child
  armHostDeathWatch(started)
  await purgeStaleAuthCookies()
  await loadWorkbench(target, await started.url)
  log('yantao: workbench ready')
}

app.on('before-quit', () => {
  quitting = true
  stopHost()
})

void main().catch((error: unknown) => {
  log(`yantao: desktop shell failed to start — ${error instanceof Error ? error.message : String(error)}`)
  app.quit()
})
