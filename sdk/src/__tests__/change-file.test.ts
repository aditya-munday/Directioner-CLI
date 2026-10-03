import { describe, expect, test } from 'bun:test'

import type { Stats } from 'node:fs'

import { createMockFs } from '@beyonders/common/testing/mocks/filesystem'

import { changeFile } from '../tools/change-file'

describe('changeFile', () => {
  test('returns a simple success message for string replacements', async () => {
    const fs = createMockFs({
      files: {
        '/repo/src/file.ts': 'const value = 1\n',
      },
    })

    const result = await changeFile({
      parameters: {
        type: 'patch',
        path: 'src/file.ts',
        content: '@@ -1,1 +1,1 @@\n-const value = 1\n+const value = 2\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result).toEqual([
      {
        type: 'json',
        value: {
          file: 'src/file.ts',
          message: 'String replace applied successfully.',
        },
      },
    ])
    expect(await fs.readFile('/repo/src/file.ts', 'utf-8')).toBe(
      'const value = 2\n',
    )
  })

  test('tolerates absolute paths inside the project for string replacements', async () => {
    const fs = createMockFs({
      files: {
        '/repo/src/file.ts': 'const value = 1\n',
      },
    })

    const result = await changeFile({
      parameters: {
        type: 'patch',
        path: '/repo/src/file.ts',
        content: '@@ -1,1 +1,1 @@\n-const value = 1\n+const value = 2\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result).toEqual([
      {
        type: 'json',
        value: {
          file: 'src/file.ts',
          message: 'String replace applied successfully.',
        },
      },
    ])
    expect(await fs.readFile('/repo/src/file.ts', 'utf-8')).toBe(
      'const value = 2\n',
    )
  })

  test('returns a simple success message for new file writes', async () => {
    const fs = createMockFs()

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: 'src/file.ts',
        content: 'const value = 1\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result).toEqual([
      {
        type: 'json',
        value: {
          file: 'src/file.ts',
          message: 'Created file successfully.',
        },
      },
    ])
    expect(await fs.readFile('/repo/src/file.ts', 'utf-8')).toBe(
      'const value = 1\n',
    )
  })

  test('does not recreate an existing parent directory', async () => {
    const fs = createMockFs({
      directories: { '/repo/src': [] },
      mkdirImpl: async () => {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      },
    })

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: 'src/file.ts',
        content: 'const value = 1\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result[0]?.value).toMatchObject({
      message: 'Created file successfully.',
    })
    expect(fs.mkdir).not.toHaveBeenCalled()
  })

  test('recovers when mkdir reports EEXIST before the parent becomes visible', async () => {
    let parentChecks = 0
    const fs = createMockFs({
      statImpl: async (path) => {
        if (path !== '/repo/src' || ++parentChecks < 3)
          throw new Error('not visible yet')
        return { isDirectory: () => true } as Stats
      },
      mkdirImpl: async () => {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      },
    })

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: 'src/file.ts',
        content: 'const value = 1\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result[0]?.value).toMatchObject({
      message: 'Created file successfully.',
    })
    expect(fs.mkdir).toHaveBeenCalledTimes(1)
  })

  test('tolerates absolute paths inside the project for file writes', async () => {
    const fs = createMockFs()

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: '/repo/src/file.ts',
        content: 'const value = 1\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result).toEqual([
      {
        type: 'json',
        value: {
          file: 'src/file.ts',
          message: 'Created file successfully.',
        },
      },
    ])
    expect(await fs.readFile('/repo/src/file.ts', 'utf-8')).toBe(
      'const value = 1\n',
    )
  })

  test('accepts paths whose file names start with two dots inside the project', async () => {
    const fs = createMockFs()

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: '/repo/..config',
        content: 'value = true\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result).toEqual([
      {
        type: 'json',
        value: {
          file: '..config',
          message: 'Created file successfully.',
        },
      },
    ])
    expect(await fs.readFile('/repo/..config', 'utf-8')).toBe('value = true\n')
  })

  test('returns a simple success message for overwritten file writes', async () => {
    const fs = createMockFs({
      files: {
        '/repo/src/file.ts': 'const value = 1\n',
      },
    })

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: 'src/file.ts',
        content: 'const value = 2\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result).toEqual([
      {
        type: 'json',
        value: {
          file: 'src/file.ts',
          message: 'Overwrote file successfully.',
        },
      },
    ])
    expect(await fs.readFile('/repo/src/file.ts', 'utf-8')).toBe(
      'const value = 2\n',
    )
  })

  test('refuses absolute paths outside the project by default', async () => {
    const fs = createMockFs()

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: '/outside/file.ts',
        content: 'const value = 1\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result).toEqual([
      {
        type: 'json',
        value: {
          file: '/outside/file.ts',
          errorMessage: expect.stringContaining('outside the project'),
        },
      },
    ])
    // The file must NOT have been created: refusal is not advisory.
    await expect(fs.readFile('/outside/file.ts', 'utf-8')).rejects.toThrow()
  })

  test('allows an outside path only when the host authorizes the root', async () => {
    const fs = createMockFs()

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: '/outside/file.ts',
        content: 'const value = 1\n',
      },
      cwd: '/repo',
      fs,
      boundary: { additionalRoots: ['/outside'] },
    })

    expect(result).toEqual([
      {
        type: 'json',
        value: {
          file: '/outside/file.ts',
          message: 'Created file successfully.',
        },
      },
    ])
    expect(await fs.readFile('/outside/file.ts', 'utf-8')).toBe(
      'const value = 1\n',
    )
  })

  test('a model-supplied path cannot authorize itself', async () => {
    const fs = createMockFs()

    // The path looks like it is naming an authorized root, but authorization
    // comes from the host options, never from the argument's text.
    const result = await changeFile({
      parameters: {
        type: 'file',
        path: '/etc/authorized-by-me/passwd',
        content: 'x\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result[0]).toEqual({
      type: 'json',
      value: {
        file: '/etc/authorized-by-me/passwd',
        errorMessage: expect.stringContaining('outside the project'),
      },
    })
    await expect(
      fs.readFile('/etc/authorized-by-me/passwd', 'utf-8'),
    ).rejects.toThrow()
  })

  test('refuses a relative escape that leaves the project', async () => {
    const fs = createMockFs()

    const result = await changeFile({
      parameters: {
        type: 'file',
        path: '../important-file',
        content: 'x\n',
      },
      cwd: '/repo',
      fs,
    })

    expect(result[0]).toEqual({
      type: 'json',
      value: {
        file: '/important-file',
        errorMessage: expect.stringContaining('outside the project'),
      },
    })
    await expect(fs.readFile('/important-file', 'utf-8')).rejects.toThrow()
  })
})
