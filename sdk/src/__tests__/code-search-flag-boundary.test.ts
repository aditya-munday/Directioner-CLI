import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { codeSearch } from '../tools/code-search'


/**
 * End-to-end containment for `code_search`, driven through the real bundled
 * ripgrep and a real planted symlink.
 *
 * Before the flag allowlist, `code_search { pattern, flags: '-L' }` followed a
 * symlink inside the project (`sneaky.txt -> ../outside.txt`) and returned the
 * target's CONTENTS — a read of a file outside the project that `read_files`
 * refuses. `--pre <script>` executed the script on every file. Both are refused
 * now, before any ripgrep process exists.
 *
 * These tests use the real filesystem and the real binary; no mocks. They are
 * deterministic: the symlink and its target are created in a temp dir and
 * removed in `afterAll`.
 */

let root: string
let project: string

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-search-boundary-'))
  project = path.join(root, 'project')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'inside.ts'), 'const INSIDE_MARKER = 1\n')
  // A file outside the project, and a symlink to it from inside the project.
  fs.writeFileSync(
    path.join(root, 'outside.txt'),
    'PLANTED_OUTSIDE_SECRET_MARKER\n',
  )
  fs.symlinkSync(
    path.join(root, 'outside.txt'),
    path.join(project, 'sneaky.txt'),
  )
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('code_search flag boundary (real ripgrep)', () => {
  it('refuses --follow and does not leak the symlink target', async () => {
    const result = await codeSearch({
      projectPath: project,
      pattern: 'PLANTED_OUTSIDE_SECRET_MARKER',
      flags: '-L',

    })
    const value = result[0]!.value as Record<string, unknown>
    expect(typeof value.errorMessage).toBe('string')
    expect(JSON.stringify(value)).not.toContain('PLANTED_OUTSIDE_SECRET_MARKER')
  })

  it('refuses --pre (a program ripgrep would execute)', async () => {
    const result = await codeSearch({
      projectPath: project,
      pattern: 'INSIDE_MARKER',
      flags: `--pre /bin/sh`,

    })
    const value = result[0]!.value as Record<string, unknown>
    expect(typeof value.errorMessage).toBe('string')
  })

  it('a default search never reads through the symlink', async () => {
    const result = await codeSearch({
      projectPath: project,
      pattern: 'PLANTED_OUTSIDE_SECRET_MARKER',

    })
    const value = result[0]!.value as Record<string, unknown>
    // The outside marker is never returned, with or without flags.
    expect(JSON.stringify(value)).not.toContain('PLANTED_OUTSIDE_SECRET_MARKER')
  })

  it('an ordinary search still finds an in-project file', async () => {
    const result = await codeSearch({
      projectPath: project,
      pattern: 'INSIDE_MARKER',

    })
    const value = result[0]!.value as Record<string, unknown>
    expect(JSON.stringify(value)).toContain('INSIDE_MARKER')
  })
})
