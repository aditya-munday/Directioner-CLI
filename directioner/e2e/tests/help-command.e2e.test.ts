import { execFileSync } from 'node:child_process'

import { describe, expect, test } from 'bun:test'

import { requireDirectionerBinary } from '../utils'

describe('Directioner: --help flag', () => {
  test('shows CLI usage information', () => {
    const binary = requireDirectionerBinary()
    const output = execFileSync(binary, ['--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    })

    // Should show the binary name
    expect(output.toLowerCase()).toContain('directioner')

    // Should show usage info
    expect(output).toMatch(/usage|options|commands/i)
  })

  test('does not reference Beyonders', () => {
    const binary = requireDirectionerBinary()
    const output = execFileSync(binary, ['--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    })

    // The --help output should say Directioner, not Beyonders
    expect(output).not.toMatch(/\bbeyonders\b/i)
  })
})
