/**
 * Build the yantao workbench as a standalone executable directory (ADR-0067).
 *
 * The point is decoupling: once packed, the running instance reads nothing
 * from this repository, so editing code (or rebuilding `lib/` artifacts)
 * cannot disturb it. The host still runs as TypeScript through tsx — that part
 * is not compiled — so the "runtime" is a materialized copy of the repository
 * with every repository-internal link rewritten to point inside the copy.
 *
 * Pipeline:
 *
 * 1. Preflight — refuse to pack against stale or missing artifacts, and say
 *    which command produces the missing piece.
 * 2. esbuild — bundle the Electron main process into `dist/main.js` (the
 *    packaged build does not carry tsx).
 * 3. Materialize `resources/runtime` — copy the tree, classifying links:
 *    targets inside the repository are rewritten to the copy's own paths (a
 *    link back into the repository is exactly the coupling this build exists
 *    to remove); targets outside it (the pnpm store) stay as they are.
 * 4. Decoupling gate — walk the copy and fail if any link still resolves into
 *    the repository. This is the machine-checkable promise.
 * 5. Assemble `dsh-home-template` — the packaged profile (no `patchReload`,
 *    shared KB root, DingTalk kept) plus the profile plugin link manifest.
 * 6. electron-builder `--dir` — offline, using the Electron the workspace
 *    already installed.
 *
 * `--reuse-runtime` skips step 3 when the tree is already materialized (still
 * runs the gate). It exists for iterating on the template and builder steps
 * without recopying several gigabytes.
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { build } from 'esbuild'

const APP = resolve(import.meta.dirname, '..')
const REPO = resolve(APP, '..', '..')
const BUILD = join(APP, '.package-build')
const RUNTIME = join(BUILD, 'runtime')
const TEMPLATE = join(BUILD, 'dsh-home-template')
const ARTIFACTS = join(BUILD, 'artifacts')
const DSH = join(homedir(), '.dsh')
const PROFILE_SOURCE = join(DSH, 'profiles', 'yantao-web')
const PROFILE_NAME = 'yantao-packaged'

/**
 * Repository-relative paths the runtime copy never needs. Everything else is
 * copied wholesale — guessing at a leaner set risks dropping a runtime asset
 * that only shows up when a human clicks something.
 */
const EXCLUDED = [
  '.git',
  '.github',
  '.scratch',
  // Agent tooling scratch (worktrees, caches). A leftover worktree carries its
  // own node_modules with junctions into paths that no longer exist, and the
  // copy dies on the first dangling link — 2026-10-20 出包首跑即此。
  '.codebuddy',
  'coverage',
  'docs',
  'website',
  'apps/desktop/.desktop-build',
  'apps/yantao-desktop/.package-build',
  'node_modules/.cache',
]

/** @param {string} message */
function fail(message) {
  console.error(`pack-win: ${message}`)
  process.exit(1)
}

/** Relative path with forward slashes, for exclusion comparisons. */
function relativeToRepo(path) {
  return relative(REPO, path).split(sep).join('/')
}

/** @param {string} path */
function isExcluded(path) {
  const rel = relativeToRepo(path)
  return EXCLUDED.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`))
}

/**
 * Whether an absolute path lives inside the repository.
 * @param {string} path
 */
function insideRepo(path) {
  const rel = relative(REPO, path)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

/**
 * Whether an absolute path lives inside a directory (the path itself included).
 * @param {string} root
 * @param {string} path
 */
function insidePath(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep))
}

/**
 * Copy the repository into the runtime tree, rewriting links whose targets
 * live inside the repository so they point at the corresponding copy. Links
 * are created after the copy (a junction needs its target to exist).
 * @param {string} from source directory.
 * @param {string} to destination directory.
 * @param {{ destination: string, target: string, directory: boolean }[]} links collected links.
 */
function copyTree(from, to, links) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    if (isExcluded(source)) continue
    const destination = join(to, entry.name)
    const stat = lstatSync(source)
    if (stat.isSymbolicLink()) {
      // Dangling links are normal in a pnpm tree: optional packages for other
      // platforms (linux-arm64, …) are never installed on this host, yet the
      // link remains. There is nothing to copy, and the copy must not fail on
      // it — 2026-10-20 出包第二跑即此。
      let target
      try {
        target = realpathSync(source)
      } catch {
        continue
      }
      const rewritten = insideRepo(target) ? join(RUNTIME, relative(REPO, target)) : target
      if (rewritten !== target && isExcluded(target)) continue
      links.push({ destination, target: rewritten, directory: statSync(target).isDirectory() })
      continue
    }
    if (stat.isDirectory()) {
      copyTree(source, destination, links)
      continue
    }
    copyFileSync(source, destination)
  }
}

/**
 * Fail when any link in the runtime tree still resolves into the repository.
 * Dangling links fail too — they mean the copy references something that was
 * never materialized.
 *
 * The runtime tree itself sits under the repository during the build
 * (`.package-build/`), so "inside the repository" alone proves nothing: what
 * matters is a link that escapes the copy and lands on repository sources.
 * @param {string} root runtime tree.
 */
function assertDecoupled(root) {
  const offenders = []
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        let target
        try {
          target = realpathSync(path)
        } catch {
          offenders.push(`${relative(root, path)} -> (dangling)`)
          continue
        }
        if (insideRepo(target) && !insidePath(root, target)) offenders.push(`${relative(root, path)} -> ${target}`)
        continue
      }
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(root)
  if (offenders.length === 0) return
  for (const offender of offenders.slice(0, 20)) console.error(`  ${offender}`)
  fail(`${offenders.length} link(s) in the runtime tree escape the copy into ${REPO}`)
}

/** 1. Preflight — name the command that produces each missing artifact. */
function preflight() {
  const required = [
    [join(REPO, 'apps', 'yantao', 'dist', 'index.html'), 'pnpm --filter @deepseek-ai/dsh-yantao-frontend run build'],
    [join(REPO, 'packages', 'client', 'ui-yantao', 'lib', 'index.js'), 'pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle'],
    [join(REPO, 'packages', 'yantao', 'kb', 'lib', 'index.js'), 'the workspace lib/ build (see AGENTS.md "Before you commit")'],
    [join(PROFILE_SOURCE, 'cordis.patch.yml'), 'a working ~/.dsh/profiles/yantao-web profile'],
  ]
  const missing = required.filter(([path]) => !existsSync(path))
  if (missing.length === 0) return
  for (const [path, command] of missing) console.error(`pack-win: missing ${path}\n          produce it with: ${command}`)
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

/** 3–4. Materialize the runtime copy and prove it is decoupled. */
function materializeRuntime() {
  rmSync(RUNTIME, { recursive: true, force: true })
  const links = []
  copyTree(REPO, RUNTIME, links)
  for (const { destination, target, directory } of links) {
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(target, destination, directory ? 'junction' : 'file')
  }
  console.log(`pack-win: runtime materialized (${links.length} links)`)
  assertDecoupled(RUNTIME)
  console.log('pack-win: decoupling gate passed — no link resolves into the repository')
}

/** 5. Assemble the packaged home template: profile, empty root config, link manifest. */
function assembleTemplate() {
  rmSync(TEMPLATE, { recursive: true, force: true })
  const profile = join(TEMPLATE, 'profiles', PROFILE_NAME)
  mkdirSync(profile, { recursive: true })

  const source = JSON.parse(readFileSync(join(PROFILE_SOURCE, 'package.json'), 'utf8'))
  const bundles = source.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || bundles.length === 0) fail('the source profile declares no dsh.profile.bundles')
  // No `patchReload`: a packaged instance must not watch anything for edits.
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE_NAME}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, null, 2)}\n`)
  copyFileSync(join(PROFILE_SOURCE, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml'))
  writeFileSync(join(profile, 'cordis.yml'), '# dsh profile root — an empty entry list. Edit cordis.patch.yml, not this file.\n[]\n')

  // The profile resolves its bundles through `profiles/node_modules`, a wall of
  // junctions into the installation. Record which names exist so the packaged
  // home can rebuild the same links against resources/runtime on first launch.
  const linksRoot = join(DSH, 'profiles', 'node_modules')
  const names = []
  if (existsSync(linksRoot)) {
    for (const entry of readdirSync(linksRoot, { withFileTypes: true })) {
      if (entry.name.startsWith('@')) {
        for (const scoped of readdirSync(join(linksRoot, entry.name))) names.push(`${entry.name}/${scoped}`)
        continue
      }
      names.push(entry.name)
    }
  }
  writeFileSync(join(TEMPLATE, 'link-manifest.json'), `${JSON.stringify(names.sort(), null, 2)}\n`)
  console.log(`pack-win: home template assembled (${names.length} profile links)`)
}

/** 6. electron-builder --dir, offline against the installed Electron. */
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
if (process.argv.includes('--reuse-runtime') && existsSync(RUNTIME)) {
  console.log('pack-win: reusing the materialized runtime')
  assertDecoupled(RUNTIME)
  console.log('pack-win: decoupling gate passed — no link escapes the copy')
} else {
  materializeRuntime()
}
assembleTemplate()
pack()
console.log(`\npack-win: done — run ${join(ARTIFACTS, 'win-unpacked', 'yantao-workbench.exe')}`)
