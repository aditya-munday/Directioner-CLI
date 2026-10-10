#!/usr/bin/env bun

/**
 * Local performance benchmark harness for Directioner hot paths.
 *
 * Why a script rather than a `bun test` benchmark: perf numbers are only
 * comparable when the method is stated. This prints the median of N measured
 * runs after a warmup, on a named machine, and can save a baseline and fail a
 * later run that regresses beyond a threshold. Adding a benchmark is adding a
 * row to `BENCHMARKS`; the stats, JSON shape, and gate are shared.
 *
 * It measures LOCAL code only — request-body shaping, run-state compaction,
 * credential redaction. It never opens a socket and never needs a provider key,
 * so it runs on a clean checkout in CI.
 *
 * Usage:
 *   bun scripts/bench-directioner.ts                     # human-readable table
 *   bun scripts/bench-directioner.ts --json              # machine-readable
 *   bun scripts/bench-directioner.ts --save baseline.json
 *   bun scripts/bench-directioner.ts --baseline baseline.json --threshold 0.25
 *
 * The threshold is a fraction (0.25 = fail if a benchmark is >25% slower than
 * baseline). It is intentionally generous: shared CI runners are noisy, and a
 * gate that trips on noise gets ignored, which is worse than no gate.
 */

import { readFileSync, writeFileSync } from 'node:fs'

import { getInitialSessionState } from '@beyonders/common/types/session-state'
import { getStubProjectFileContext } from '@beyonders/common/util/file'

import { backfillDeepSeekReasoning, byokRequestTransform } from '../sdk/src/impl/byok-request'
import { compactRunState } from '../sdk/src/compact-run-state'
import { redactProviderStream } from '../sdk/src/impl/model-provider'
import { percentile } from '../common/src/util/perf-metrics'

import type { ResolvedByokConnection } from '../sdk/src/byok'
import type { RunState } from '../sdk/src/run-state'
import type { Message } from '@beyonders/common/types/messages/beyonders-message'

interface Benchmark {
  name: string
  /** Runs per measured pass. Sized so one pass is ~1-10ms. */
  iterations: number
  setup?: () => void
  run: () => void | Promise<void>
}

interface BenchmarkResult {
  name: string
  iterations: number
  /** Median of measured passes, milliseconds per iteration. */
  msPerOp: number
  p50Ms: number
  p95Ms: number
  samples: number[]
}

interface BenchmarkArtifact {
  schema: 'directioner-perf/v1'
  recordedAt: string
  runtime: string
  platform: string
  results: BenchmarkResult[]
}

const WARMUP_PASSES = 3
const MEASURED_PASSES = 15

/** A representative BYOK connection for the request-shaping benchmarks. */
const CONNECTION: ResolvedByokConnection = {
  id: '00000000-0000-4000-8000-000000000000',
  revision: 1,
  name: 'bench',
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1/',
  model: 'gpt-5.6-luna',
  apiKey: 'bench-key-not-a-real-secret',
  credentialRef: 'env:BENCH_KEY',
  createdAt: 'x',
  updatedAt: 'x',
}

/** A DeepSeek-shaped tool loop: assistant tool calls after the last user turn. */
function deepSeekMessages(count: number): unknown[] {
  const messages: unknown[] = [{ role: 'user', content: 'start' }]
  for (let i = 0; i < count; i++) {
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: `call_${i}`, type: 'function', function: { name: 'read_files', arguments: '{}' } }],
    })
    messages.push({ role: 'tool', tool_call_id: `call_${i}`, content: 'ok' })
  }
  messages.push({ role: 'user', content: 'continue' })
  return messages
}

function runStateMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: [{ type: 'text' as const, text: `message ${i} ${'x'.repeat(64)}` }],
  })) as Message[]
}

/** A realistic stored run with a long, compactable history. */
function runStateWith(messageHistory: Message[]): RunState {
  const sessionState = getInitialSessionState(getStubProjectFileContext())
  sessionState.mainAgentState.messageHistory = messageHistory
  sessionState.mainAgentState.systemPrompt = 'You are a coding agent. '.repeat(50)
  sessionState.mainAgentState.toolDefinitions = {
    read_files: { description: 'Read files', inputSchema: {} },
  }
  return {
    sessionState,
    output: { type: 'lastMessage', value: [] },
    traceSessionId: 'bench',
    inference: { source: 'beyonders' },
  } as RunState
}

let COMPACT_RUN_STATE: RunState

function makeRedactionStream(bytes: number): ReadableStream<Uint8Array> {
  const payload = new TextEncoder().encode('y'.repeat(bytes))
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload)
      controller.close()
    },
  })
}

const BENCHMARKS: Benchmark[] = [
  {
    name: 'byok.requestTransform.gpt5-luna',
    iterations: 2000,
    run() {
      const transform = byokRequestTransform(CONNECTION)
      transform({
        model: 'gpt-5.6-luna',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'hi' }],
      })
    },
  },
  {
    name: 'byok.backfillDeepSeek.replay.100',
    iterations: 2000,
    run() {
      backfillDeepSeekReasoning(deepSeekMessages(100))
    },
  },
  {
    name: 'compactRunState.200',
    iterations: 500,
    setup() {
      COMPACT_RUN_STATE = runStateWith(runStateMessages(200))
    },
    run() {
      // Budget below the history size so the pass does real work rather than
      // returning null early.
      compactRunState({ runState: COMPACT_RUN_STATE, maxContextLength: 2_000 })
    },
  },
  {
    name: 'redact.64KiB',
    iterations: 500,
    async run() {
      const stream = redactProviderStream(
        makeRedactionStream(64 * 1024),
        'bench-key-not-a-real-secret',
      )
      const reader = stream?.getReader()
      if (!reader) return
      for (;;) {
        const { done } = await reader.read()
        if (done) break
      }
    },
  },
]

async function measure(benchmark: Benchmark): Promise<BenchmarkResult> {
  benchmark.setup?.()
  for (let i = 0; i < WARMUP_PASSES; i++) {
    for (let j = 0; j < benchmark.iterations; j++) await benchmark.run()
  }
  const samples: number[] = []
  for (let pass = 0; pass < MEASURED_PASSES; pass++) {
    const start = performance.now()
    for (let j = 0; j < benchmark.iterations; j++) await benchmark.run()
    samples.push((performance.now() - start) / benchmark.iterations)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const medianMs = percentile(sorted, 0.5)
  return {
    name: benchmark.name,
    iterations: benchmark.iterations,
    msPerOp: medianMs,
    p50Ms: medianMs,
    p95Ms: percentile(sorted, 0.95),
    samples: samples.map((s) => Number(s.toFixed(6))),
  }
}

function parseArgs(argv: string[]): {
  json: boolean
  save?: string
  baseline?: string
  threshold: number
} {
  const args = { json: false, save: undefined as string | undefined, baseline: undefined as string | undefined, threshold: 0.25 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') args.json = true
    else if (arg === '--save') args.save = argv[++i]
    else if (arg === '--baseline') args.baseline = argv[++i]
    else if (arg === '--threshold') args.threshold = Number(argv[++i])
  }
  return args
}

function compare(artifact: BenchmarkArtifact, baselinePath: string, threshold: number): string[] {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as BenchmarkArtifact
  if (baseline.schema !== artifact.schema) {
    console.error(`Baseline schema ${baseline.schema} != ${artifact.schema}; cannot compare.`)
    process.exit(2)
  }
  const baseByName = new Map(baseline.results.map((r) => [r.name, r.msPerOp]))
  const regressions: string[] = []
  for (const result of artifact.results) {
    const base = baseByName.get(result.name)
    if (base === undefined) {
      console.log(`~ ${result.name}: no baseline entry, skipped`)
      continue
    }
    const ratio = (result.msPerOp - base) / base
    const verdict = ratio > threshold ? 'REGRESSION' : ratio > threshold / 2 ? 'warn' : 'ok'
    console.log(
      `${verdict.padEnd(10)} ${result.name}: ${(result.msPerOp * 1000).toFixed(2)}µs vs ${(base * 1000).toFixed(2)}µs (${(ratio * 100).toFixed(1)}%)`,
    )
    if (ratio > threshold) regressions.push(result.name)
  }
  return regressions
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const results: BenchmarkResult[] = []
  for (const benchmark of BENCHMARKS) results.push(await measure(benchmark))
  const artifact: BenchmarkArtifact = {
    schema: 'directioner-perf/v1',
    recordedAt: new Date().toISOString(),
    runtime: `bun ${process.versions.bun ?? 'unknown'}`,
    platform: `${process.platform}-${process.arch}`,
    results,
  }

  if (args.json) {
    console.log(JSON.stringify(artifact, null, 2))
  } else {
    console.log(`Directioner benchmark (${artifact.runtime}, ${artifact.platform})`)
    for (const result of results) {
      console.log(
        `  ${result.name.padEnd(36)} ${(result.msPerOp * 1000).toFixed(2).padStart(9)}µs/op  p95 ${(result.p95Ms * 1000).toFixed(2)}µs`,
      )
    }
  }

  if (args.save) {
    writeFileSync(args.save, JSON.stringify(artifact, null, 2) + '\n')
    console.log(`\nSaved baseline to ${args.save}`)
  }

  if (args.baseline) {
    const regressions = compare(artifact, args.baseline, args.threshold)
    if (regressions.length > 0) {
      console.error(`\n${regressions.length} benchmark(s) regressed beyond ${(args.threshold * 100).toFixed(0)}%: ${regressions.join(', ')}`)
      process.exit(1)
    }
    console.log(`\nNo benchmark regressed beyond ${(args.threshold * 100).toFixed(0)}%.`)
  }
}

main()
