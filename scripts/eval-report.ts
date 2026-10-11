#!/usr/bin/env bun

/**
 * Inspect and compare Directioner evaluation artifacts.
 *
 * A thin CLI over `common/src/eval`. It validates on read, so a malformed or
 * dishonest artifact (a score attributed to a mock provider) is refused rather
 * than printed as if it meant something.
 *
 * Usage:
 *   bun scripts/eval-report.ts show run.json
 *   bun scripts/eval-report.ts compare baseline.json candidate.json
 */

import { compareEvalArtifacts, claimsAgentQuality } from '../common/src/eval/eval-artifact'
import { readEvalArtifact } from '../common/src/eval/eval-store'

function usage(): never {
  console.error(
    'Usage:\n  bun scripts/eval-report.ts show <artifact.json>\n  bun scripts/eval-report.ts compare <baseline.json> <candidate.json>',
  )
  process.exit(2)
}

function pct(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`
}

function num(value: number | undefined, digits = 3): string {
  return value === undefined ? 'n/a' : value.toFixed(digits)
}

function show(path: string): void {
  const artifact = readEvalArtifact(path)
  console.log(`Artifact: ${path}`)
  if (artifact.note) console.log(`Note: ${artifact.note}`)
  console.log(
    `Claims agent quality: ${claimsAgentQuality(artifact) ? 'YES' : 'NO (mock/loopback or unscored)'}`,
  )
  for (const run of artifact.runs) {
    const scored = run.results.filter((r) => r.score !== undefined)
    const mean =
      scored.length > 0
        ? scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length
        : undefined
    console.log(
      `\n  provider=${run.provider} (${run.providerKind}) model=${run.model} rev=${run.revision}`,
    )
    console.log(
      `  tasks=${run.results.length} scored=${scored.length} meanScore=${num(mean)}`,
    )
    const failures = run.results.filter((r) => r.outcome === 'errored' || r.outcome === 'failed')
    for (const result of failures.slice(0, 20)) {
      console.log(
        `    - ${result.taskId}: ${result.outcome}${result.errorClass ? ` (${result.errorClass})` : ''}`,
      )
    }
  }
}

function compare(basePath: string, candidatePath: string): void {
  const comparison = compareEvalArtifacts(readEvalArtifact(basePath), readEvalArtifact(candidatePath))
  console.log(`Baseline:  ${basePath}`)
  console.log(`Candidate: ${candidatePath}`)
  console.log(`\nScore mean:   base ${num(comparison.baseScoreMean)} -> candidate ${num(comparison.candidateScoreMean)} (delta ${num(comparison.scoreMeanDelta)})`)
  console.log(`Pass rate:    base ${pct(comparison.basePassRate)} -> candidate ${pct(comparison.candidatePassRate)}`)
  const changed = comparison.perTask.filter((t) => t.outcomeChanged)
  console.log(`\nOutcome changes (${changed.length} of ${comparison.perTask.length} shared tasks):`)
  for (const task of changed) {
    console.log(`  ${task.taskId}: ${task.base?.outcome} -> ${task.candidate?.outcome}`)
  }
  if (comparison.onlyInBase.length > 0)
    console.log(`\nOnly in baseline (excluded from deltas): ${comparison.onlyInBase.join(', ')}`)
  if (comparison.onlyInCandidate.length > 0)
    console.log(`Only in candidate (excluded from deltas): ${comparison.onlyInCandidate.join(', ')}`)
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2)
  try {
    if (command === 'show' && rest[0]) show(rest[0])
    else if (command === 'compare' && rest[0] && rest[1]) compare(rest[0], rest[1])
    else usage()
  } catch (error) {
    // A refused artifact is a normal outcome, not a crash: report it plainly.
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
