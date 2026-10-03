import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DIRECTIONER_AI_TRAINING_NOTICE,
  DIRECTIONER_DATA_USE_GENERATED_MARKDOWN_BLOCK,
  DIRECTIONER_DATA_USE_GENERATED_MDX_BLOCK,
  DIRECTIONER_POLICY_METADATA,
  DIRECTIONER_PUBLIC_DATA_USE_COPY,
  renderDirectionerDataUseFaqMarkdown,
  renderDirectionerDataUseFaqMdx,
} from '../constants/directioner-data-use'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8')
}

function generatedBlock(
  source: string,
  markers: { start: string; end: string },
): string {
  const start = source.indexOf(markers.start)
  const end = source.indexOf(markers.end, start)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  return source.slice(start, end + markers.end.length)
}

describe('public Directioner data-use copy', () => {
  test('the September 2 legal metadata stays aligned', () => {
    expect(DIRECTIONER_POLICY_METADATA).toEqual({
      version: '2026-09-02',
      effectiveDate: 'September 2, 2026',
      codebaseEvaluationNarrowedDate: 'September 25, 2026',
      lastUpdated: '09/25/2026',
      privacyPolicyLastUpdated: '09/25/2026',
    })
    expect(DIRECTIONER_AI_TRAINING_NOTICE).toBe('May use data for AI training')
    expect(DIRECTIONER_PUBLIC_DATA_USE_COPY.storageAnswer).not.toContain(
      'Starting ',
    )
  })

  test.each([
    [
      'README.md',
      DIRECTIONER_DATA_USE_GENERATED_MARKDOWN_BLOCK,
      renderDirectionerDataUseFaqMarkdown(),
    ],
    [
      'directioner/cli/release/README.md',
      DIRECTIONER_DATA_USE_GENERATED_MARKDOWN_BLOCK,
      renderDirectionerDataUseFaqMarkdown(),
    ],
    [
      'web/src/content/advanced/privacy.mdx',
      DIRECTIONER_DATA_USE_GENERATED_MDX_BLOCK,
      renderDirectionerDataUseFaqMdx(),
    ],
    [
      'web/src/content/help/faq.mdx',
      DIRECTIONER_DATA_USE_GENERATED_MDX_BLOCK,
      renderDirectionerDataUseFaqMdx(),
    ],
  ] as const)('%s matches canonical generated copy', (path, markers, copy) => {
    expect(generatedBlock(readRepoFile(path), markers)).toBe(copy)
  })

  test('landing-lab uses the canonical data-use FAQ', () => {
    expect(readRepoFile('landing-lab/src/components/sections/Faq.tsx'))
      .toContain(`    q: '${DIRECTIONER_PUBLIC_DATA_USE_COPY.storageQuestion}',
    a: '${DIRECTIONER_PUBLIC_DATA_USE_COPY.storageAnswer}',`)
  })
})
