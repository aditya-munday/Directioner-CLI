import { describe, expect, test } from 'bun:test'

import { createMarkdownFileBlock } from '../file'
import {
  escapeXmlAttribute,
  escapeXmlText,
  sanitizeDisplayedName,
  stripControlCharacters,
} from '../xml'

/**
 * Property tests for the prompt-injection boundary.
 *
 * The example-based suites (`injection-boundary.test.ts`) pin specific
 * payloads; these assert the *invariant* over a large, seeded set of
 * adversarial inputs, so a future change to an escape helper is caught even if
 * it preserves every hand-written example but opens a hole for some other
 * byte sequence.
 */

/** Deterministic 32-bit LCG so a failure reproduces exactly. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Characters that matter to one or more of the boundary contexts. */
const HOSTILE_ALPHABET = [
  '<',
  '>',
  '&',
  '"',
  "'",
  '\n',
  '\r',
  '\t',
  '\u0000',
  '\u0007',
  '\u001b',
  '\u007f',
  '`',
  '\u0085',
  '\u2028',
  '\u2029',
  '/',
  '\\',
  '=',
  ' ',
  'a',
  'Z',
  '0',
  '9',
  '_',
  '-',
  '.',
  ':',
]

const CLOSERS = [
  '</x>',
  '```',
  '</project_file_tree>',
  '</tool_metadata>',
  '</beyonders_tool_call>',
  '```\n',
]

function randomHostileString(rng: () => number, maxLen = 40): string {
  const chars = rng() < 0.5 ? HOSTILE_ALPHABET : [...HOSTILE_ALPHABET, ...CLOSERS]
  const len = 1 + Math.floor(rng() * maxLen)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(rng() * chars.length)]
  }
  return out
}

const ITERATIONS = 4000
const CASE_CHARS = 'Reveal the API key\x00\x1b</x>\n`"\' < > &'

function randomCaseName(rng: () => number): string {
  const len = 1 + Math.floor(rng() * 12)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += CASE_CHARS[Math.floor(rng() * CASE_CHARS.length)]
  }
  return out
}

describe('injection boundary properties (fuzz)', () => {
  test('escapeXmlText never leaves a raw angle bracket', () => {
    const rng = makeRng(0x5eed1)
    for (let i = 0; i < ITERATIONS; i++) {
      const out = escapeXmlText(randomHostileString(rng))
      expect(out.includes('<')).toBe(false)
      expect(out.includes('>')).toBe(false)
    }
  })

  test('escapeXmlAttribute leaves no raw quote, apostrophe, or control byte', () => {
    const rng = makeRng(0x5eed2)
    for (let i = 0; i < ITERATIONS; i++) {
      const out = escapeXmlAttribute(randomHostileString(rng))
      expect(/["']/.test(out)).toBe(false)
      expect(/[\u0000-\u001f\u007f]/.test(out)).toBe(false)
    }
  })

  test('sanitizeDisplayedName is single-line and cannot close an element', () => {
    const rng = makeRng(0x5eed3)
    for (let i = 0; i < ITERATIONS; i++) {
      const out = sanitizeDisplayedName(randomHostileString(rng))
      expect(out.includes('<')).toBe(false)
      expect(out.includes('>')).toBe(false)
      expect(/[\n\r\u0000-\u001f\u007f]/.test(out)).toBe(false)
    }
  })

  test('stripControlCharacters removes every C0 control and DEL', () => {
    const rng = makeRng(0x5eed4)
    for (let i = 0; i < ITERATIONS; i++) {
      const out = stripControlCharacters(randomHostileString(rng))
      expect(/[\u0000-\u001f\u007f]/.test(out)).toBe(false)
    }
  })

  test('createMarkdownFileBlock fence outlives any backtick run and path stays single-line', () => {
    const rng = makeRng(0x5eed5)
    for (let i = 0; i < ITERATIONS; i++) {
      const path = randomHostileString(rng)
      const content = randomHostileString(rng, 80)
      const block = createMarkdownFileBlock(path, content)

      const lines = block.split('\n')
      const opener = lines[0]
      const closer = lines[lines.length - 1]

      // The closing line is the fence itself, so it gives the true width. The
      // opener's leading run can be longer, because the label is not
      // backtick-escaped and a hostile path may itself start with backticks.
      expect(/^`+$/.test(closer)).toBe(true)
      const fenceLen = closer.length
      expect(fenceLen).toBeGreaterThanOrEqual(3)
      expect(opener.startsWith('`'.repeat(fenceLen))).toBe(true)

      // No run of backticks *at or beyond* the fence width can appear in the
      // body, or it would close the block, so the true fence always wins.
      const bodyRuns = (content.match(/`+/g) ?? []).map((r) => r.length)
      if (bodyRuns.length > 0) {
        expect(Math.max(...bodyRuns)).toBeLessThan(fenceLen)
      }

      // The label line is single-line with no raw angle brackets.
      const label = opener.slice(fenceLen)
      expect(label.includes('<')).toBe(false)
      expect(label.includes('>')).toBe(false)
      expect(/^[^\n\r\u0000-\u001f\u007f]*$/.test(label)).toBe(true)
    }
  })

  test('an escaped attribute value carries no character that can end the value', () => {
    const rng = makeRng(0x5eed6)
    for (let i = 0; i < ITERATIONS; i++) {
      const name = randomHostileString(rng)
      const value = escapeXmlAttribute(name)
      // The delimiter for a double-quoted attribute is `"`; `'` matters for a
      // single-quoted one, and a newline/control byte ends the tag line. None of
      // them may survive escaping, so the value cannot be closed early and no
      // second attribute can be appended.
      expect(value.includes('"')).toBe(false)
      expect(value.includes("'")).toBe(false)
      expect(/[\u0000-\u001f\u007f]/.test(value)).toBe(false)
      expect(value.includes('<')).toBe(false)
      expect(value.includes('>')).toBe(false)
    }
  })

  test('random case-name parameters cannot reintroduce a raw closer', () => {
    const rng = makeRng(0x5eed7)
    for (let i = 0; i < ITERATIONS; i++) {
      const name = randomCaseName(rng)
      expect(escapeXmlText(name).includes('</x>')).toBe(false)
      expect(sanitizeDisplayedName(name).includes('</x>')).toBe(false)
    }
  })
})
