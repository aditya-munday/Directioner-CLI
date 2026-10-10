/**
 * Evaluation artifact format.
 *
 * A versioned, validated record of what an agent actually did on a task, safe
 * to store and share. It exists so a quality claim traces to a measurement:
 * which provider and model, which task, what outcome, how long, how much it
 * cost — and so the numbers can be compared across runs without hand-reading
 * logs.
 *
 * Two hard rules are enforced here, not left to the caller:
 *
 *   1. **No quality claim from a mock.** A run whose provider is `mock` or
 *      `loopback` answers from a fixed script, so it measures the harness and
 *      nothing about the model. `validateEvalArtifact` rejects any artifact
 *      that marks such a run as a quality measurement. "Do not claim agent
 *      quality from a fixed loopback response" is a property of this schema,
 *      not a note in a README.
 *   2. **Redacted on write.** Providers echo credentials, and agent transcripts
 *      contain absolute home paths. Every free-text field passes through
 *      `redactEvalText` before it is stored, so an artifact cannot leak a key or
 *      a username by being concatenated into a summary.
 *
 * Nothing here performs I/O beyond reading/writing a caller-named local file.
 */

import { z } from 'zod/v4'

export const EVAL_ARTIFACT_SCHEMA = 'directioner-eval/v1'

/** How the provider under test produced its answers. */
export const ProviderKindSchema = z.enum([
  /** A real remote provider over the network. */
  'remote',
  /** A real provider served locally on the machine. */
  'local',
  /** A recorded/scripded transport that replays fixed responses. */
  'mock',
  /** A fixed loopback responder; measures the harness, not the model. */
  'loopback',
])
export type ProviderKind = z.infer<typeof ProviderKindSchema>

/** Provider kinds that cannot support a claim about model quality. */
const NON_QUALIFYING_KINDS: ReadonlySet<ProviderKind> = new Set(['mock', 'loopback'])

export const EvalTaskOutcomeSchema = z.enum([
  'passed',
  'failed',
  'errored',
  'skipped',
])
export type EvalTaskOutcome = z.infer<typeof EvalTaskOutcomeSchema>

export const EvalTaskResultSchema = z.object({
  /** Stable task identifier from the eval set. */
  taskId: z.string().min(1),
  outcome: EvalTaskOutcomeSchema,
  /** Scored 0..1 when a grader ran, omitted when it did not. */
  score: z.number().min(0).max(1).optional(),
  durationMs: z.number().nonnegative(),
  /** Provider-reported token usage when available. */
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  /** Reported cost in USD when the provider gives one. */
  costUsd: z.number().nonnegative().optional(),
  /** Error class only — never a raw provider message (those leak). */
  errorClass: z.string().max(120).optional(),
})
export type EvalTaskResult = z.infer<typeof EvalTaskResultSchema>

export const EvalRunSchema = z.object({
  /** e.g. "heital", "eternal", "infernal". */
  provider: z.string().min(1),
  providerKind: ProviderKindSchema,
  model: z.string().min(1),
  /** Git revision of the code under test. */
  revision: z.string().min(1),
  startedAt: z.string().min(1),
  results: z.array(EvalTaskResultSchema),
})
export type EvalRun = z.infer<typeof EvalRunSchema>

export const EvalArtifactSchema = z.object({
  schema: z.literal(EVAL_ARTIFACT_SCHEMA),
  /** Free-text note. Redacted on creation. */
  note: z.string().optional(),
  runs: z.array(EvalRunSchema),
})
export type EvalArtifact = z.infer<typeof EvalArtifactSchema>

/**
 * Strip the things that must never be persisted from free text: bearer tokens,
 * common provider key shapes, emails, and absolute home paths that carry a real
 * username. Written for artifact notes and error classes, not as a general
 * sanitizer — it errs toward removing too much.
 */
export function redactEvalText(text: string): string {
  return text
    // Authorization headers and bare bearer tokens.
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    // OpenAI/Anthropic/OpenRouter-style keys, plus generic sk-/gsk_/xai- forms.
    // The separator after the prefix is either a hyphen or an underscore.
    .replace(/\b(?:sk|gsk|xai|or)[-_][A-Za-z0-9._\-]{8,}/gi, '[redacted-key]')
    .replace(/\bsk-ant-[A-Za-z0-9._\-]+/gi, '[redacted-key]')
    // Emails.
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    // Absolute home paths (POSIX and macOS), which embed a username.
    .replace(/\/(?:home|Users)\/[^/\s"']+/g, '/home/[redacted]')
    // Windows user profile paths.
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, 'C:\\Users\\[redacted]')
}

/** Redact an artifact's free-text fields (returns a copy). */
export function redactEvalArtifact(artifact: EvalArtifact): EvalArtifact {
  return {
    ...artifact,
    ...(artifact.note !== undefined ? { note: redactEvalText(artifact.note) } : {}),
    runs: artifact.runs.map((run) => ({
      ...run,
      results: run.results.map((result) => ({
        ...result,
        ...(result.errorClass !== undefined
          ? { errorClass: redactEvalText(result.errorClass) }
          : {}),
      })),
    })),
  }
}

export interface EvalValidationIssue {
  path: string
  message: string
}

/**
 * Validate an artifact's shape AND its honesty.
 *
 * Shape errors come from the schema. Honesty errors are ours: a run with a
 * non-qualifying provider kind must not carry grader scores, because a score
 * from a fixed responder reads as a capability measurement when it is not one.
 */
export function validateEvalArtifact(value: unknown): EvalValidationIssue[] {
  const parsed = EvalArtifactSchema.safeParse(value)
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
  }
  const artifact = parsed.data
  const issues: EvalValidationIssue[] = []
  artifact.runs.forEach((run, runIndex) => {
    if (!NON_QUALIFYING_KINDS.has(run.providerKind)) return
    run.results.forEach((result, resultIndex) => {
      if (result.score !== undefined) {
        issues.push({
          path: `runs.${runIndex}.results.${resultIndex}.score`,
          message: `score recorded for providerKind "${run.providerKind}"; a fixed/mock provider cannot support a quality measurement (provider "${run.provider}")`,
        })
      }
    })
  })
  return issues
}

/** True only when every run qualifies as a real quality measurement. */
export function claimsAgentQuality(artifact: EvalArtifact): boolean {
  return (
    artifact.runs.length > 0 &&
    artifact.runs.every((run) => !NON_QUALIFYING_KINDS.has(run.providerKind)) &&
    artifact.runs.some((run) => run.results.some((result) => result.score !== undefined))
  )
}

/** Throws if the artifact is malformed or dishonest. */
export function assertValidEvalArtifact(value: unknown): EvalArtifact {
  const issues = validateEvalArtifact(value)
  if (issues.length > 0) {
    throw new Error(
      `Invalid eval artifact:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`,
    )
  }
  return EvalArtifactSchema.parse(value)
}

/** Parse and validate an artifact from JSON text. */
export function parseEvalArtifact(text: string): EvalArtifact {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `Eval artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return assertValidEvalArtifact(value)
}

export interface TaskComparison {
  taskId: string
  base?: { outcome: EvalTaskOutcome; score?: number }
  candidate?: { outcome: EvalTaskOutcome; score?: number }
  /** candidate.score - base.score when both exist. */
  scoreDelta?: number
  /** True when the outcome changed from a non-pass to pass, or vice versa. */
  outcomeChanged: boolean
}

export interface EvalComparison {
  perTask: TaskComparison[]
  baseScoreMean?: number
  candidateScoreMean?: number
  /** candidate mean - base mean, over tasks scored in both. */
  scoreMeanDelta?: number
  basePassRate?: number
  candidatePassRate?: number
  /** Tasks only one side contains; excluded from the deltas. */
  onlyInBase: string[]
  onlyInCandidate: string[]
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function passRate(results: EvalTaskResult[]): number | undefined {
  const scored = results.filter((r) => r.outcome !== 'skipped')
  if (scored.length === 0) return undefined
  return scored.filter((r) => r.outcome === 'passed').length / scored.length
}

/**
 * Compare two artifacts task-by-task. Runs are flattened by task id, so each
 * artifact is expected to describe one provider/model configuration over a task
 * set. Tasks scored in only one artifact are reported but excluded from the
 * aggregate deltas — averaging over an unequal task set would manufacture a
 * difference that is not there.
 */
export function compareEvalArtifacts(
  base: EvalArtifact,
  candidate: EvalArtifact,
): EvalComparison {
  const baseTasks = new Map<string, EvalTaskResult>()
  for (const run of base.runs) for (const result of run.results) baseTasks.set(result.taskId, result)
  const candidateTasks = new Map<string, EvalTaskResult>()
  for (const run of candidate.runs) for (const result of run.results) candidateTasks.set(result.taskId, result)

  const onlyInBase = [...baseTasks.keys()].filter((id) => !candidateTasks.has(id)).sort()
  const onlyInCandidate = [...candidateTasks.keys()].filter((id) => !baseTasks.has(id)).sort()

  const shared = [...baseTasks.keys()].filter((id) => candidateTasks.has(id)).sort()
  const perTask: TaskComparison[] = shared.map((taskId) => {
    const b = baseTasks.get(taskId)!
    const c = candidateTasks.get(taskId)!
    return {
      taskId,
      base: { outcome: b.outcome, score: b.score },
      candidate: { outcome: c.outcome, score: c.score },
      ...(b.score !== undefined && c.score !== undefined
        ? { scoreDelta: c.score - b.score }
        : {}),
      outcomeChanged: b.outcome !== c.outcome,
    }
  })

  const baseShared = shared.map((id) => baseTasks.get(id)!)
  const candidateShared = shared.map((id) => candidateTasks.get(id)!)
  const baseScored = baseShared.filter((r) => r.score !== undefined).map((r) => r.score!)
  const candidateScored = candidateShared.filter((r) => r.score !== undefined).map((r) => r.score!)
  const baseMean = mean(baseScored)
  const candidateMean = mean(candidateScored)

  return {
    perTask,
    ...(baseMean !== undefined ? { baseScoreMean: baseMean } : {}),
    ...(candidateMean !== undefined ? { candidateScoreMean: candidateMean } : {}),
    ...(baseMean !== undefined && candidateMean !== undefined
      ? { scoreMeanDelta: candidateMean - baseMean }
      : {}),
    ...(passRate(baseShared) !== undefined ? { basePassRate: passRate(baseShared) } : {}),
    ...(passRate(candidateShared) !== undefined
      ? { candidatePassRate: passRate(candidateShared) }
      : {}),
    onlyInBase,
    onlyInCandidate,
  }
}
