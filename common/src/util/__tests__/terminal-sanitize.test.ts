import { describe, expect, it } from 'bun:test'

import { sanitizeForTerminalDisplay, stripAnsi } from '../string'

/**
 * Terminal-output rendering hardening.
 *
 * OpenTUI does not interpret escape sequences in text content: it copies the
 * bytes into its buffer, so any escape a tool emits (a file read, a command's
 * stderr, a diff) can reach the user's terminal. These tests pin the two
 * filters that stand between untrusted text and the terminal.
 */
describe('stripAnsi', () => {
  it('removes CSI sequences (cursor moves, erase, colors)', () => {
    expect(stripAnsi('\x1b[2Jclear')).toBe('clear')
    expect(stripAnsi('\x1b[10;20Hspoof')).toBe('spoof')
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red')
    expect(stripAnsi('\x1b[2Kline')).toBe('line')
  })

  it('removes OSC sequences terminated by BEL', () => {
    expect(stripAnsi('\x1b]0;pwned\x07safe')).toBe('safe')
    expect(stripAnsi('\x1b]52;c;aGVsbG8=\x07safe')).toBe('safe')
  })

  it('removes OSC sequences terminated by ST', () => {
    expect(stripAnsi('\x1b]0;pwned\x1b\\safe')).toBe('safe')
    expect(stripAnsi('\x1b]52;c;aGVsbG8=\x1b\\safe')).toBe('safe')
  })

  it('removes DCS, SOS, PM and APC string sequences', () => {
    expect(stripAnsi('\x1bPq#0;2;0;0;0\x1b\\safe')).toBe('safe')
    expect(stripAnsi('\x1bXpayload\x1b\\safe')).toBe('safe')
    expect(stripAnsi('\x1b^payload\x1b\\safe')).toBe('safe')
    expect(stripAnsi('\x1b_payload\x1b\\safe')).toBe('safe')
  })

  it('removes two-byte escape sequences', () => {
    expect(stripAnsi('\x1bcsafe')).toBe('safe')
    expect(stripAnsi('\x1b(Bsafe')).toBe('safe')
  })

  it('keeps carriage return and backspace (model-facing path is lossless)', () => {
    // The model-facing filter must not silently rewrite ordinary output; CR and
    // BS are only dangerous when the text is rendered, which is what
    // sanitizeForTerminalDisplay is for.
    expect(stripAnsi('a\rb')).toBe('a\rb')
    expect(stripAnsi('a\b\bb')).toBe('a\b\bb')
  })

  it('leaves ordinary text untouched', () => {
    expect(stripAnsi('hello\tworld\n')).toBe('hello\tworld\n')
  })
})

describe('sanitizeForTerminalDisplay', () => {
  const hostile =
    'safe\x1b[2J\x1b[10;1HSPOOF\x1b]0;pwned\x07mid\x1b]52;c;aGVsbG8=\x1b\\end\rOVERWRITE\x08\x08\x08back\x07bell'

  it('neutralizes every terminal-driving byte in a hostile payload', () => {
    const out = sanitizeForTerminalDisplay(hostile)
    expect(out).not.toContain('\x1b')
    expect(out).not.toContain('\r')
    expect(out).not.toContain('\b')
    expect(out).not.toContain('\x07')
  })

  it('preserves visible text so output stays readable', () => {
    expect(sanitizeForTerminalDisplay(hostile)).toBe(
      'safeSPOOFmidendOVERWRITEbackbell',
    )
  })

  it('keeps tab and newline as layout', () => {
    expect(sanitizeForTerminalDisplay('a\tb\nc')).toBe('a\tb\nc')
  })

  it('strips other C0 controls and DEL', () => {
    expect(sanitizeForTerminalDisplay('a\x00\x01\x0b\x1f\x7fb')).toBe('ab')
  })

  it('is idempotent', () => {
    const once = sanitizeForTerminalDisplay(hostile)
    expect(sanitizeForTerminalDisplay(once)).toBe(once)
  })

  it('cannot be used to forge a title even when the OSC is unterminated', () => {
    // The old regex dropped only the introducer, leaving "0;pwned" visible.
    expect(sanitizeForTerminalDisplay('\x1b]0;pwned')).toBe('0;pwned')
    // With a terminator the whole sequence, payload included, is gone.
    expect(sanitizeForTerminalDisplay('\x1b]0;pwned\x07')).toBe('')
  })
})
