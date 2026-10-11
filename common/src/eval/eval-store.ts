/**
 * Local storage for evaluation artifacts.
 *
 * The only part of the eval module that touches the filesystem, kept separate
 * from the schema so the format stays pure and testable. Two invariants:
 *
 *   - **Redacted then validated before writing.** A credential cannot reach
 *     disk by being embedded in an artifact, and a dishonest artifact (a score
 *     attributed to a mock) cannot be written at all.
 *   - **Atomic write.** Write to a temp file in the same directory, then
 *     rename. A crash mid-write leaves the previous artifact, never a truncated
 *     one that later fails to parse.
 *
 * Files are plain JSON under whatever directory the caller names. Nothing is
 * uploaded; a caller that shares an artifact does so deliberately.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  type EvalArtifact,
  EVAL_ARTIFACT_SCHEMA,
  parseEvalArtifact,
  redactEvalArtifact,
  validateEvalArtifact,
} from './eval-artifact'

/** Write an artifact to `path` as redacted, validated, pretty JSON. */
export function writeEvalArtifact(path: string, artifact: EvalArtifact): void {
  const redacted = redactEvalArtifact(artifact)
  const issues = validateEvalArtifact(redacted)
  if (issues.length > 0) {
    throw new Error(
      `Refusing to write an invalid eval artifact:\n${issues
        .map((i) => `  ${i.path}: ${i.message}`)
        .join('\n')}`,
    )
  }
  mkdirSync(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  writeFileSync(temp, JSON.stringify(redacted, null, 2) + '\n', { mode: 0o600 })
  renameSync(temp, path)
}

/** Read and validate an artifact from `path`. Throws on malformed or dishonest input. */
export function readEvalArtifact(path: string): EvalArtifact {
  return parseEvalArtifact(readFileSync(path, 'utf8'))
}

/**
 * A stable file name for an artifact. Uses the provider, model, and a
 * filesystem-safe timestamp — no user data, no key material.
 */
export function evalArtifactFileName(run: {
  provider: string
  model: string
  startedAt: string
}): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60)
  const stamp = run.startedAt.replace(/[:.]/g, '-')
  return `${safe(run.provider)}-${safe(run.model)}-${stamp}.${EVAL_ARTIFACT_SCHEMA.split('/')[1]}.json`
}
