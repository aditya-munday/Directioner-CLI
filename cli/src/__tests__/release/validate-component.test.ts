import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseSums,
  validateComponent,
} from '../../../../scripts/validate-component'

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

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Build a component directory that passes every check, to mutate per test. */
function makeValidComponent(): string {
  const dir = mkdtempSync(join(tmpdir(), 'directioner-component-valid-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })

  const binary = Buffer.alloc(6 * 1024 * 1024)
  elfHeader(0x3e).copy(binary, 0) // x64
  const wasm = Buffer.from('wasm')
  writeFileSync(join(bin, 'directioner'), binary)
  writeFileSync(join(bin, 'tree-sitter.wasm'), wasm)
  writeFileSync(join(dir, 'NOTICE'), 'Directioner CLI\n\nBased on Codebuff.\n')
  writeFileSync(
    join(dir, 'SHA256SUMS'),
    `${sha256(binary)}  bin/directioner\n${sha256(wasm)}  bin/tree-sitter.wasm\n`,
  )
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        component: 'directioner-cli',
        product: 'Directioner-CLI',
        version: '1.2.3',
        platform: 'linux',
        architecture: 'x64',
        entrypoint: 'bin/directioner',
        runtimeAssets: ['bin/tree-sitter.wasm'],
        integrity: { algorithm: 'sha256', file: 'SHA256SUMS' },
        notice: 'NOTICE',
        repository: 'github.com/aditya-munday/Directioner-CLI',
      },
      null,
      2,
    ),
  )
  return dir
}

function withComponent(mutate: (dir: string) => void, run: (dir: string) => void) {
  const dir = makeValidComponent()
  try {
    mutate(dir)
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function failing(dir: string, expectedVersion: string | null = null): string[] {
  return validateComponent(dir, expectedVersion)
    .checks.filter((c) => !c.ok)
    .map((c) => c.name)
}

describe('component validator: baseline', () => {
  test('accepts a well-formed component', () => {
    withComponent(
      () => {},
      (dir) => expect(validateComponent(dir, '1.2.3').ok).toBe(true),
    )
  })

  test('rejects a missing directory', () => {
    expect(validateComponent('/nonexistent/directioner-component').ok).toBe(false)
  })
})

describe('component validator: integrity', () => {
  test('rejects a tampered payload file', () => {
    withComponent(
      (dir) => writeFileSync(join(dir, 'bin', 'tree-sitter.wasm'), 'wasm-tampered'),
      (dir) =>
        expect(failing(dir)).toContain('integrity: SHA256SUMS verifies every payload file'),
    )
  })

  test('rejects a SHA256SUMS that omits the binary', () => {
    withComponent(
      (dir) => writeFileSync(join(dir, 'SHA256SUMS'), ''),
      (dir) =>
        expect(failing(dir)).toContain('integrity: SHA256SUMS verifies every payload file'),
    )
  })

  test('parseSums handles the sha256sum format', () => {
    const map = parseSums('a'.repeat(64) + '  bin/directioner\n' + 'b'.repeat(64) + ' *x')
    expect(map.get('bin/directioner')).toBe('a'.repeat(64))
    expect(map.get('x')).toBe('b'.repeat(64))
    expect(map.size).toBe(2)
  })
})

describe('component validator: identity and platform', () => {
  test('rejects a non-Linux platform claim', () => {
    withComponent(
      (dir) => {
        const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
        m.platform = 'darwin'
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m))
      },
      (dir) => expect(failing(dir)).toContain('manifest: identity and layout'),
    )
  })

  test('rejects a version that differs from the requested one', () => {
    withComponent(
      () => {},
      (dir) =>
        expect(failing(dir, '9.9.9')).toContain(
          'manifest: version matches the requested release version',
        ),
    )
  })
})

describe('component validator: executables', () => {
  test('rejects an unexpected extra executable', () => {
    withComponent(
      (dir) => {
        writeFileSync(join(dir, 'bin', 'helper'), '#!/bin/sh\n')
        chmodSync(join(dir, 'bin', 'helper'), 0o755)
      },
      (dir) => expect(failing(dir)).toContain('component: no unexpected executable files'),
    )
  })
})

describe('component validator: attribution', () => {
  test('rejects a NOTICE that drops upstream attribution', () => {
    withComponent(
      (dir) => writeFileSync(join(dir, 'NOTICE'), 'Directioner CLI\n'),
      (dir) =>
        expect(failing(dir)).toContain('component: NOTICE preserves upstream attribution'),
    )
  })
})
