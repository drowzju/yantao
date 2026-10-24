/**
 * Materialize a distributable runtime for the yantao workbench (路线 A).
 *
 * The shipped zip carries the frozen Electron shell plus `resources/runtime` —
 * a copy of this checkout that resolves nothing outside itself. The host runs
 * from that copy's **built** artifacts (`apps/cli/lib/bin.js`, every package's
 * `lib/`), so the tree needs no tsx and no TypeScript sources.
 *
 * Why the links leave the archive
 * -------------------------------
 * A pnpm tree is held together by ~9k junctions, every one an absolute path.
 * A zip cannot carry them: Windows Explorer unpacks neither junctions nor
 * symlinks, and an absolute target dies the moment the folder lands somewhere
 * else. Two ways out — duplicate every target until the tree has no links
 * (gigabytes of copies), or record them and rebuild them on first launch.
 * This script takes the second: it writes `link-manifest.json` beside the
 * runtime, and `--strip-links` removes the junctions from the archive. The
 * desktop shell replays the manifest before it spawns the host (same pattern
 * ADR-0067 used for the profile's node_modules).
 *
 * Pipeline:
 *
 * 1. Preflight — refuse to pack against missing artifacts, naming the command
 *    that produces each one.
 * 2. Materialize — copy the tree, classifying links: targets inside the
 *    repository are rewritten to the copy's own paths; targets outside it (the
 *    pnpm store) stay as they are.
 * 3. Strip sources — `src/` and `tests/` leave the copy. Any package whose
 *    entry points at `src/` fails the build instead of shipping broken.
 * 4. Decoupling gate — walk the copy and fail if any link resolves back into
 *    the repository.
 * 5. Smoke — boot the copied CLI against a throwaway DSH_HOME and compose the
 *    yantao-web profile. This proves the tree is complete enough to start and
 *    that the profile template self-initializes on a fresh home.
 * 6. Manifest — record every link as runtime-relative destination + target.
 * 7. `--strip-links` — delete the links so the archive carries none, and
 *    prove the manifest covers every one of them.
 *
 * Usage:
 *   node scripts/pack-release.mjs [--reuse-runtime] [--no-smoke] [--strip-links]
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync,
  statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const BUILD = join(REPO, 'apps', 'yantao-desktop', '.package-build', 'release')
const RUNTIME = join(BUILD, 'runtime')
const SMOKE_HOME = join(BUILD, 'smoke-home')
const APP = join(REPO, 'apps', 'yantao-desktop')
const SHELL_BUILD = join(BUILD, 'shell')
const OUT = join(SHELL_BUILD, 'win-unpacked')
// Inside the tree, so the manifest travels with it and every recorded path is
// relative to the same root.
const MANIFEST = join(RUNTIME, 'link-manifest.json')
const PROFILE = 'yantao-web'

/**
 * Repository-relative paths the runtime never needs. Everything else is copied
 * wholesale: guessing a leaner set risks dropping an asset that only shows up
 * when a human clicks something.
 */
const EXCLUDED = [
  '.git',
  '.github',
  '.scratch',
  '.codebuddy',
  'coverage',
  'docs',
  'website',
  // The upstream Electron app and the web frontend are not part of this
  // profile's runtime; both carry their own node_modules and are large.
  'apps/desktop',
  'apps/web',
  // The shell itself: the exe carries its own precompiled dist, nothing in the
  // runtime ever imports it.
  'apps/yantao-desktop',
  'node_modules/.cache',
]

/** @param {string} message */
function fail(message) {
  console.error(`pack-release: ${message}`)
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

/** @param {string} path */
function insideRepo(path) {
  const rel = relative(REPO, path)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

/**
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
let copied = 0
function copyTree(from, to, links) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    copied += 1
    if (copied % 20_000 === 0) console.log(`pack-release: copied ${copied} entries…`)
    const source = join(from, entry.name)
    if (isExcluded(source)) continue
    const destination = join(to, entry.name)
    const stat = lstatSync(source)
    if (stat.isSymbolicLink()) {
      // Dangling links are normal in a pnpm tree: optional packages for other
      // platforms (linux-arm64, …) are never installed here, yet the link
      // remains. There is nothing to copy, and the copy must not fail on it.
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
 * Delete every `src/` and `tests/` directory from the copy, then prove no
 * package's root entry points at one.
 * @param {string} root runtime tree.
 */
function stripSources(root) {
  let removed = 0
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      if (entry.name === 'src' || entry.name === 'tests') {
        rmSync(path, { recursive: true, force: true })
        removed += 1
        continue
      }
      walk(path)
    }
  }
  walk(root)
  console.log(`pack-release: stripped ${removed} source/test directories`)

  const broken = []
  /** @param {string} directory */
  const check = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      if (entry.name.startsWith('@')) { check(path); continue }
      const manifest = join(path, 'package.json')
      if (existsSync(manifest)) {
        let parsed
        try {
          parsed = JSON.parse(readFileSync(manifest, 'utf8'))
        } catch {
          broken.push(`${relative(root, manifest)} (unparseable)`)
          continue
        }
        // Only the root entry matters: `"./src/*": "./src/*"` is a deliberate
        // subpath escape hatch (tests and type-only imports), not the runtime
        // entry, and it stays in the manifest after src/ is gone.
        const entries = [parsed.main, parsed.module, parsed.types, parsed.typings]
        const rootExport = parsed.exports?.['.']
        if (typeof rootExport === 'string') entries.push(rootExport)
        else if (rootExport !== null && typeof rootExport === 'object') {
          for (const nested of Object.values(rootExport)) if (typeof nested === 'string') entries.push(nested)
        }
        const fromSource = entries.filter(value => typeof value === 'string' && /^\.?\/?src\//.test(value))
        if (fromSource.length > 0) broken.push(`${relative(root, path)} -> ${fromSource.join(', ')}`)
      }
      check(path)
    }
  }
  check(root)
  if (broken.length > 0) {
    for (const line of broken.slice(0, 20)) console.error(`  ${line}`)
    fail(`${broken.length} package(s) resolve their root entry from src/ — rebuild them into lib/ first`)
  }
}

/**
 * Delete links whose target no longer exists (optional platform packages that
 * were never installed). They carry no code, but the gate below rightly
 * refuses to ship a link that resolves to nothing.
 * @param {string} root runtime tree.
 * @returns {number} links removed.
 */
function pruneDangling(root) {
  const doomed = []
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        try {
          realpathSync(path)
        } catch {
          doomed.push(path)
        }
        continue
      }
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(root)
  for (const path of doomed) unlinkSync(path)
  return doomed.length
}

/**
 * Fail when any link in the runtime tree still resolves into the repository.
 * The tree itself sits under the repository during the build, so "inside the
 * repository" alone proves nothing: what matters is a link that escapes the
 * copy and lands on repository sources.
 * @param {string} root runtime tree.
 * @returns {{ inside: number, outside: string[] }}
 */
function auditLinks(root) {
  const offenders = []
  const outside = []
  let inside = 0
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
        else if (insidePath(root, target)) inside += 1
        else outside.push(`${relative(root, path)} -> ${target}`)
        continue
      }
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(root)
  if (offenders.length > 0) {
    for (const offender of offenders.slice(0, 20)) console.error(`  ${offender}`)
    fail(`${offenders.length} link(s) escape the copy into ${REPO}`)
  }
  return { inside, outside }
}

/**
 * Record every link as runtime-relative destination and target, so the shell
 * can rebuild the tree after the archive is extracted somewhere else.
 * @param {string} root runtime tree.
 * @returns {{ links: { path: string, target: string, directory: boolean }[], external: string[] }}
 */
function recordManifest(root) {
  const links = []
  const external = []
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path)
        if (!insidePath(root, target)) {
          external.push(`${relative(root, path)} -> ${target}`)
          continue
        }
        links.push({
          path: relative(root, path).split(sep).join('/'),
          target: relative(root, target).split(sep).join('/'),
          directory: statSync(target).isDirectory(),
        })
        continue
      }
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(root)
  writeFileSync(MANIFEST, `${JSON.stringify({ version: 1, links, external }, undefined, 0)}\n`)
  return { links, external }
}

/**
 * Remove every link from the tree; the manifest is now the only record of
 * them. This is what makes the archive portable.
 * @param {string} root runtime tree.
 * @returns {number} links removed.
 */
function stripLinks(root) {
  let removed = 0
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        unlinkSync(path)
        removed += 1
        continue
      }
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(root)
  return removed
}

/** Name the command that produces each missing artifact. */
function preflight() {
  const required = [
    [join(REPO, 'apps', 'yantao', 'dist', 'index.html'), 'pnpm --filter @deepseek-ai/dsh-yantao-frontend run build'],
    [join(REPO, 'packages', 'client', 'ui-yantao', 'lib', 'client.js'), 'pnpm --filter @deepseek-ai/dsh-client-ui-yantao run bundle'],
    [join(REPO, 'packages', 'yantao', 'kb', 'lib', 'index.js'), 'the workspace lib/ build (see AGENTS.md "Before you commit")'],
    [join(REPO, 'apps', 'cli', 'lib', 'bin.js'), 'npx tsdown --env.DSH_BUILD_FACE host -F "@deepseek-ai/dsh"'],
  ]
  const missing = required.filter(([path]) => !existsSync(path))
  if (missing.length === 0) return
  for (const [path, command] of missing) console.error(`pack-release: missing ${path}\n               produce it with: ${command}`)
  process.exit(1)
}

/** Materialize the copy. */
function materialize() {
  rmSync(RUNTIME, { recursive: true, force: true })
  const links = []
  copyTree(REPO, RUNTIME, links)
  for (const { destination, target, directory } of links) {
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(target, destination, directory ? 'junction' : 'file')
  }
  console.log(`pack-release: runtime materialized (${links.length} links)`)
  stripSources(RUNTIME)
}

/**
 * Boot the copied CLI against a throwaway home and compose the profile.
 * A failure here means the tree cannot start, which is the one thing the
 * gates above cannot see.
 */
function smoke() {
  rmSync(SMOKE_HOME, { recursive: true, force: true })
  const bin = join(RUNTIME, 'apps', 'cli', 'lib', 'bin.js')
  const result = spawnSync(process.execPath, [bin, '--profile', PROFILE, '--dump-config'], {
    cwd: RUNTIME,
    env: { ...process.env, DSH_HOME: SMOKE_HOME },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
  })
  if (result.status !== 0) {
    console.error(result.stdout?.slice(-2000) ?? '')
    console.error(result.stderr?.slice(-2000) ?? '')
    fail(`smoke failed: the copied CLI exited ${result.status ?? result.signal}`)
  }
  if (!existsSync(join(SMOKE_HOME, 'profiles', PROFILE, 'package.json'))) {
    fail('smoke failed: the profile template did not initialize on the throwaway home')
  }
  const lines = (result.stdout ?? '').split('\n').length
  console.log(`pack-release: smoke passed — profile composed (${lines} lines), template initialized`)
}

/**
 * Build the frozen shell and put the runtime beside it.
 *
 * The copy happens after electron-builder, not through `extraResources`:
 * electron-builder's file matcher drops every `node_modules` subtree, which
 * silently emptied pnpm's virtual store and produced a runtime that could not
 * boot (2026-10-24).
 */
function packShell() {
  const requireFromApp = createRequire(join(APP, 'package.json'))
  const { build } = requireFromApp('esbuild')
  return build({
    entryPoints: [join(APP, 'src', 'main.ts')],
    outfile: join(APP, 'dist', 'main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['electron'],
    logLevel: 'warning',
  }).then(() => {
    copyFileSync(join(APP, 'src', 'preload.cjs'), join(APP, 'dist', 'preload.cjs'))
    const cli = join(APP, 'node_modules', 'electron-builder', 'cli.js')
    if (!existsSync(cli)) fail('electron-builder is not installed — run pnpm install')
    const result = spawnSync(process.execPath, [
      cli, '--config', join(APP, 'electron-builder.config.mjs'), '--dir', `-c.directories.output=${SHELL_BUILD}`,
    ], { cwd: APP, stdio: 'inherit', windowsHide: true })
    if (result.status !== 0) fail(`electron-builder exited ${result.status ?? result.signal}`)
    const destination = join(OUT, 'resources', 'runtime')
    rmSync(destination, { recursive: true, force: true })
    cpSync(RUNTIME, destination, { recursive: true })
    console.log(`pack-release: shell packed — runtime copied into ${destination}`)
  })
}

/** Zip the unpacked directory; `tar -a` is bsdtar, which writes zip on Windows. */
function zipShell() {
  const version = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')).version
  const zip = join(BUILD, `yantao-workbench-${version}-win-x64.zip`)
  rmSync(zip, { force: true })
  // bsdtar reads a Windows drive letter in `-f` as a remote host ("D: ..."), so
  // the archive name stays relative and the working directory carries the rest.
  const result = spawnSync('tar', ['-a', '-c', '-f', zip.slice(zip.lastIndexOf('\\') + 1), '-C', OUT, '.'], {
    cwd: BUILD, stdio: 'inherit', windowsHide: true,
  })
  if (result.status !== 0) fail(`tar exited ${result.status ?? result.signal}`)
  const size = Math.round(statSync(zip).size / 1024 / 1024)
  console.log(`pack-release: zip written — ${zip} (${size} MB)`)
}

/** @param {string[]} argv */
function flags(argv) {
  return {
    reuse: argv.includes('--reuse-runtime'),
    smoke: !argv.includes('--no-smoke'),
    strip: argv.includes('--strip-links'),
    shell: argv.includes('--with-shell'),
    zip: argv.includes('--zip'),
  }
}

const options = flags(process.argv.slice(2))
preflight()
if (options.reuse && existsSync(RUNTIME)) {
  console.log('pack-release: reusing the materialized runtime')
} else {
  materialize()
}
const pruned = pruneDangling(RUNTIME)
if (pruned > 0) console.log(`pack-release: pruned ${pruned} dangling link(s)`)
const audited = auditLinks(RUNTIME)
console.log(`pack-release: decoupling gate passed — ${audited.inside} link(s) stay inside the copy`)
if (audited.outside.length > 0) {
  for (const line of audited.outside.slice(0, 10)) console.error(`  ${line}`)
  fail(`${audited.outside.length} link(s) point outside the copy — the runtime would not survive a move`)
}
const canSmoke = options.smoke && audited.inside > 0
if (options.smoke && !canSmoke) {
  console.log('pack-release: the tree is already stripped — smoke skipped (it ran before the strip)')
}
if (canSmoke) smoke()

// A tree that is already stripped keeps its manifest: re-running on it must
// not overwrite the record with an empty one.
let recorded
if (audited.inside === 0 && existsSync(MANIFEST)) {
  recorded = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  console.log(`pack-release: manifest kept (${recorded.links.length} links) — the tree was already stripped`)
} else {
  recorded = recordManifest(RUNTIME)
  console.log(`pack-release: link manifest written (${recorded.links.length} links)`)
}

let stripped = 0
if (options.strip) {
  stripped = stripLinks(RUNTIME)
  if (stripped !== audited.inside) {
    fail(`stripped ${stripped} link(s) but ${audited.inside} were present — the manifest and the tree disagree`)
  }
  console.log(`pack-release: stripped ${stripped} link(s) — the archive now carries none`)
}

if (options.shell) {
  if (!options.strip) fail('--with-shell needs --strip-links: the archive must carry no links')
  await packShell()
}
if (options.zip) {
  if (!options.shell) fail('--zip needs --with-shell')
  zipShell()
}

writeFileSync(join(BUILD, 'release.json'), `${JSON.stringify({
  builtAt: new Date().toISOString(),
  runtime: relative(REPO, RUNTIME).split(sep).join('/'),
  profile: PROFILE,
  links: recorded.links.length,
  strippedLinks: stripped,
}, undefined, 2)}\n`)
console.log(`pack-release: done — ${RUNTIME}`)
