import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const require = createRequire(import.meta.url)

const releaseDir = join(repoRoot, 'directioner/cli/release')
const launcherPath = join(releaseDir, 'launcher.js')
const { createLauncher } = require(launcherPath) as {
  createLauncher: (config?: Record<string, unknown>) => {
    config: Record<string, unknown>
    __testing: {
      ensureInstalled: () => string
      resolveCacheDir: (env: Record<string, string>) => {
        dir: string | null
        error: string | null
      }
      atomicCopy: (src: string, dst: string, mode?: number) => void
      readInstalledRecord: (p: string) => unknown
      binaryFileName: (platform: string) => string
    }
  }
}

/** Build a package directory that looks exactly like the published package. */
function makePackageDir(
  overrides: { withWasm?: boolean; binaryContents?: string } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'directioner-pkg-'))
  writeFileSync(join(dir, 'directioner'), overrides.binaryContents ?? 'BINARY')
  if (overrides.withWasm !== false) {
    writeFileSync(join(dir, 'tree-sitter.wasm'), 'WASM')
  }
  return dir
}

function makeEnv(cacheDir: string): Record<string, string> {
  return { DIRECTIONER_CACHE_DIR: cacheDir }
}

describe('Directioner release wrapper', () => {
  test('is product configuration only, with the expected identity', () => {
    const wrapperModule = require(join(releaseDir, 'index.js'))
    expect(wrapperModule.config).toMatchObject({
      packageName: 'directioner',
      displayName: 'Directioner',
    })
  })

  test('declares the correct package identity and no lifecycle scripts', () => {
    const packageJson = JSON.parse(
      readFileSync(join(releaseDir, 'package.json'), 'utf8'),
    )
    expect(packageJson.name).toBe('directioner')
    expect(packageJson.bin).toEqual({ directioner: 'index.js' })
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/)

    // No install-time hooks and no dependencies: nothing runs at install time
    // and nothing is fetched from a registry beyond the package itself.
    for (const script of [
      'preinstall',
      'install',
      'postinstall',
      'preuninstall',
      'prepack',
      'postpack',
    ]) {
      expect(packageJson.scripts?.[script]).toBeUndefined()
    }
    expect(packageJson.dependencies).toBeUndefined()

    // The package ships the binary and its sibling asset, or it cannot run.
    expect(packageJson.files).toContain('directioner')
    expect(packageJson.files).toContain('tree-sitter.wasm')
    expect(packageJson.files).toContain('launcher.js')
  })

  test('the launcher requires nothing but Node built-ins', () => {
    const source = readFileSync(launcherPath, 'utf8')
    const required = [...source.matchAll(/require\('([^']+)'\)/g)].map(
      (m) => m[1],
    )
    const allowed = new Set([
      'child_process',
      'crypto',
      'fs',
      'os',
      'path',
      './launcher',
    ])
    for (const name of required) {
      expect(allowed.has(name)).toBe(true)
    }
  })

  test('contains no network primitives or vendor endpoints', () => {
    const source = readFileSync(launcherPath, 'utf8')
    for (const forbidden of [
      "require('http')",
      "require('https')",
      "require('net')",
      "require('tls')",
      "require('dns')",
      'fetch(',
      'beyonders.com',
      'directioner.com',
      'registry.npmjs.org',
      'posthog',
      '/api/releases',
      'https://',
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  test('sets the launcher pid for the child binary', () => {
    const source = readFileSync(launcherPath, 'utf8')
    expect(source).toContain('DIRECTIONER_LAUNCHER_PID')
  })
})

describe('Directioner launcher install behavior', () => {
  test('fails deterministically on an unsupported platform', () => {
    const pkg = makePackageDir()
    try {
      const launcher = createLauncher({
        packageDir: pkg,
        platform: 'plan9',
        arch: 'x64',
        env: {},
      })
      expect(() => launcher.__testing.ensureInstalled()).toThrow(
        /unsupported platform plan9-x64/,
      )
    } finally {
      rmSync(pkg, { recursive: true, force: true })
    }
  })

  test('fails with reinstall guidance when the packaged binary is missing', () => {
    const pkg = mkdtempSync(join(tmpdir(), 'directioner-empty-'))
    try {
      const launcher = createLauncher({
        packageDir: pkg,
        platform: 'linux',
        arch: 'x64',
        env: {},
      })
      expect(() => launcher.__testing.ensureInstalled()).toThrow(
        /packaged binary is missing.*npm install -g directioner/s,
      )
    } finally {
      rmSync(pkg, { recursive: true, force: true })
    }
  })

  test('rejects a relative cache directory', () => {
    const pkg = makePackageDir()
    try {
      const launcher = createLauncher({
        packageDir: pkg,
        platform: 'linux',
        arch: 'x64',
        env: { DIRECTIONER_CACHE_DIR: 'relative/cache' },
      })
      expect(() => launcher.__testing.ensureInstalled()).toThrow(
        /DIRECTIONER_CACHE_DIR must be an absolute path/,
      )
    } finally {
      rmSync(pkg, { recursive: true, force: true })
    }
  })

  test('installs the binary and its wasm sibling, then is idempotent', () => {
    const pkg = makePackageDir()
    const cache = mkdtempSync(join(tmpdir(), 'directioner-cache-'))
    try {
      const launcher = createLauncher({
        packageDir: pkg,
        platform: 'linux',
        arch: 'x64',
        env: makeEnv(cache),
      })
      const installed = launcher.__testing.ensureInstalled()
      expect(installed).toBe(join(cache, 'directioner'))
      expect(readFileSync(installed, 'utf8')).toBe('BINARY')
      expect(readFileSync(join(cache, 'tree-sitter.wasm'), 'utf8')).toBe('WASM')

      const record = JSON.parse(
        readFileSync(join(cache, 'installed.json'), 'utf8'),
      )
      expect(record.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(record.platform).toBe('linux')

      // A second launch with an unchanged package rewrites nothing.
      const recordBefore = readFileSync(join(cache, 'installed.json'), 'utf8')
      launcher.__testing.ensureInstalled()
      expect(readFileSync(join(cache, 'installed.json'), 'utf8')).toBe(
        recordBefore,
      )
      expect(readdirSync(cache).filter((f) => f.includes('.tmp-'))).toEqual([])
    } finally {
      rmSync(pkg, { recursive: true, force: true })
      rmSync(cache, { recursive: true, force: true })
    }
  })

  test('reinstalls when the packaged binary changes', () => {
    const cache = mkdtempSync(join(tmpdir(), 'directioner-cache-'))
    const pkg = makePackageDir({ binaryContents: 'V1' })
    try {
      const first = createLauncher({
        packageDir: pkg,
        platform: 'linux',
        arch: 'x64',
        env: makeEnv(cache),
      })
      first.__testing.ensureInstalled()
      expect(readFileSync(join(cache, 'directioner'), 'utf8')).toBe('V1')

      writeFileSync(join(pkg, 'directioner'), 'V2')
      const second = createLauncher({
        packageDir: pkg,
        platform: 'linux',
        arch: 'x64',
        env: makeEnv(cache),
      })
      second.__testing.ensureInstalled()
      expect(readFileSync(join(cache, 'directioner'), 'utf8')).toBe('V2')
    } finally {
      rmSync(pkg, { recursive: true, force: true })
      rmSync(cache, { recursive: true, force: true })
    }
  })

  test('installs without tree-sitter.wasm (code intelligence degrades)', () => {
    const pkg = makePackageDir({ withWasm: false })
    const cache = mkdtempSync(join(tmpdir(), 'directioner-cache-'))
    try {
      const launcher = createLauncher({
        packageDir: pkg,
        platform: 'linux',
        arch: 'x64',
        env: makeEnv(cache),
      })
      expect(() => launcher.__testing.ensureInstalled()).not.toThrow()
      expect(existsSync(join(cache, 'directioner'))).toBe(true)
      expect(existsSync(join(cache, 'tree-sitter.wasm'))).toBe(false)
    } finally {
      rmSync(pkg, { recursive: true, force: true })
      rmSync(cache, { recursive: true, force: true })
    }
  })

  test('uses the platform binary name (exe on win32)', () => {
    const pkg = makePackageDir()
    const cache = mkdtempSync(join(tmpdir(), 'directioner-cache-'))
    try {
      writeFileSync(join(pkg, 'directioner.exe'), 'WINBIN')
      const launcher = createLauncher({
        packageDir: pkg,
        platform: 'win32',
        arch: 'x64',
        env: makeEnv(cache),
      })
      const installed = launcher.__testing.ensureInstalled()
      expect(installed).toBe(join(cache, 'directioner.exe'))
      expect(readFileSync(installed, 'utf8')).toBe('WINBIN')
    } finally {
      rmSync(pkg, { recursive: true, force: true })
      rmSync(cache, { recursive: true, force: true })
    }
  })
})
