import { describe, expect, it } from 'bun:test'

import { defaultCodeSearchFlagsRefusal } from '../tools/code-search-flags'

/**
 * `code_search` passes the model's `flags` string to ripgrep. Ripgrep is not a
 * pure reader — `--pre` runs a program, `-L/--follow` follows a symlink out of
 * the search root, `--config`/`--ignore-file` load an arbitrary file. These
 * tests pin the allowlist that refuses those before any process exists.
 */

describe('code search flag allowlist', () => {
  describe('execution and escape flags are refused', () => {
    // Every one of these has an observed effect against the bundled ripgrep:
    // `--pre` executed a script, `-L` returned a symlinked file's contents.
    const dangerous: Array<[string, string]> = [
      ['pre-processor (executes a program)', '--pre /bin/sh'],
      ['pre-processor glob', '--pre-glob *.ts'],
      ['follow symlinks (short)', '-L'],
      ['follow symlinks (long)', '--follow'],
      ['config file', '--config /tmp/evilrc'],
      ['config file (= form)', '--config=/tmp/evilrc'],
      ['ignore file', '--ignore-file /tmp/evil'],
      ['ignore file (= form)', '--ignore-file=/tmp/evil'],
      ['dash-dash separator', '--'],
      ['unknown flag', '--frobnicate'],
      ['unknown short flag', '-Z'],
    ]

    for (const [name, flags] of dangerous) {
      it(`refuses ${name}: ${flags}`, () => {
        const refusal = defaultCodeSearchFlagsRefusal(flags)
        expect(refusal).not.toBeNull()
      })
    }

    it('names the offending flag in the refusal', () => {
      expect(defaultCodeSearchFlagsRefusal('--pre /bin/sh')).toContain('--pre')
      expect(defaultCodeSearchFlagsRefusal('-L')).toContain('-L')
      expect(defaultCodeSearchFlagsRefusal('--follow')).toContain('--follow')
    })

    it('refuses a dangerous flag hidden after an allowed one', () => {
      expect(defaultCodeSearchFlagsRefusal('-i --pre /bin/sh')).not.toBeNull()
      expect(defaultCodeSearchFlagsRefusal('-g *.ts -L')).not.toBeNull()
    })
  })

  describe('ordinary flags are permitted', () => {
    const allowed = [
      '-i',
      '-i -t ts -t js',
      '-g *.ts -g *.js',
      '-g !*.test.ts',
      '-A 3',
      '-B 2',
      '-C 2',
      '-A3',
      '-m1',
      '-v',
      '-c -l',
      '--glob=*.ts',
      '--type=ts',
      '--type-not=py',
      '--max-count=5',
      '-w -F',
      undefined,
      '',
      '   ',
    ]

    for (const flags of allowed) {
      it(`allows ${JSON.stringify(flags)}`, () => {
        expect(defaultCodeSearchFlagsRefusal(flags)).toBeNull()
      })
    }

    it('allows a glob with a leading negation bang', () => {
      expect(defaultCodeSearchFlagsRefusal('-g !*.test.ts')).toBeNull()
    })
  })

  describe('malformed flags are refused', () => {
    it('refuses an unterminated quote', () => {
      expect(defaultCodeSearchFlagsRefusal('-g "*.ts')).not.toBeNull()
    })

    it('refuses a value-taking flag with no value', () => {
      expect(defaultCodeSearchFlagsRefusal('-g')).not.toBeNull()
      expect(defaultCodeSearchFlagsRefusal('--type')).not.toBeNull()
      expect(defaultCodeSearchFlagsRefusal('-A')).not.toBeNull()
    })

    it('refuses a non-numeric context value', () => {
      expect(defaultCodeSearchFlagsRefusal('-A nope')).not.toBeNull()
      expect(defaultCodeSearchFlagsRefusal('-C2x')).not.toBeNull()
    })

    it('refuses an invalid type name', () => {
      expect(defaultCodeSearchFlagsRefusal('-t "bad name"')).not.toBeNull()
    })
  })
})
