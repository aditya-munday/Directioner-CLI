#!/usr/bin/env node

/**
 * Directioner npm launcher.
 *
 * Directioner is BYOK-first and standalone: this launcher ships the compiled
 * binary inside the npm package and never contacts a network origin. It copies
 * the packaged binary (and its `tree-sitter.wasm` sibling) into a per-user cache
 * and execs it. There is no download, no update check, no telemetry, and no
 * vendor endpoint — reinstall with `npm install -g directioner` to update.
 *
 * This file is standalone: it is copied verbatim into the published package and
 * must not `require()` anything outside Node's standard library. Everything it
 * needs is a sibling in the package directory.
 */

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * Terminal escape sequences to reset terminal state after the child exits.
 * When the binary is SIGKILL'd it cannot clean up its own terminal state; this
 * launcher process survives and must reset it. Kept byte-identical to
 * `TERMINAL_RESET_SEQUENCES` in cli/src/utils/terminal-reset-sequences.ts — a
 * test fails on drift.
 */
const EXIT_ALTERNATE_SCREEN_SEQUENCE = '\x1b[?1049l'
const SAFE_TERMINAL_RESET_SEQUENCES =
  '\x1b[?1000l' + // Disable X10 mouse mode
  '\x1b[?1002l' + // Disable button event mouse mode
  '\x1b[?1003l' + // Disable any-event mouse mode (all motion)
  '\x1b[?1006l' + // Disable SGR extended mouse mode
  '\x1b[?1004l' + // Disable focus reporting
  '\x1b[?2004l' + // Disable bracketed paste mode
  '\x1b[<u' + // Pop kitty keyboard protocol flags
  '\x1b[>4;0m' + // Reset modifyOtherKeys
  '\x1b[?25h' // Show cursor

/** The only platforms the release packages. Kept in sync with package.json. */
const SUPPORTED_PLATFORMS = new Set(['linux', 'darwin', 'win32'])
const SUPPORTED_ARCHES = new Set(['x64', 'arm64'])

function binaryFileName(platform) {
  return platform === 'win32' ? 'directioner.exe' : 'directioner'
}

/**
 * The cache directory. `~/.cache/directioner` by default (XDG-respecting), or
 * `$DIRECTIONER_CACHE_DIR` when set to an absolute path. It is a cache, never a
 * config location, and holds no secrets.
 */
function resolveCacheDir(env) {
  const override = env.DIRECTIONER_CACHE_DIR
  if (typeof override === 'string' && override.trim() !== '') {
    if (!path.isAbsolute(override)) {
      return { dir: null, error: 'DIRECTIONER_CACHE_DIR must be an absolute path.' }
    }
    return { dir: override, error: null }
  }
  const xdg = env.XDG_CACHE_HOME
  const base =
    typeof xdg === 'string' && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.cache')
  return { dir: path.join(base, 'directioner'), error: null }
}

function readPackageVersion(packageDir) {
  try {
    const raw = fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')
    const version = JSON.parse(raw).version
    return typeof version === 'string' && version ? version : null
  } catch {
    return null
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function readInstalledRecord(recordPath) {
  try {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    if (
      record &&
      typeof record.version === 'string' &&
      typeof record.sha256 === 'string'
    ) {
      return record
    }
  } catch {
    // Missing or corrupt: treated as "not installed".
  }
  return null
}

/**
 * Publish a complete file atomically, so a concurrent launch never execs a
 * half-written binary. The temp file is created in the destination directory so
 * the final rename stays on one filesystem.
 */
function atomicCopy(sourcePath, destinationPath, mode) {
  const tempPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.copyFileSync(sourcePath, tempPath)
    if (mode !== undefined) fs.chmodSync(tempPath, mode)
    fs.renameSync(tempPath, destinationPath)
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true })
    } catch {
      // Best effort.
    }
    throw error
  }
}

function createLauncher(config = {}) {
  const packageDir = config.packageDir || __dirname
  const packageName = config.packageName || 'directioner'
  const displayName = config.displayName || 'Directioner'
  const platform = config.platform || process.platform
  const arch = config.arch || process.arch
  const env = config.env || process.env

  const binaryName = binaryFileName(platform)
  const packagedBinaryPath = path.join(packageDir, binaryName)
  const packagedWasmPath = path.join(packageDir, 'tree-sitter.wasm')

  function fail(message) {
    process.stderr.write(`${displayName} launcher error: ${message}\n`)
    process.exit(1)
  }

  /** Resolve and prepare the cached binary. Returns its path, or throws. */
  function ensureInstalled() {
    if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHES.has(arch)) {
      throw new Error(
        `unsupported platform ${platform}-${arch}. Supported: ` +
          [...SUPPORTED_PLATFORMS].join(', ') +
          ' on ' +
          [...SUPPORTED_ARCHES].join(', ') +
          '.',
      )
    }

    if (!fs.existsSync(packagedBinaryPath)) {
      throw new Error(
        `the packaged binary is missing (${packagedBinaryPath}). ` +
          `Reinstall with: npm install -g ${packageName}`,
      )
    }

    const { dir: cacheDir, error: cacheError } = resolveCacheDir(env)
    if (!cacheDir) throw new Error(cacheError)

    const version = readPackageVersion(packageDir) || '0.0.0'
    const packagedSha = sha256File(packagedBinaryPath)
    const targetBinaryPath = path.join(cacheDir, binaryName)
    const recordPath = path.join(cacheDir, 'installed.json')

    const installed = readInstalledRecord(recordPath)
    const upToDate =
      installed &&
      installed.version === version &&
      installed.sha256 === packagedSha &&
      fs.existsSync(targetBinaryPath)

    if (!upToDate) {
      fs.mkdirSync(cacheDir, { recursive: true })
      atomicCopy(packagedBinaryPath, targetBinaryPath, 0o755)
      if (fs.existsSync(packagedWasmPath)) {
        atomicCopy(packagedWasmPath, path.join(cacheDir, 'tree-sitter.wasm'))
      }
      fs.writeFileSync(
        recordPath,
        JSON.stringify({ version, sha256: packagedSha, platform, arch }, null, 2),
      )
    }

    // tree-sitter.wasm is required for code intelligence but not for
    // `--version` / `--doctor`, so its absence warns rather than blocking a run.
    if (!fs.existsSync(path.join(cacheDir, 'tree-sitter.wasm'))) {
      process.stderr.write(
        `${displayName}: tree-sitter.wasm is missing from the package; ` +
          `code intelligence may be unavailable. Reinstall with: npm install -g ${packageName}\n`,
      )
    }

    return targetBinaryPath
  }

  function resetTerminal() {
    if (!process.stdout.isTTY) return
    try {
      process.stdout.write(
        EXIT_ALTERNATE_SCREEN_SEQUENCE + SAFE_TERMINAL_RESET_SEQUENCES,
      )
    } catch {
      // Best effort: a closed stdout is not a reason to fail the launch.
    }
  }

  function spawnBinary(binaryPath, args) {
    const child = spawn(binaryPath, args, {
      stdio: 'inherit',
      env: { ...env, DIRECTIONER_LAUNCHER_PID: String(process.pid) },
    })

    const forward = (signal) => {
      try {
        child.kill(signal)
      } catch {
        // Child already gone.
      }
    }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(signal, () => forward(signal))
    }

    child.on('error', (error) => {
      resetTerminal()
      process.stderr.write(`${displayName} failed to start: ${error.message}\n`)
      process.exit(1)
    })
    child.on('exit', (code, signal) => {
      resetTerminal()
      process.exit(signal ? 1 : code || 0)
    })
    return child
  }

  function printUpdateGuidance() {
    process.stdout.write(
      `${displayName} does not check for updates automatically and has no update\n` +
        `endpoint. To update, reinstall from npm:\n\n` +
        `  npm install -g ${packageName}\n`,
    )
  }

  async function main() {
    const args = process.argv.slice(2)
    if (args.includes('--check-update')) {
      printUpdateGuidance()
      return
    }

    let binaryPath
    try {
      binaryPath = ensureInstalled()
    } catch (error) {
      fail(error.message)
    }
    spawnBinary(binaryPath, args)
  }

  return {
    config: { packageName, displayName, platform, arch },
    main,
    __testing: {
      ensureInstalled,
      resolveCacheDir,
      binaryFileName,
      atomicCopy,
      readInstalledRecord,
      packagedBinaryPath,
      packagedWasmPath,
    },
  }
}

module.exports = { createLauncher }
