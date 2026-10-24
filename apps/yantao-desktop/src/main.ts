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
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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

/**
 * Whether this process is the packaged build (`win-unpacked/yantao-workbench.exe`)
 * or an `electron .` launch from the repository.
 *
 * The packaged build must never read code from the repository it was built in:
 * decoupling the shipped instance from in-progress edits is the entire point of
 * packing (a `live` patch reload would otherwise inject every save).
 */
const PACKAGED = app.isPackaged

/**
 * Where the host's code lives. In development that is the repository itself;
 * in a packaged build it is the materialized copy under `resources/runtime`
 * (assembled by `apps/yantao-desktop/scripts/pack-win.mjs`, with every
 * repository-internal link rewritten so the tree stands on its own).
 */
const RUNTIME = PACKAGED ? join(process.resourcesPath, 'runtime') : REPO

/** The dsh launcher the shell spawns. */
const CLI = join(RUNTIME, 'apps', 'cli', 'src', 'bin.ts')

/**
 * Which profile the host runs. Development keeps `yantao-web` (live patch
 * reload); the packaged build gets its own `yantao-packaged` profile so the two
 * instances never share a session store, a scheduler roster or a patch layer.
 * The knowledge base itself is shared on purpose (`D:\yantao-data`).
 */
const PROFILE = PACKAGED ? 'yantao-packaged' : 'yantao-web'

/**
 * The packaged build's harness home. `DSH_HOME` is what the host resolves
 * (packages/util/home-paths), so secrets, profiles and session storage land
 * here instead of `~/.dsh` — the development instance keeps its own.
 */
const PACKAGED_HOME = join(app.getPath('userData'), 'dsh-home')

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
 * Materialize the packaged build's harness home on first launch.
 *
 * Three things have to exist before the host boots with `DSH_HOME` pointing
 * here, and none of them can live inside the app bundle as-is:
 *
 * 1. **The profile** — `profiles/yantao-packaged` is seeded from
 *    `resources/dsh-home-template` (no `patchReload`, same bundle list). The
 *    bundle list is copied once; the `cordis.patch.yml` is MIRRORED from the
 *    development profile (`~/.dsh/profiles/yantao-web`) at every launch
 *    (2026-10-24 用户裁决：配置与本地代码运行必须一致，home 的分离只为代码
 *    冻结服务) — a missing source falls back to the last mirrored copy, so a
 *    moved installation still boots.
 * 2. **The secrets** — `.env` and `.credentials.yaml` are mirrored from `~/.dsh`
 *    at every launch (2026-10-24 用户裁决：环境与配置一致，轮换自动跟随). The
 *    credentials store reads the home-level `.env` as its `user-env`
 *    fallback layer (packages/boot/app-boot `loadLayeredEnv`), so nothing else
 *    is needed.
 * 3. **The profile's plugin links** — `profiles/node_modules` is the layer the
 *    bundle patches resolve through; on this machine it is a wall of junctions
 *    into the repository's `node_modules/.pnpm/node_modules`. The manifest
 *    records which names matter; each junction is (re)pointed at the same
 *    relative path inside `resources/runtime`, which is why the packaged home
 *    keeps working after the unpacked directory is moved.
 *
 * Re-running is cheap and self-healing: a link whose target drifted is
 * recreated, a missing profile is re-seeded.
 * @returns when the home is ready for the host.
 */
function ensurePackagedHome(): void {
  const template = join(process.resourcesPath, 'dsh-home-template')
  const seeded = join(PACKAGED_HOME, 'profiles', PROFILE, 'package.json')
  if (!existsSync(seeded)) {
    mkdirSync(PACKAGED_HOME, { recursive: true })
    cpSync(template, PACKAGED_HOME, { recursive: true })
    console.log(`yantao: seeded packaged home at ${PACKAGED_HOME}`)
  }

  // 配置镜像（2026-10-24 用户裁决，ADR-0067 修订）：home 的分离只为代码冻结
  // （junction 墙指进 resources/runtime），配置的权威永远是开发侧的 yantao-web。
  // 每次启动：patch 以开发侧活文件优先（模板副本兜底），manifest/基础设施跟
  // 随本 exe 的模板刷新——陈年首启快照不再能压过新组合层。源全缺失则保留
  // 上次镜像，安装仍可启动。
  const devPatch = join(homedir(), '.dsh', 'profiles', 'yantao-web', 'cordis.patch.yml')
  const packagedPatch = join(PACKAGED_HOME, 'profiles', PROFILE, 'cordis.patch.yml')
  if (existsSync(devPatch)) {
    copyFileSync(devPatch, packagedPatch)
  } else if (existsSync(join(template, 'profiles', PROFILE, 'cordis.patch.yml'))) {
    copyFileSync(join(template, 'profiles', PROFILE, 'cordis.patch.yml'), packagedPatch)
  }
  const templateManifest = join(template, 'link-manifest.json')
  if (existsSync(templateManifest)) {
    copyFileSync(templateManifest, join(PACKAGED_HOME, 'link-manifest.json'))
  }

  // Secrets: mirrored from ~/.dsh at every launch (2026-10-24 用户裁决：环境与
  // 配置一致)。轮换密钥后 exe 下次启动自动跟随；源缺失则保留上次镜像。
  for (const name of ['.env', '.credentials.yaml']) {
    const source = join(homedir(), '.dsh', name)
    if (!existsSync(source)) continue
    copyFileSync(source, join(PACKAGED_HOME, name))
  }

  const manifest = join(PACKAGED_HOME, 'link-manifest.json')
  if (!existsSync(manifest)) return
  const names = JSON.parse(readFileSync(manifest, 'utf8')) as string[]
  const links = join(PACKAGED_HOME, 'profiles', 'node_modules')
  const store = join(RUNTIME, 'node_modules', '.pnpm', 'node_modules')
  let repaired = 0
  for (const name of names) {
    const expected = join(store, name)
    if (!existsSync(expected)) continue
    const destination = join(links, name)
    let current: string | undefined
    try {
      // Junctions may come back with the `\\?\` prefix; strip it before comparing.
      current = readlinkSync(destination).replace(/^\\\\\?\\/, '')
    } catch {
      current = undefined
    }
    if (current === expected) continue
    // `rmSync` on a junction removes the link itself, never its target.
    if (current !== undefined) rmSync(destination, { force: true })
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(expected, destination, 'junction')
    repaired += 1
  }
  if (repaired > 0) console.log(`yantao: repaired ${repaired} profile link${repaired === 1 ? '' : 's'}`)
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
    {
      cwd: RUNTIME,
      // The packaged instance reads its own home; the development instance
      // keeps `~/.dsh` untouched. `DSH_HOME` also moves the credentials
      // store's `user-env` fallback to the seeded `.env`.
      env: PACKAGED ? { ...process.env, DSH_HOME: PACKAGED_HOME } : process.env,
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

  // Before the first bootHost: the packaged instance needs its seeded home,
  // profile and plugin links. Idempotent and a no-op in development.
  if (PACKAGED) ensurePackagedHome()

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
