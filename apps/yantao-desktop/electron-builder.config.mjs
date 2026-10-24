/**
 * electron-builder configuration for the yantao workbench (ADR-0067).
 *
 * `--dir` only: this fork ships an unpacked directory
 * (`win-unpacked/yantao-workbench.exe`), never an installer, and never a
 * download — `electronDist` points at the Electron the workspace already
 * installed, so packing works offline.
 *
 * The app bundle (asar) carries exactly the precompiled main process; the host
 * and its dependencies travel as `extraResources/runtime`, a materialized copy
 * of the repository assembled by `scripts/pack-win.mjs`. `dsh-home-template`
 * seeds the packaged instance's harness home on first launch.
 *
 * electron-builder drops a source directory's root `node_modules` when copying
 * `extraResources`; the runtime's root `node_modules` therefore needs its own
 * entry (the same workaround apps/desktop uses).
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('.', import.meta.url))
const build = join(app, '.package-build')

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'com.yantao.workbench',
  productName: 'yantao-workbench',
  directories: { output: join(build, 'artifacts') },
  asar: true,
  electronDist: join(app, 'node_modules', 'electron', 'dist'),
  // The packaged manifest must not keep pointing at `src/entry.mjs`: that file
  // registers tsx, and the packaged main process is precompiled instead.
  // Windows 任务栏显示的是 exe 内嵌图标（不是窗口运行时图标）：不给的话
  // electron-builder 用默认 Electron 图标，dev 与 exe 观感分裂（2026-10-24
  // 用户发现）。由 scripts/gen-tray-icon.mjs 从同一枚徽标生成。
  icon: join(app, 'build/icon.ico'),
  extraMetadata: { main: 'dist/main.js' },
  files: ['dist/main.js', 'dist/preload.cjs', 'dist/repo-path.txt', 'package.json'],
  // The host's runtime is NOT an extraResource: electron-builder's file
  // matcher drops every `node_modules` subtree it copies, which silently
  // emptied pnpm's virtual store and left the runtime unable to boot
  // (2026-10-24). scripts/pack-release.mjs copies the tree into
  // `win-unpacked/resources/runtime` after electron-builder finishes.
};
