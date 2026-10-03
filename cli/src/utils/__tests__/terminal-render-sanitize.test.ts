import { describe, expect, it } from 'bun:test'

import { sanitizePreview } from '../../components/blocks/block-helpers'
import { formatToolOutput } from '../beyonders-client'

/**
 * Terminal-rendering hardening for tool output.
 *
 * Tool output is untrusted: a command's stdout, a file's contents, or a diff
 * can contain escape sequences. OpenTUI writes text bytes to the terminal
 * without interpreting them, so the sanitizer has to run before the text is
 * handed to the renderer. These tests pin that the CLI-side formatters strip
 * the bytes a terminal would act on.
 */
describe('formatToolOutput terminal safety', () => {
  it('strips an OSC title sequence from a string result', () => {
    const out = formatToolOutput('safe\x1b]0;pwned\x07after')
    expect(out).toBe('safeafter')
  })

  it('strips CSI and CR from a string result', () => {
    expect(formatToolOutput('\x1b[2Jcleared')).toBe('cleared')
    expect(formatToolOutput('visible\rSPOOF')).toBe('visibleSPOOF')
  })

  it('strips escapes that arrive through the json branch', () => {
    const out = formatToolOutput([
      { type: 'json', value: { errorMessage: 'boom\x1b]0;pwned\x07' } },
    ])
    expect(out).toBe('boom')
  })

  it('strips escapes from text parts', () => {
    const out = formatToolOutput([
      { type: 'text', text: 'line\x1b[31mred\x1b[0m' },
    ])
    expect(out).toBe('linered')
  })

  it('leaves ordinary multi-line output intact', () => {
    expect(formatToolOutput('a\tb\nc')).toBe('a\tb\nc')
  })

  it('returns empty for empty input', () => {
    expect(formatToolOutput(null)).toBe('')
    expect(formatToolOutput(undefined)).toBe('')
  })
})

describe('sanitizePreview terminal safety', () => {
  it('strips escape sequences before previewing a tool result line', () => {
    expect(sanitizePreview('\x1b]0;pwned\x07file.ts')).toBe('file.ts')
  })

  it('still strips markdown punctuation', () => {
    expect(sanitizePreview('**bold** `code`')).toBe('bold code')
  })

  it('drops carriage return so a preview cannot overwrite its line', () => {
    expect(sanitizePreview('safe\rSPOOF')).toBe('safeSPOOF')
  })
})
