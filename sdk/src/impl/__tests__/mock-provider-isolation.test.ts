/**
 * Guard: the mock-provider helper is test-only.
 *
 * The mock transport must never be reachable from production source. This
 * would not fail a type check (it is a normal module), so it needs an explicit
 * source scan the way the platform contract's reference transport does.
 */

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..')
const MOCK_NAME = 'mock-provider'

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

function isTestFile(file: string): boolean {
  return (
    /__tests__|\.test\.tsx?$/.test(file) ||
    file.includes('/testing/') ||
    file.endsWith('.integration.test.ts')
  )
}

describe('mock-provider isolation', () => {
  test('no production source imports the mock provider', () => {
    const roots = [
      join(REPO_ROOT, 'cli', 'src'),
      join(REPO_ROOT, 'sdk', 'src'),
      join(REPO_ROOT, 'common', 'src'),
      join(REPO_ROOT, 'packages'),
    ]
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of walk(root)) {
        if (isTestFile(file)) continue
        const text = readFileSync(file, 'utf8')
        if (new RegExp(`from ['"][^'"]*${MOCK_NAME}['"]`).test(text)) {
          offenders.push(file)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
