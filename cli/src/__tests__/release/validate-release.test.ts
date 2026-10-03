import { describe, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  detectBinaryFormat,
  scanForSecrets,
  validateRelease,
} from '../../../../scripts/validate-release'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/** A minimal ELF header with the given e_machine, padded past 20 bytes. */
function elfHeader(machine: number): Buffer {
  const header = Buffer.alloc(64)
  header[0] = 0x7f
  header[1] = 0x45
  header[2] = 0x4c
  header[3] = 0x46
  header.writeUInt16LE(machine, 0x12)
  return header
}

/** A package directory that passes every check, to be mutated per test. */
function makeValidPackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'directioner-valid-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(validManifest(), null, 2))
  writeFileSync(join(dir, 'index.js'), "require('./launcher')\n")
  writeFileSync(join(dir, 'launcher.js'), "module.exports = { createLauncher() {} }\n")
  writeFileSync(
    join(dir, 'README.md'),
    '# Directioner\n\nConfigure a provider and set your API key.\n',
  )
  // A plausible ELF x64 binary above the minimum size.
  const binary = Buffer.alloc(6 * 1024 * 1024)
  elfHeader(0x3e).copy(binary, 0)
  writeFileSync(join(dir, 'directioner'), binary)
  writeFileSync(join(dir, 'tree-sitter.wasm'), 'wasm')
  return dir
}

function validManifest(): Record<string, unknown> {
  return {
    name: 'directioner',
    version: '1.2.3',
    bin: { directioner: 'index.js' },
    files: ['index.js', 'launcher.js', 'README.md', 'directioner', 'tree-sitter.wasm'],
    repository: {
      type: 'git',
      url: 'git+https://github.com/aditya-munday/Directioner-CLI.git',
    },
  }
}

function withPackage(
  mutate: (dir: string) => void,
  run: (dir: string) => void,
) {
  const dir = makeValidPackage()
  try {
    mutate(dir)
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function failingCheckNames(dir: string): string[] {
  return validateRelease(dir)
    .checks.filter((c) => !c.ok && c.severity === 'error')
    .map((c) => c.name)
}

describe('release validator: baseline', () => {
  test('accepts a well-formed package', () => {
    withPackage(
      () => {},
      (dir) => {
        const report = validateRelease(dir)
        expect(report.ok).toBe(true)
        expect(report.checks.every((c) => c.ok)).toBe(true)
      },
    )
  })

  test('rejects a missing package directory', () => {
    const report = validateRelease(join(tmpdir(), 'directioner-does-not-exist'))
    expect(report.ok).toBe(false)
    expect(report.checks[0].detail).toContain('not a directory')
  })
})

describe('release validator: identity', () => {
  test('rejects a wrong package name', () => {
    withPackage(
      (dir) => {
        const m = validManifest()
        m.name = 'beyonders'
        writeFileSync(join(dir, 'package.json'), JSON.stringify(m))
      },
      (dir) => expect(failingCheckNames(dir)).toContain('identity: package name'),
    )
  })

  test('rejects a wrong executable name', () => {
    withPackage(
      (dir) => {
        const m = validManifest()
        m.bin = { directioner: 'cli.js' }
        writeFileSync(join(dir, 'package.json'), JSON.stringify(m))
      },
      (dir) =>
        expect(failingCheckNames(dir)).toContain('identity: executable name'),
    )
  })

  test('rejects a non-semver version', () => {
    withPackage(
      (dir) => {
        const m = validManifest()
        m.version = 'latest'
        writeFileSync(join(dir, 'package.json'), JSON.stringify(m))
      },
      (dir) => expect(failingCheckNames(dir)).toContain('identity: version is semver'),
    )
  })

  test('rejects vendor repository metadata', () => {
    withPackage(
      (dir) => {
        const m = validManifest()
        m.repository = { type: 'git', url: 'git+https://github.com/BeyondersAI/beyonders.git' }
        writeFileSync(join(dir, 'package.json'), JSON.stringify(m))
      },
      (dir) =>
        expect(failingCheckNames(dir)).toContain('identity: repository metadata'),
    )
  })

  test('rejects install-time lifecycle scripts', () => {
    withPackage(
      (dir) => {
        const m = validManifest()
        m.scripts = { postinstall: 'node setup.js' }
        writeFileSync(join(dir, 'package.json'), JSON.stringify(m))
      },
      (dir) =>
        expect(failingCheckNames(dir)).toContain(
          'identity: no install-time lifecycle scripts',
        ),
    )
  })

  test('rejects runtime dependencies', () => {
    withPackage(
      (dir) => {
        const m = validManifest()
        m.dependencies = { 'posthog-node': '^5.0.0' }
        writeFileSync(join(dir, 'package.json'), JSON.stringify(m))
      },
      (dir) =>
        expect(failingCheckNames(dir)).toContain('identity: no runtime dependencies'),
    )
  })
})

describe('release validator: legacy coupling', () => {
  test('rejects a vendor reference in a package file', () => {
    withPackage(
      (dir) =>
        writeFileSync(
          join(dir, 'README.md'),
          'Configure a provider and set your API key.\nSee https://beyonders.com\n',
        ),
      (dir) =>
        expect(failingCheckNames(dir)).toContain(
          'legacy: package files carry no vendor references',
        ),
    )
  })

  test('treats a vendor reference in the binary as a warning, not an error', () => {
    withPackage(
      (dir) => {
        const binary = readFileSync(join(dir, 'directioner'))
        Buffer.from('https://us.i.posthog.com/capture/').copy(binary, 1024)
        writeFileSync(join(dir, 'directioner'), binary)
      },
      (dir) => {
        const report = validateRelease(dir)
        expect(report.ok).toBe(true)
        const binaryCheck = report.checks.find(
          (c) => c.name === 'legacy: binary carries no vendor references',
        )
        expect(binaryCheck?.ok).toBe(false)
        expect(binaryCheck?.severity).toBe('warning')
      },
    )
  })
})

describe('release validator: secrets', () => {
  test('rejects a credential in a package file', () => {
    withPackage(
      (dir) =>
        writeFileSync(
          join(dir, 'launcher.js'),
          "const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'\n",
        ),
      (dir) =>
        expect(failingCheckNames(dir)).toContain(
          'secrets: no credentials in package files',
        ),
    )
  })

  test('rejects an environment-file artifact', () => {
    withPackage(
      (dir) => writeFileSync(join(dir, '.env'), 'HEITAL_API_KEY=whatever\n'),
      (dir) =>
        expect(failingCheckNames(dir)).toContain(
          'secrets: no environment-file artifacts in package',
        ),
    )
  })

  test('scanForSecrets matches credential shapes and ignores prose', () => {
    expect(scanForSecrets('ghp_' + 'a'.repeat(30))).toContain('github token')
    expect(scanForSecrets('AKIA' + 'A'.repeat(16))).toContain('aws access key id')
    expect(scanForSecrets('just a normal sentence about providers')).toBeNull()
  })
})

describe('release validator: archive integrity', () => {
  test('rejects a missing required file', () => {
    withPackage(
      (dir) => rmSync(join(dir, 'README.md')),
      (dir) =>
        expect(failingCheckNames(dir)).toContain('archive: required files present'),
    )
  })

  test('rejects a missing tree-sitter.wasm', () => {
    withPackage(
      (dir) => rmSync(join(dir, 'tree-sitter.wasm')),
      (dir) =>
        expect(failingCheckNames(dir)).toContain(
          'archive: required runtime assets present',
        ),
    )
  })

  test('rejects a nested tarball', () => {
    withPackage(
      (dir) => writeFileSync(join(dir, 'directioner-1.2.3.tgz'), 'x'),
      (dir) =>
        expect(failingCheckNames(dir)).toContain('archive: no nested copy of itself'),
    )
  })

  test('rejects internal-only files', () => {
    withPackage(
      (dir) => writeFileSync(join(dir, 'PROGRESS.md'), 'internal notes'),
      (dir) => expect(failingCheckNames(dir)).toContain('archive: no internal-only files'),
    )
  })

  test('rejects a non-executable binary', () => {
    withPackage(
      (dir) => writeFileSync(join(dir, 'directioner'), 'not a binary at all'),
      (dir) =>
        expect(failingCheckNames(dir)).toContain(
          'binary: exists and is a native executable',
        ),
    )
  })
})

describe('release validator: binary format', () => {
  test('detects ELF x64 and arm64', () => {
    expect(detectBinaryFormat(elfHeader(0x3e))).toBe('elf:x64')
    expect(detectBinaryFormat(elfHeader(0xb7))).toBe('elf:arm64')
  })

  test('detects Mach-O and PE', () => {
    const macho = Buffer.alloc(32)
    macho.writeUInt32BE(0xfeedfacf, 0)
    expect(detectBinaryFormat(macho)).toBe('mach-o')

    const pe = Buffer.alloc(64)
    pe[0] = 0x4d
    pe[1] = 0x5a
    expect(detectBinaryFormat(pe)).toBe('pe')
  })

  test('returns null for a non-binary', () => {
    expect(detectBinaryFormat(Buffer.from('plain text content here'))).toBeNull()
  })
})

describe('release validator: docs', () => {
  test('rejects a README that describes hosted login', () => {
    withPackage(
      (dir) =>
        writeFileSync(
          join(dir, 'README.md'),
          'Press Enter to login. Configure a provider and set your API key.\n',
        ),
      (dir) =>
        expect(failingCheckNames(dir)).toContain(
          'docs: README does not describe hosted-login behavior',
        ),
    )
  })

  test('rejects a README with no BYOK guidance', () => {
    withPackage(
      (dir) => writeFileSync(join(dir, 'README.md'), '# Directioner\n'),
      (dir) =>
        expect(failingCheckNames(dir)).toContain(
          'docs: README describes BYOK configuration',
        ),
    )
  })
})

describe('release validator: version consistency', () => {
  /** Replace the fixture binary with a runnable script that reports `version`. */
  function withRunnableBinary(version: string): (dir: string) => void {
    return (dir) => {
      const binaryPath = join(dir, 'directioner')
      writeFileSync(binaryPath, `#!/bin/sh\necho ${version}\n`)
      chmodSync(binaryPath, 0o755)
    }
  }

  test('skips (does not fail) when the binary cannot run here', () => {
    withPackage(
      () => {},
      (dir) => {
        // The fixture is a synthetic ELF header; exec fails, so the version
        // check is skipped rather than reported as a mismatch.
        const report = validateRelease(dir)
        const check = report.checks.find(
          (c) => c.name === 'version: binary reports the packaged version',
        )
        expect(check?.ok).toBe(true)
      },
    )
  })

  test('fails when a runnable binary reports a different version', () => {
    withPackage(withRunnableBinary('9.9.9'), (dir) => {
      const report = validateRelease(dir)
      const check = report.checks.find(
        (c) => c.name === 'version: binary reports the packaged version',
      )
      expect(check?.ok).toBe(false)
      expect(check?.detail).toContain('9.9.9')
      expect(check?.detail).toContain('1.2.3')
    })
  })

  test('passes when the runnable binary agrees with package.json', () => {
    withPackage(withRunnableBinary('1.2.3'), (dir) => {
      const report = validateRelease(dir)
      const check = report.checks.find(
        (c) => c.name === 'version: binary reports the packaged version',
      )
      expect(check?.ok).toBe(true)
    })
  })

  test('fails when the package version differs from the requested version', () => {
    withPackage(withRunnableBinary('1.2.3'), (dir) => {
      const report = validateRelease(dir, '4.5.6')
      const check = report.checks.find(
        (c) => c.name === 'version: matches the requested release version',
      )
      expect(check?.ok).toBe(false)
      expect(check?.detail).toContain('4.5.6')
    })
  })
})
