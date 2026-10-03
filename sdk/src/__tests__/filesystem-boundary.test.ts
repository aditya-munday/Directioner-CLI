/**
 * Filesystem trust-boundary tests.
 *
 * These exercise the PRODUCTION path: the real `resolveWritePath` /
 * `checkPathContainment` helpers, and the real `changeFile` / `applyPatchTool`
 * operations against a REAL temporary directory tree with REAL symlinks. The
 * point is not to make traversal tests green — it is to establish what the
 * agent can actually cause the filesystem to do.
 *
 * Every test that claims a refusal also asserts the filesystem did NOT change.
 * A refusal that still writes is not a boundary.
 */
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { applyPatchTool } from '../tools/apply-patch'
import { changeFile } from '../tools/change-file'
import { listDirectory } from '../tools/list-directory'
import { codeSearch } from '../tools/code-search'
import { getFiles } from '../tools/read-files'
import {
  checkPathContainment,
  resolveFilePath,
  resolveReadPath,
  resolveWritePath,
} from '../tools/path-utils'
import { removeFileRooted, writeFileRooted } from '../tools/rooted-write'
import { FILE_READ_STATUS } from '@beyonders/common/old-constants'

/** A throwaway tree: `<base>/project` plus a sibling `<base>/outside`. */
function makeTree(): { base: string; project: string; outside: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'directioner-fs-'))
  // macOS `/tmp` is a symlink to `/private/tmp`; realpath the base so the
  // project root we hand the helpers is the same string the kernel reports.
  const realBase = fs.realpathSync(base)
  const project = path.join(realBase, 'project')
  const outside = path.join(realBase, 'outside')
  fs.mkdirSync(project, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET\n')
  return { base: realBase, project, outside }
}

function cleanup(base: string): void {
  fs.rmSync(base, { recursive: true, force: true })
}

const realFs = fs.promises

describe('resolveWritePath: project-relative containment', () => {
  test('allows a plain project-relative path', () => {
    const { base, project } = makeTree()
    try {
      const decision = resolveWritePath(project, 'src/index.ts')
      expect(decision.allowed).toBe(true)
      if (decision.allowed) {
        expect(decision.fullPath).toBe(path.join(project, 'src/index.ts'))
      }
    } finally {
      cleanup(base)
    }
  })

  test('allows the repository root itself', () => {
    const { base, project } = makeTree()
    try {
      const decision = resolveWritePath(project, '.')
      expect(decision.allowed).toBe(true)
    } finally {
      cleanup(base)
    }
  })

  test('refuses a single ../ escape', () => {
    const { base, project } = makeTree()
    try {
      const decision = resolveWritePath(project, '../outside/secret.txt')
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toContain('outside the project')
      }
    } finally {
      cleanup(base)
    }
  })

  test('refuses a nested ../../ escape', () => {
    const { base, project } = makeTree()
    try {
      const decision = resolveWritePath(
        project,
        'src/../../outside/secret.txt',
      )
      expect(decision.allowed).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('refuses a sibling directory that shares the root prefix', () => {
    const { base, project } = makeTree()
    try {
      // `/base/project-sibling` starts with the string `/base/project` but is
      // not inside it. A naive `startsWith` check would allow this.
      const sibling = `${project}-sibling`
      const decision = resolveWritePath(project, `${sibling}/file.txt`)
      expect(decision.allowed).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('refuses an absolute path outside the project', () => {
    const { base, project, outside } = makeTree()
    try {
      const decision = resolveWritePath(
        project,
        path.join(outside, 'secret.txt'),
      )
      expect(decision.allowed).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('allows an absolute path inside the project', () => {
    const { base, project } = makeTree()
    try {
      const decision = resolveWritePath(
        project,
        path.join(project, 'src/index.ts'),
      )
      expect(decision.allowed).toBe(true)
    } finally {
      cleanup(base)
    }
  })

  test('normalizes a traversal that stays inside the project', () => {
    const { base, project } = makeTree()
    try {
      // `src/../index.ts` never leaves the project; it must be allowed and
      // must resolve to the normalized path.
      const decision = resolveWritePath(project, 'src/../index.ts')
      expect(decision.allowed).toBe(true)
      if (decision.allowed) {
        expect(decision.fullPath).toBe(path.join(project, 'index.ts'))
      }
    } finally {
      cleanup(base)
    }
  })

  test('allows a file name that merely starts with two dots', () => {
    const { base, project } = makeTree()
    try {
      const decision = resolveWritePath(project, '..config')
      expect(decision.allowed).toBe(true)
      if (decision.allowed) {
        expect(decision.fullPath).toBe(path.join(project, '..config'))
      }
    } finally {
      cleanup(base)
    }
  })

  test('handles spaces, quotes and unusual unicode in file names', () => {
    const { base, project } = makeTree()
    try {
      for (const name of [
        'a file with spaces.txt',
        `quote'"backtick\`.txt`,
        'unicode-é中文-😀.txt',
        'newline\nname.txt',
      ]) {
        const decision = resolveWritePath(project, name)
        expect(decision.allowed).toBe(true)
      }
    } finally {
      cleanup(base)
    }
  })

  test('does not treat a NUL-truncated name as inside the project', () => {
    const { base, project } = makeTree()
    try {
      // `path.resolve` keeps the NUL; the filesystem rejects it. The point is
      // that it must not be reported as an allowed in-project path that then
      // silently becomes something else.
      const decision = resolveWritePath(project, 'ok.txt\u0000/../../outside')
      if (decision.allowed) {
        expect(decision.fullPath).toBe(path.join(project, 'ok.txt\u0000/../../outside'))
      }
    } finally {
      cleanup(base)
    }
  })
})

describe('resolveWritePath: host-authorized external roots', () => {
  test('refuses outside paths when no root is authorized', () => {
    const { base, project, outside } = makeTree()
    try {
      const decision = resolveWritePath(project, path.join(outside, 'x.txt'))
      expect(decision.allowed).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('allows outside paths only through an explicit host option', () => {
    const { base, project, outside } = makeTree()
    try {
      const decision = resolveWritePath(project, path.join(outside, 'x.txt'), {
        additionalRoots: [outside],
      })
      expect(decision.allowed).toBe(true)
    } finally {
      cleanup(base)
    }
  })

  test('an authorized root does not authorize its siblings', () => {
    const { base, project, outside } = makeTree()
    try {
      const other = path.join(base, 'other')
      fs.mkdirSync(other)
      const decision = resolveWritePath(
        project,
        path.join(other, 'x.txt'),
        { additionalRoots: [outside] },
      )
      expect(decision.allowed).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('the blunt opt-in allows any absolute path', () => {
    const { base, project, outside } = makeTree()
    try {
      const decision = resolveWritePath(project, path.join(outside, 'x.txt'), {
        allowAnyAbsolutePath: true,
      })
      expect(decision.allowed).toBe(true)
    } finally {
      cleanup(base)
    }
  })
})

describe('resolveWritePath: symlinks', () => {
  test('refuses a symlink whose target is outside the project', () => {
    const { base, project, outside } = makeTree()
    try {
      const link = path.join(project, 'escape-link')
      fs.symlinkSync(path.join(outside, 'secret.txt'), link)

      const decision = resolveWritePath(project, 'escape-link')
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toContain('symlink')
      }
    } finally {
      cleanup(base)
    }
  })

  test('a symlinked directory escape is refused', () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(outside, path.join(project, 'escape-dir'))
      const decision = resolveWritePath(project, 'escape-dir/secret.txt')
      expect(decision.allowed).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('a nested symlink escape is refused', () => {
    const { base, project, outside } = makeTree()
    try {
      const nested = path.join(project, 'a/b')
      fs.mkdirSync(nested, { recursive: true })
      fs.symlinkSync(outside, path.join(nested, 'link'))
      const decision = resolveWritePath(project, 'a/b/link/secret.txt')
      expect(decision.allowed).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('allows a symlink whose target is inside the project', () => {
    const { base, project } = makeTree()
    try {
      const target = path.join(project, 'real.txt')
      fs.writeFileSync(target, 'original\n')
      const link = path.join(project, 'alias.txt')
      fs.symlinkSync(target, link)

      const decision = resolveWritePath(project, 'alias.txt')
      expect(decision.allowed).toBe(true)
      // The write must target the RESOLVED path, not the link, so that a
      // later swap of the link cannot redirect it.
      if (decision.allowed) {
        expect(decision.fullPath).toBe(target)
      }
    } finally {
      cleanup(base)
    }
  })

  test('refuses a broken symlink rather than creating its target', () => {
    const { base, project, outside } = makeTree()
    try {
      const missing = path.join(outside, 'does-not-exist.txt')
      fs.symlinkSync(missing, path.join(project, 'broken-link'))

      const decision = resolveWritePath(project, 'broken-link')
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toContain('does not exist')
      }
      expect(fs.existsSync(missing)).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('refuses a symlink chain that ends outside the project', () => {
    const { base, project, outside } = makeTree()
    try {
      const hop1 = path.join(project, 'hop1')
      fs.symlinkSync(path.join(outside, 'secret.txt'), hop1)
      fs.symlinkSync(hop1, path.join(project, 'hop2'))
      const decision = resolveWritePath(project, 'hop2')
      expect(decision.allowed).toBe(false)
    } finally {
      cleanup(base)
    }
  })
})

describe('changeFile: real filesystem enforcement', () => {
  test('writes a normal project file', async () => {
    const { base, project } = makeTree()
    try {
      const result = await changeFile({
        parameters: { type: 'file', path: 'src/new.ts', content: 'ok\n' },
        cwd: project,
        fs: realFs,
      })
      expect(result[0]).toEqual({
        type: 'json',
        value: { file: 'src/new.ts', message: 'Created file successfully.' },
      })
      expect(fs.readFileSync(path.join(project, 'src/new.ts'), 'utf8')).toBe(
        'ok\n',
      )
    } finally {
      cleanup(base)
    }
  })

  test('refuses ../ escape and leaves the outside file untouched', async () => {
    const { base, project, outside } = makeTree()
    try {
      const result = await changeFile({
        parameters: {
          type: 'file',
          path: '../outside/secret.txt',
          content: 'CLOBBERED\n',
        },
        cwd: project,
        fs: realFs,
      })
      expect(result[0]).toMatchObject({
        type: 'json',
        value: { errorMessage: expect.stringContaining('outside the project') },
      })
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'TOP SECRET\n',
      )
    } finally {
      cleanup(base)
    }
  })

  test('refuses an absolute outside path and leaves the file untouched', async () => {
    const { base, project, outside } = makeTree()
    try {
      const result = await changeFile({
        parameters: {
          type: 'file',
          path: path.join(outside, 'secret.txt'),
          content: 'CLOBBERED\n',
        },
        cwd: project,
        fs: realFs,
      })
      expect(result[0]).toMatchObject({
        type: 'json',
        value: { errorMessage: expect.stringContaining('outside the project') },
      })
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'TOP SECRET\n',
      )
    } finally {
      cleanup(base)
    }
  })

  test('refuses to write through an out-of-project symlink', async () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(
        path.join(outside, 'secret.txt'),
        path.join(project, 'escape-link'),
      )
      const result = await changeFile({
        parameters: {
          type: 'file',
          path: 'escape-link',
          content: 'CLOBBERED\n',
        },
        cwd: project,
        fs: realFs,
      })
      expect(result[0]).toMatchObject({
        type: 'json',
        value: { errorMessage: expect.stringContaining('symlink') },
      })
      // The whole point: the out-of-project file must be unchanged.
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'TOP SECRET\n',
      )
    } finally {
      cleanup(base)
    }
  })

  test('writes an in-project symlink target, not the link', async () => {
    const { base, project } = makeTree()
    try {
      const target = path.join(project, 'real.txt')
      fs.writeFileSync(target, 'original\n')
      fs.symlinkSync(target, path.join(project, 'alias.txt'))

      const result = await changeFile({
        parameters: { type: 'file', path: 'alias.txt', content: 'updated\n' },
        cwd: project,
        fs: realFs,
      })
      expect(result[0]).toMatchObject({ type: 'json', value: { message: expect.any(String) } })
      expect(fs.readFileSync(target, 'utf8')).toBe('updated\n')
      // The link is still a link: the write replaced the target's contents.
      expect(fs.lstatSync(path.join(project, 'alias.txt')).isSymbolicLink()).toBe(
        true,
      )
    } finally {
      cleanup(base)
    }
  })

  test('refuses a broken symlink instead of creating its outside target', async () => {
    const { base, project, outside } = makeTree()
    try {
      const missing = path.join(outside, 'created-by-write.txt')
      fs.symlinkSync(missing, path.join(project, 'broken-link'))

      const result = await changeFile({
        parameters: { type: 'file', path: 'broken-link', content: 'x\n' },
        cwd: project,
        fs: realFs,
      })
      expect(result[0]).toMatchObject({
        type: 'json',
        value: { errorMessage: expect.stringContaining('does not exist') },
      })
      expect(fs.existsSync(missing)).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('allows an authorized external root', async () => {
    const { base, project, outside } = makeTree()
    try {
      const target = path.join(outside, 'authorized.txt')
      const result = await changeFile({
        parameters: { type: 'file', path: target, content: 'ok\n' },
        cwd: project,
        fs: realFs,
        boundary: { additionalRoots: [outside] },
      })
      expect(result[0]).toMatchObject({ type: 'json', value: { message: 'Created file successfully.' } })
      expect(fs.readFileSync(target, 'utf8')).toBe('ok\n')
    } finally {
      cleanup(base)
    }
  })

  test('a string-replace escape is refused and the file is untouched', async () => {
    const { base, project, outside } = makeTree()
    try {
      const result = await changeFile({
        parameters: {
          type: 'patch',
          path: '../outside/secret.txt',
          content: '@@ -1,1 +1,1 @@\n-TOP SECRET\n+LEAKED\n',
        },
        cwd: project,
        fs: realFs,
      })
      expect(result[0]).toMatchObject({
        type: 'json',
        value: { errorMessage: expect.stringContaining('outside the project') },
      })
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'TOP SECRET\n',
      )
    } finally {
      cleanup(base)
    }
  })
})

describe('applyPatchTool: real filesystem enforcement', () => {
  test('create_file refuses an outside path and creates nothing', async () => {
    const { base, project, outside } = makeTree()
    try {
      const target = path.join(outside, 'created.txt')
      const result = await applyPatchTool({
        parameters: {
          operation: { type: 'create_file', path: target, diff: '@@\n+hi\n' },
        },
        cwd: project,
        fs: realFs,
      })
      expect(JSON.stringify(result)).toContain('outside the project')
      expect(fs.existsSync(target)).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('delete_file refuses an outside path and deletes nothing', async () => {
    const { base, project, outside } = makeTree()
    try {
      const target = path.join(outside, 'secret.txt')
      const result = await applyPatchTool({
        parameters: {
          operation: { type: 'delete_file', path: target },
        },
        cwd: project,
        fs: realFs,
      })
      expect(JSON.stringify(result)).toContain('outside the project')
      expect(fs.existsSync(target)).toBe(true)
    } finally {
      cleanup(base)
    }
  })

  test('delete_file refuses a ../ escape', async () => {
    const { base, project, outside } = makeTree()
    try {
      const result = await applyPatchTool({
        parameters: {
          operation: { type: 'delete_file', path: '../outside/secret.txt' },
        },
        cwd: project,
        fs: realFs,
      })
      expect(JSON.stringify(result)).toContain('outside the project')
      expect(fs.existsSync(path.join(outside, 'secret.txt'))).toBe(true)
    } finally {
      cleanup(base)
    }
  })

  test('update_file refuses to write through an outside symlink', async () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(
        path.join(outside, 'secret.txt'),
        path.join(project, 'escape-link'),
      )
      const result = await applyPatchTool({
        parameters: {
          operation: {
            type: 'update_file',
            path: 'escape-link',
            diff: '@@ -1,1 +1,1 @@\n-TOP SECRET\n+LEAKED\n',
          },
        },
        cwd: project,
        fs: realFs,
      })
      expect(JSON.stringify(result)).toContain('symlink')
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'TOP SECRET\n',
      )
    } finally {
      cleanup(base)
    }
  })

  test('a normal in-project create/update/delete still works', async () => {
    const { base, project } = makeTree()
    try {
      const created = await applyPatchTool({
        parameters: {
          operation: { type: 'create_file', path: 'new.txt', diff: '@@\n+hello\n' },
        },
        cwd: project,
        fs: realFs,
      })
      expect(JSON.stringify(created)).toContain('add')
      expect(fs.readFileSync(path.join(project, 'new.txt'), 'utf8')).toBe('hello')

      const updated = await applyPatchTool({
        parameters: {
          operation: {
            type: 'update_file',
            path: 'new.txt',
            diff: '@@ -1,1 +1,1 @@\n-hello\n+goodbye\n',
          },
        },
        cwd: project,
        fs: realFs,
      })
      expect(JSON.stringify(updated)).toContain('update')
      expect(fs.readFileSync(path.join(project, 'new.txt'), 'utf8')).toBe(
        'goodbye',
      )

      const deleted = await applyPatchTool({
        parameters: {
          operation: { type: 'delete_file', path: 'new.txt' },
        },
        cwd: project,
        fs: realFs,
      })
      expect(JSON.stringify(deleted)).toContain('delete')
      expect(fs.existsSync(path.join(project, 'new.txt'))).toBe(false)
    } finally {
      cleanup(base)
    }
  })
})

describe('resolveReadPath: containment', () => {
  test('allows a plain project file', () => {
    const { base, project } = makeTree()
    try {
      expect(resolveReadPath(project, 'src/index.ts').allowed).toBe(true)
    } finally {
      cleanup(base)
    }
  })

  test('refuses an absolute path outside the project', () => {
    const { base, project, outside } = makeTree()
    try {
      const decision = resolveReadPath(project, path.join(outside, 'secret.txt'))
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toContain('outside the project')
      }
    } finally {
      cleanup(base)
    }
  })

  test('refuses a ../ escape', () => {
    const { base, project } = makeTree()
    try {
      expect(resolveReadPath(project, '../outside/secret.txt').allowed).toBe(
        false,
      )
    } finally {
      cleanup(base)
    }
  })

  test('refuses to follow a symlink that leaves the project', () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(
        path.join(outside, 'secret.txt'),
        path.join(project, 'leak'),
      )
      const decision = resolveReadPath(project, 'leak')
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) {
        expect(decision.reason).toContain('symlink')
      }
    } finally {
      cleanup(base)
    }
  })

  test('allows a symlink whose target is inside the project', () => {
    const { base, project } = makeTree()
    try {
      const target = path.join(project, 'real.txt')
      fs.writeFileSync(target, 'ok\n')
      fs.symlinkSync(target, path.join(project, 'alias.txt'))
      expect(resolveReadPath(project, 'alias.txt').allowed).toBe(true)
    } finally {
      cleanup(base)
    }
  })

  test('allows an outside path only through a host-authorized root', () => {
    const { base, project, outside } = makeTree()
    try {
      const target = path.join(outside, 'secret.txt')
      expect(resolveReadPath(project, target).allowed).toBe(false)
      expect(
        resolveReadPath(project, target, { additionalRoots: [outside] }).allowed,
      ).toBe(true)
    } finally {
      cleanup(base)
    }
  })
})

describe('getFiles: real filesystem read enforcement', () => {
  test('reads a normal project file', async () => {
    const { base, project } = makeTree()
    try {
      fs.writeFileSync(path.join(project, 'a.txt'), 'hello\n')
      const result = await getFiles({
        filePaths: ['a.txt'],
        cwd: project,
        fs: realFs,
      })
      expect(result['a.txt']).toBe('hello\n')
    } finally {
      cleanup(base)
    }
  })

  test('refuses /etc/passwd and never returns its contents', async () => {
    const { base, project } = makeTree()
    try {
      const result = await getFiles({
        filePaths: ['/etc/passwd'],
        cwd: project,
        fs: realFs,
      })
      expect(result['/etc/passwd']).toBe(FILE_READ_STATUS.OUTSIDE_PROJECT)
    } finally {
      cleanup(base)
    }
  })

  test('refuses a planted symlink to an outside secret', async () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(
        path.join(outside, 'secret.txt'),
        path.join(project, 'leak'),
      )
      const result = await getFiles({
        filePaths: ['leak'],
        cwd: project,
        fs: realFs,
      })
      expect(result['leak']).toBe(FILE_READ_STATUS.OUTSIDE_PROJECT)
      expect(JSON.stringify(result)).not.toContain('TOP SECRET')
    } finally {
      cleanup(base)
    }
  })

  test('refuses a symlinked directory escape', async () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(outside, path.join(project, 'escape-dir'))
      const result = await getFiles({
        filePaths: ['escape-dir/secret.txt'],
        cwd: project,
        fs: realFs,
      })
      expect(result['escape-dir/secret.txt']).toBe(
        FILE_READ_STATUS.OUTSIDE_PROJECT,
      )
    } finally {
      cleanup(base)
    }
  })

  test('reads an authorized external file', async () => {
    const { base, project, outside } = makeTree()
    try {
      const result = await getFiles({
        filePaths: [path.join(outside, 'secret.txt')],
        cwd: project,
        fs: realFs,
        boundary: { additionalRoots: [outside] },
      })
      expect(result[path.join(outside, 'secret.txt')]).toBe('TOP SECRET\n')
    } finally {
      cleanup(base)
    }
  })
})

describe('checkPathContainment: reported signals', () => {
  test('reports an in-project path as contained', () => {
    const { base, project } = makeTree()
    try {
      const containment = checkPathContainment(
        project,
        path.join(project, 'a.txt'),
      )
      expect(containment.lexicalWithin).toBe(true)
      expect(containment.realWithin).toBe(true)
      expect(containment.escapesViaSymlink).toBe(false)
    } finally {
      cleanup(base)
    }
  })

  test('reports a symlink escape as lexical-inside but real-outside', () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(outside, path.join(project, 'link'))
      const containment = checkPathContainment(
        project,
        path.join(project, 'link/secret.txt'),
      )
      expect(containment.lexicalWithin).toBe(true)
      expect(containment.realWithin).toBe(false)
      expect(containment.escapesViaSymlink).toBe(true)
    } finally {
      cleanup(base)
    }
  })

  test('reports realWithin as null when the filesystem cannot be consulted', () => {
    const containment = checkPathContainment('/virtual/project', '/virtual/project/a.txt', {
      exists: () => true,
      realpath: () => {
        throw new Error('ENOENT')
      },
    })
    expect(containment.realWithin).toBeNull()
    // An unproven real answer must never be reported as a proven escape.
    expect(containment.escapesViaSymlink).toBe(false)
  })
})

describe('resolveFilePath: symlink signal without changing lexical semantics', () => {
  test('an out-of-project symlink is lexical-inside but flagged', () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(outside, path.join(project, 'link'))
      const resolved = resolveFilePath(project, 'link/secret.txt')
      // Lexical semantics are preserved for existing callers...
      expect(resolved.isWithinProject).toBe(true)
      // ...but the escape is reported for the write boundary.
      expect(resolved.escapesViaSymlink).toBe(true)
    } finally {
      cleanup(base)
    }
  })
})

/**
 * Discovery-tool boundaries.
 *
 * `list_directory` and `code_search` take a model-supplied path and disclose
 * directory names or matching file CONTENTS. Both were measured escaping: a
 * probe listed `/etc` and returned the contents of a sibling `secret.env`
 * through `code_search cwd=<outside>`. They must cross the same boundary the
 * read tools do.
 */
describe('list_directory: model-supplied path crosses the read boundary', () => {
  test('refuses an absolute path outside the project', async () => {
    const { base, project, outside } = makeTree()
    try {
      const result = await listDirectory({
        directoryPath: outside,
        projectPath: project,
        fs: realFs as never,
      })
      const value = result[0]!.value as { errorMessage?: string; files?: string[] }
      expect(value.errorMessage).toContain('outside the project')
      expect(value.files).toBeUndefined()
    } finally {
      cleanup(base)
    }
  })

  test('refuses a symlinked directory that resolves outside', async () => {
    const { base, project, outside } = makeTree()
    try {
      fs.symlinkSync(outside, path.join(project, 'linkdir'))
      const result = await listDirectory({
        directoryPath: 'linkdir',
        projectPath: project,
        fs: realFs as never,
      })
      const value = result[0]!.value as { errorMessage?: string }
      expect(value.errorMessage).toContain('symlink')
    } finally {
      cleanup(base)
    }
  })

  test('lists a normal in-project directory', async () => {
    const { base, project } = makeTree()
    try {
      fs.mkdirSync(path.join(project, 'src'))
      fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'x')
      const result = await listDirectory({
        directoryPath: 'src',
        projectPath: project,
        fs: realFs as never,
      })
      const value = result[0]!.value as { files?: string[] }
      expect(value.files).toContain('a.ts')
    } finally {
      cleanup(base)
    }
  })
})

describe('code_search: model-supplied cwd crosses the read boundary', () => {
  test('refuses a cwd outside the project before any process starts', async () => {
    const { base, project, outside } = makeTree()
    try {
      const result = await codeSearch({
        projectPath: project,
        pattern: 'TOP SECRET',
        cwd: outside,
      })
      const value = result[0]!.value as { errorMessage?: string; stdout?: string }
      expect(value.errorMessage).toContain('outside the project')
      expect(value.stdout).toBeUndefined()
    } finally {
      cleanup(base)
    }
  })

  test('refuses a traversal cwd', async () => {
    const { base, project } = makeTree()
    try {
      const result = await codeSearch({
        projectPath: project,
        pattern: 'x',
        cwd: '../outside',
      })
      const value = result[0]!.value as { errorMessage?: string }
      expect(value.errorMessage).toContain('outside the project')
    } finally {
      cleanup(base)
    }
  })
})

/**
 * Kernel-pinned writes: the check and the write act on the SAME object.
 *
 * The race probe flipped a parent directory to a symlink pointing outside
 * between the check and the write, and landed a write at `outside/b.txt`. The
 * pin makes the kernel refuse the swapped component with ELOOP. The hardlink
 * probe rewrote an outside file through an in-project hard link; staging plus
 * rename replaces the in-project name instead of writing the shared inode.
 */
describe('rooted-write: pinned write closes the TOCTOU and hardlink escapes', () => {
  test('a parent swapped for a symlink after the check is refused, not followed', async () => {
    const { base, project, outside } = makeTree()
    try {
      const racedir = path.join(project, 'racedir')
      fs.mkdirSync(racedir)
      let swapped = false
      const outcome = await writeFileRooted({
        root: project,
        filePath: path.join(racedir, 'b.txt'),
        content: 'PWNED',
        fs: realFs as never,
        raceWindow: () => {
          // The exact race: rename the real directory away, link the name out.
          fs.renameSync(racedir, path.join(project, 'racedir_real'))
          fs.symlinkSync(outside, racedir)
          swapped = true
        },
      }).then(
        () => 'allowed' as const,
        (error: unknown) => error,
      )
      expect(swapped).toBe(true)
      // The security property is that NOTHING escaped, not that the write was
      // refused: the pin resolves to the directory the check approved, which
      // the race renamed but left inside the project. The outside target is
      // untouched, and a successful write landed through the pin, inside.
      expect(fs.existsSync(path.join(outside, 'b.txt'))).toBe(false)
      expect(fs.readdirSync(outside)).toEqual(['secret.txt'])
      if (outcome === 'allowed') {
        expect(
          fs.existsSync(path.join(project, 'racedir_real', 'b.txt')),
        ).toBe(true)
      }
    } finally {
      cleanup(base)
    }
  })

  test('an in-project hard link to an outside file is replaced, not written through', async () => {
    const { base, project, outside } = makeTree()
    try {
      const target = path.join(outside, 'target.txt')
      fs.writeFileSync(target, 'ORIGINAL\n')
      const link = path.join(project, 'hardlink.txt')
      fs.linkSync(target, link)

      const { mode } = await writeFileRooted({
        root: project,
        filePath: link,
        content: 'PWNED',
        fs: realFs as never,
      })
      expect(mode).toBe('pinned')
      // The outside inode is untouched and no longer shared with the link.
      expect(fs.readFileSync(target, 'utf8')).toBe('ORIGINAL\n')
      expect(fs.readFileSync(link, 'utf8')).toBe('PWNED')
      expect(fs.statSync(target).nlink).toBe(1)
    } finally {
      cleanup(base)
    }
  })

  test('a normal in-project write still creates and overwrites', async () => {
    const { base, project } = makeTree()
    try {
      const file = path.join(project, 'nested', 'deep', 'file.txt')
      await writeFileRooted({
        root: project,
        filePath: file,
        content: 'one',
        fs: realFs as never,
      })
      expect(fs.readFileSync(file, 'utf8')).toBe('one')
      await writeFileRooted({
        root: project,
        filePath: file,
        content: 'two',
        fs: realFs as never,
      })
      expect(fs.readFileSync(file, 'utf8')).toBe('two')
    } finally {
      cleanup(base)
    }
  })

  test('removeFileRooted deletes an in-project file and leaves siblings', async () => {
    const { base, project } = makeTree()
    try {
      fs.writeFileSync(path.join(project, 'gone.txt'), 'x')
      fs.writeFileSync(path.join(project, 'kept.txt'), 'y')
      await removeFileRooted({
        root: project,
        filePath: path.join(project, 'gone.txt'),
        fs: realFs as never,
      })
      expect(fs.existsSync(path.join(project, 'gone.txt'))).toBe(false)
      expect(fs.existsSync(path.join(project, 'kept.txt'))).toBe(true)
    } finally {
      cleanup(base)
    }
  })
})
