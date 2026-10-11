import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type EvalArtifact,
  EVAL_ARTIFACT_SCHEMA,
  assertValidEvalArtifact,
  claimsAgentQuality,
  compareEvalArtifacts,
  parseEvalArtifact,
  redactEvalArtifact,
  redactEvalText,
  validateEvalArtifact,
} from '../eval-artifact'
import { evalArtifactFileName, readEvalArtifact, writeEvalArtifact } from '../eval-store'

function artifact(overrides: Partial<EvalArtifact> = {}): EvalArtifact {
  return {
    schema: EVAL_ARTIFACT_SCHEMA,
    runs: [
      {
        provider: 'heital',
        providerKind: 'remote',
        model: 'gemini-3.8-flash',
        revision: 'abc123',
        startedAt: '2026-10-10T00:00:00.000Z',
        results: [
          { taskId: 'fix-bug-1', outcome: 'passed', score: 1, durationMs: 1200 },
          { taskId: 'fix-bug-2', outcome: 'failed', score: 0.2, durationMs: 800 },
        ],
      },
    ],
    ...overrides,
  }
}

describe('validateEvalArtifact: shape', () => {
  test('accepts a well-formed artifact', () => {
    expect(validateEvalArtifact(artifact())).toEqual([])
  })

  test('rejects a wrong schema tag', () => {
    const issues = validateEvalArtifact({ ...artifact(), schema: 'something-else' })
    expect(issues.some((i) => i.path === 'schema')).toBe(true)
  })

  test('rejects a score outside 0..1', () => {
    const bad = artifact()
    bad.runs[0].results[0].score = 1.5
    const issues = validateEvalArtifact(bad)
    expect(issues.length).toBeGreaterThan(0)
  })

  test('rejects a negative duration', () => {
    const bad = artifact()
    bad.runs[0].results[0].durationMs = -1
    expect(validateEvalArtifact(bad).length).toBeGreaterThan(0)
  })

  test('rejects an unknown provider kind', () => {
    const bad = artifact() as unknown as { runs: Array<{ providerKind: string }> }
    bad.runs[0].providerKind = 'psychic'
    expect(validateEvalArtifact(bad).length).toBeGreaterThan(0)
  })

  test('rejects a missing required field', () => {
    const bad = artifact() as unknown as { runs: Array<Record<string, unknown>> }
    delete bad.runs[0].model
    expect(validateEvalArtifact(bad).length).toBeGreaterThan(0)
  })
})

describe('validateEvalArtifact: no quality claim from a mock', () => {
  for (const providerKind of ['mock', 'loopback'] as const) {
    test(`rejects a score attributed to a ${providerKind} provider`, () => {
      const bad = artifact()
      bad.runs[0].providerKind = providerKind
      const issues = validateEvalArtifact(bad)
      expect(issues).toHaveLength(2) // both scored tasks
      expect(issues[0].message).toContain(providerKind)
    })

    test(`allows a ${providerKind} run that reports outcomes without scores`, () => {
      const ok = artifact()
      ok.runs[0].providerKind = providerKind
      for (const result of ok.runs[0].results) delete result.score
      expect(validateEvalArtifact(ok)).toEqual([])
    })
  }

  test('a remote run with scores is accepted', () => {
    expect(validateEvalArtifact(artifact())).toEqual([])
  })
})

describe('claimsAgentQuality', () => {
  test('true only for qualifying runs that carry scores', () => {
    expect(claimsAgentQuality(artifact())).toBe(true)
  })

  test('false when a run is a mock, even with scores', () => {
    const mixed = artifact()
    mixed.runs[0].providerKind = 'mock'
    expect(claimsAgentQuality(mixed)).toBe(false)
  })

  test('false when no run carries a score', () => {
    const unscored = artifact()
    for (const result of unscored.runs[0].results) delete result.score
    expect(claimsAgentQuality(unscored)).toBe(false)
  })

  test('false for an empty artifact', () => {
    expect(claimsAgentQuality({ schema: EVAL_ARTIFACT_SCHEMA, runs: [] })).toBe(false)
  })
})

describe('redaction', () => {
  test('removes bearer tokens and provider key shapes', () => {
    const text = redactEvalText(
      'Authorization: Bearer abc123.def456 and key sk-proj-ABCDEFGH12345678 plus gsk_zzzzzzzzzzzzzz',
    )
    expect(text).not.toContain('abc123.def456')
    expect(text).not.toContain('sk-proj-ABCDEFGH12345678')
    expect(text).not.toContain('gsk_zzzzzzzzzzzzzz')
  })

  test('removes anthropic-style keys', () => {
    const text = redactEvalText('key sk-ant-api03-AAAAAAAAAAAAAAAA')
    expect(text).not.toContain('sk-ant-api03-AAAAAAAAAAAAAAAA')
  })

  test('removes emails', () => {
    expect(redactEvalText('contact dev@example.com now')).toBe(
      'contact [redacted-email] now',
    )
  })

  test('removes POSIX and macOS home paths', () => {
    expect(redactEvalText('at /home/alice/project/x.ts')).toBe(
      'at /home/[redacted]/project/x.ts',
    )
    expect(redactEvalText('at /Users/bob/project')).toBe(
      'at /home/[redacted]/project',
    )
  })

  test('removes Windows user profile paths', () => {
    expect(redactEvalText('at C:\\Users\\carol\\project')).toBe(
      'at C:\\Users\\[redacted]\\project',
    )
  })

  test('a key embedded in an artifact note is gone after redactEvalArtifact', () => {
    const dirty = artifact({
      note: 'ran with sk-proj-SECRETSECRET12345 on /home/alice/repo',
    })
    const clean = redactEvalArtifact(dirty)
    expect(clean.note).not.toContain('sk-proj-SECRETSECRET12345')
    expect(clean.note).not.toContain('/home/alice')
  })

  test('a key in an errorClass is removed', () => {
    const dirty = artifact()
    dirty.runs[0].results[0].errorClass = 'ProviderError: invalid key sk-proj-LEAKLEAK12345678'
    const clean = redactEvalArtifact(dirty)
    expect(clean.runs[0].results[0].errorClass).not.toContain('sk-proj-LEAKLEAK12345678')
  })
})

describe('parseEvalArtifact', () => {
  test('round-trips a valid artifact', () => {
    const parsed = parseEvalArtifact(JSON.stringify(artifact()))
    expect(parsed.runs[0].provider).toBe('heital')
  })

  test('throws on invalid JSON with a clear message', () => {
    expect(() => parseEvalArtifact('{not json')).toThrow(/not valid JSON/)
  })

  test('throws on a dishonest artifact', () => {
    const bad = artifact()
    bad.runs[0].providerKind = 'loopback'
    expect(() => parseEvalArtifact(JSON.stringify(bad))).toThrow(/loopback/)
  })
})

describe('compareEvalArtifacts', () => {
  function withResults(
    results: Array<{
      taskId: string
      outcome: 'passed' | 'failed' | 'errored' | 'skipped'
      score?: number
    }>,
  ): EvalArtifact {
    return {
      schema: EVAL_ARTIFACT_SCHEMA,
      runs: [
        {
          provider: 'x',
          providerKind: 'remote',
          model: 'm',
          revision: 'r',
          startedAt: 't',
          results: results.map((r) => ({ ...r, durationMs: 1 })),
        },
      ],
    }
  }

  test('computes per-task deltas and mean change over shared tasks', () => {
    const base = withResults([
      { taskId: 'a', outcome: 'failed', score: 0.2 },
      { taskId: 'b', outcome: 'passed', score: 1 },
    ])
    const candidate = withResults([
      { taskId: 'a', outcome: 'passed', score: 0.9 },
      { taskId: 'b', outcome: 'passed', score: 0.8 },
    ])
    const cmp = compareEvalArtifacts(base, candidate)
    expect(cmp.perTask.map((t) => t.taskId)).toEqual(['a', 'b'])
    expect(cmp.perTask[0].scoreDelta).toBeCloseTo(0.7)
    expect(cmp.perTask[0].outcomeChanged).toBe(true)
    expect(cmp.perTask[1].outcomeChanged).toBe(false)
    expect(cmp.scoreMeanDelta).toBeCloseTo((0.9 + 0.8) / 2 - (0.2 + 1) / 2)
    expect(cmp.basePassRate).toBeCloseTo(0.5)
    expect(cmp.candidatePassRate).toBeCloseTo(1)
  })

  test('reports tasks present on only one side and excludes them from deltas', () => {
    const base = withResults([{ taskId: 'a', outcome: 'passed', score: 1 }])
    const candidate = withResults([
      { taskId: 'a', outcome: 'passed', score: 1 },
      { taskId: 'new', outcome: 'passed', score: 1 },
    ])
    const cmp = compareEvalArtifacts(base, candidate)
    expect(cmp.onlyInCandidate).toEqual(['new'])
    expect(cmp.onlyInBase).toEqual([])
    expect(cmp.scoreMeanDelta).toBe(0)
  })

  test('omits aggregates that cannot be computed', () => {
    const base = withResults([{ taskId: 'a', outcome: 'errored' }])
    const candidate = withResults([{ taskId: 'a', outcome: 'errored' }])
    const cmp = compareEvalArtifacts(base, candidate)
    expect(cmp.baseScoreMean).toBeUndefined()
    expect(cmp.scoreMeanDelta).toBeUndefined()
  })
})

describe('eval store', () => {
  test('writes, redacts, and reads back atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-store-'))
    try {
      const path = join(dir, 'run.json')
      writeEvalArtifact(
        path,
        artifact({ note: 'used sk-proj-WRITELEAK12345678 in /home/alice/x' }),
      )
      const raw = readFileSync(path, 'utf8')
      expect(raw).not.toContain('sk-proj-WRITELEAK12345678')
      expect(raw).not.toContain('/home/alice')
      const read = readEvalArtifact(path)
      expect(read.runs[0].results).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses to write a dishonest artifact (mock with a score)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-store-'))
    try {
      const bad = artifact()
      bad.runs[0].providerKind = 'mock'
      expect(() => writeEvalArtifact(join(dir, 'bad.json'), bad)).toThrow(/mock/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('artifact file name is filesystem-safe and carries no user data', () => {
    const name = evalArtifactFileName({
      provider: 'heital',
      model: 'gemini/3.8 flash', // slash and space are unsafe
      startedAt: '2026-10-10T12:00:00.000Z',
    })
    expect(name).not.toContain('/')
    expect(name).not.toContain(' ')
    expect(name.endsWith('.v1.json')).toBe(true)
  })

  test('assertValidEvalArtifact throws with the offending path', () => {
    const bad = artifact()
    bad.runs[0].providerKind = 'loopback'
    expect(() => assertValidEvalArtifact(bad)).toThrow(/runs\.0\.results\.0\.score/)
  })
})
