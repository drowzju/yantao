/**
 * Build the yantao workbench as an executable directory (ADR-0067, 2026-10-24 修订).
 *
 * 2026-10-24 用户裁决：home 分离与 runtime 物化废除——打包实例与开发实例共用
 * 同一个 `~/.dsh`、同一个 `yantao-web` profile、同一份仓库源码（tsx 直跑）。
 * 出包因此只剩两件事：
 *
 * 1. Preflight — 拒绝对缺失工件出包，并指出产生它的命令。
 * 2. esbuild — 把 Electron 主进程打进 `dist/main.js`（打包壳不带 tsx）。
 * 3. electron-builder `--dir` — 离线，用 workspace 已装的 Electron。
 *
 * 宿主以仓库源码运行：exe 依赖仓库存在（挪走/删除即失效，已知情接受）。
 * 单实例守卫因此更重要——共享会话存储与钉钉 Stream，双实例互抢。
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const APP = resolve(import.meta.dirname, '..')
const REPO = resolve(APP, '..', '..')
const BUILD = join(APP, '.package-build')
const ARTIFACTS = join(BUILD, 'artifacts')

/** @param {string} message */
function fail(message) {
  console.error(`pack-win: ${message}`)
  process.exit(1)
}

/** 1. Preflight — name the command that produces each missing artifact. */
function preflight() {
  const required = [
    [join(REPO, 'apps', 'yantao', 'dist', 'index.html'), 'pnpm --filter @deepseek-ai/dsh-yantao-frontend run build'],
    [join(REPO, 'packages', 'client', 'ui-yantao', 'lib', 'client.js'), 'pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle'],
    [join(REPO, 'packages', 'yantao', 'kb', 'lib', 'index.js'), 'the workspace lib/ build (see AGENTS.md "Before you commit")'],
  ]
  const missing = required.filter(([path]) => !existsSync(path))
  if (missing.length === 0) return
  for (const [path, command] of missing) console.error(`pack-win: missing ${path}\\n          produce it with: ${command}`)
  process.exit(1)
}

/** 2. Precompile the Electron main process — the packaged shell carries no tsx. */
async function compileMain() {
  await build({
    entryPoints: [join(APP, 'src', 'main.ts')],
    outfile: join(APP, 'dist', 'main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['electron'],
    logLevel: 'warning',
  })
  copyFileSync(join(APP, 'src', 'preload.cjs'), join(APP, 'dist', 'preload.cjs'))
  console.log('pack-win: main process bundled into dist/main.js')
}

/** 3. electron-builder --dir, offline against the installed Electron. */
function pack() {
  // The JS entry, not `.bin/electron-builder.cmd`: spawning a `.cmd` from Node
  // on Windows needs a shell, and the shim adds nothing here.
  const cli = join(APP, 'node_modules', 'electron-builder', 'cli.js')
  if (!existsSync(cli)) fail('electron-builder is not installed — run pnpm install')
  const result = spawnSync(process.execPath, [cli, '--config', join(APP, 'electron-builder.config.mjs'), '--dir'], {
    cwd: APP,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.status !== 0) fail(`electron-builder exited with ${result.status ?? result.signal}`)
}

preflight()
await compileMain()
pack()
console.log(`\\npack-win: done — run ${join(ARTIFACTS, 'win-unpacked', 'yantao-workbench.exe')}`)
