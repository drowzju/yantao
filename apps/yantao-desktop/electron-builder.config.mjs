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
  extraMetadata: { main: 'dist/main.js' },
  files: ['dist/main.js', 'dist/preload.cjs', 'package.json'],
  // 2026-10-24 合一裁决：runtime 物化副本与 dsh-home-template 废除——宿主以
  // 仓库源码运行，配置走 ~/.dsh，壳里不再携带任何 extraResources。
};
