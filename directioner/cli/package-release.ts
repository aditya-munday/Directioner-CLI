#!/usr/bin/env bun

/**
 * Build the Directioner release package locally.
 *
 * This assembles the exact directory that would be published as the
 * `directioner` npm package — the compiled binary, its `tree-sitter.wasm`
 * sibling, and the standalone launcher — into a staging directory, then runs
 * `npm pack` on it. It never publishes, never touches a network origin, and
 * never contacts the legacy release infrastructure.
 *
 * Usage:
 *   bun directioner/cli/package-release.ts [version]
 *
 * Output:
 *   directioner/cli/release/.build/          the package directory
 *   directioner/cli/release/dist/directioner-<version>.tgz
 */

import { spawnSync } from 'child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const releaseDir = join(__dirname, 'release')
const buildDir = join(releaseDir, '.build')
const distDir = join(releaseDir, 'dist')
const binDir = join(repoRoot, 'cli', 'bin')

const version = process.argv[2] ?? '0.0.0-dev'

/** Files the launcher loads at runtime, in the order they are copied. */
const PACKAGE_FILES = ['index.js', 'launcher.js', 'README.md'] as const
/** Binary assets copied from cli/bin into the package. */
const BINARY_ASSETS = ['directioner', 'tree-sitter.wasm'] as const

function fail(message: string): never {
  console.error(`❌ ${message}`)
  process.exit(1)
}

function log(message: string) {
  console.log(message)
}

function assertFile(filePath: string, label: string) {
  if (!existsSync(filePath)) fail(`${label} is missing: ${filePath}`)
  if (!statSync(filePath).isFile()) fail(`${label} is not a file: ${filePath}`)
}

// The binary must be built first; packaging an absent or stale binary is the
// failure mode this script exists to prevent.
assertFile(join(binDir, 'directioner'), 'built binary (run `bun directioner/cli/build.ts <version>`)')
assertFile(join(binDir, 'tree-sitter.wasm'), 'tree-sitter.wasm sibling')

rmSync(buildDir, { recursive: true, force: true })
mkdirSync(buildDir, { recursive: true })

// The launcher and entrypoint are the source of truth in release/; copy them
// into the build directory alongside the assets. index.js and launcher.js are
// committed source (not generated), so a copy is a verbatim reproduction.
for (const fileName of PACKAGE_FILES) {
  assertFile(join(releaseDir, fileName), `release file ${fileName}`)
  cpSync(join(releaseDir, fileName), join(buildDir, fileName))
}

for (const asset of BINARY_ASSETS) {
  cpSync(join(binDir, asset), join(buildDir, asset))
  if (asset === 'directioner') {
    spawnSync('chmod', ['+x', join(buildDir, asset)], { stdio: 'inherit' })
  }
}

// Stamp the requested version into the packaged manifest.
const manifestPath = join(releaseDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.version = version
writeFileSync(
  join(buildDir, 'package.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)

log(`Packaging directioner v${version} from ${buildDir}`)

// Pack into a sibling dist/ directory: npm pack always writes the tarball into
// its cwd, and a tarball inside the package directory would be a nested copy of
// the package in its own file list.
rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

// --ignore-scripts: the package has no lifecycle scripts, and we never want a
// prepack hook to run against the build directory. No network, no publish.
const packResult = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', distDir], {
  cwd: buildDir,
  stdio: 'inherit',
})
if (packResult.status !== 0) fail('npm pack failed')

const tarball = join(distDir, `directioner-${version}.tgz`)
assertFile(tarball, 'packed tarball')

log(`✅ Packed ${tarball}`)
