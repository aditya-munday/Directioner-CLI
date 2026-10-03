const POLICY_EFFECTIVE_DATE = 'September 2, 2026'
// Codebase Evaluation narrowed to connected GitHub repositories only.
const CODEBASE_EVALUATION_NARROWED_DATE = 'September 25, 2026'

export const DIRECTIONER_POLICY_METADATA = {
  version: '2026-09-02',
  effectiveDate: POLICY_EFFECTIVE_DATE,
  codebaseEvaluationNarrowedDate: CODEBASE_EVALUATION_NARROWED_DATE,
  lastUpdated: '09/25/2026',
  privacyPolicyLastUpdated: '09/25/2026',
} as const

export const DIRECTIONER_PRIVACY_POLICY_URL = 'https://directioner.com/privacy-policy'

export const DIRECTIONER_AI_TRAINING_NOTICE = 'May use data for AI training'

export type DirectionerModelDataUse = 'service' | 'training'

/**
 * Canonical short-form public copy derived from the September 2 Privacy Policy.
 * Product surfaces should import these answers instead of restating data-use
 * promises. Static Markdown/MDX copies are protected by the drift test in
 * `directioner-public-data-use-copy.test.ts`.
 */
export const DIRECTIONER_PUBLIC_DATA_USE_COPY = {
  collectionQuestion: 'Does Directioner collect my data?',
  collectionAnswer:
    'Directioner collects prompts, messages, code, files, repository data, and agent traces when you use features that need them. Depending on the model or feature, AI model providers may also process that data. See the Privacy Policy for the uses and limits that apply.',
  trainingQuestion: 'Is my data used to train AI?',
  trainingAnswer:
    'Only when a model or feature says data may be used for AI training. Directioner or the provider may then keep submissions to develop, train, test, evaluate, fine-tune, and improve AI models or products.',
  storageQuestion: 'How is my data used and stored?',
  storageAnswer: `We use prompts, messages, agent traces, code, files, and repository data to provide Directioner. We do not give separately uploaded files or connected repositories to third parties. Restricted partners may evaluate connected Cloud repositories, but cannot otherwise use, broadly share, or train on them. See the Privacy Policy for retention, eligibility, and data choices.`,
  compactTrainingSummary: `Models or features labeled “${DIRECTIONER_AI_TRAINING_NOTICE}” may keep submissions to develop, train, test, evaluate, fine-tune, and improve AI models or products.`,
  compactPrivacySummary: `Separate uploads and connected repositories are not provided to third parties. Restricted partners may evaluate connected Cloud repositories, but cannot otherwise use, broadly share, or train on them. Models or features labeled “${DIRECTIONER_AI_TRAINING_NOTICE}” may separately use submissions for AI training.`,
  localExecutionSummary:
    'Directioner edits files locally but sends relevant prompts, code, files, and repository context to its servers and model providers. See the Privacy Policy for details.',
  compactLocalExecutionSummary:
    'Edits run locally, but relevant prompts, code, files, and repository context are sent to Directioner and model providers.',
} as const

export const DIRECTIONER_DATA_USE_GENERATED_MARKDOWN_BLOCK = {
  start: '<!-- BEGIN GENERATED DIRECTIONER DATA USE -->',
  end: '<!-- END GENERATED DIRECTIONER DATA USE -->',
} as const

export const DIRECTIONER_DATA_USE_GENERATED_MDX_BLOCK = {
  start: '{/* BEGIN GENERATED DIRECTIONER DATA USE */}',
  end: '{/* END GENERATED DIRECTIONER DATA USE */}',
} as const

export function renderDirectionerDataUseFaqMarkdown(): string {
  return `${DIRECTIONER_DATA_USE_GENERATED_MARKDOWN_BLOCK.start}

**${DIRECTIONER_PUBLIC_DATA_USE_COPY.trainingQuestion}** ${DIRECTIONER_PUBLIC_DATA_USE_COPY.trainingAnswer}

**${DIRECTIONER_PUBLIC_DATA_USE_COPY.storageQuestion}** ${DIRECTIONER_PUBLIC_DATA_USE_COPY.storageAnswer}

See the [Privacy Policy](${DIRECTIONER_PRIVACY_POLICY_URL}) for complete details.

${DIRECTIONER_DATA_USE_GENERATED_MARKDOWN_BLOCK.end}`
}

export function renderDirectionerDataUseFaqMdx(): string {
  return `${DIRECTIONER_DATA_USE_GENERATED_MDX_BLOCK.start}

## ${DIRECTIONER_PUBLIC_DATA_USE_COPY.storageQuestion}

${DIRECTIONER_PUBLIC_DATA_USE_COPY.storageAnswer}

## ${DIRECTIONER_PUBLIC_DATA_USE_COPY.trainingQuestion}

${DIRECTIONER_PUBLIC_DATA_USE_COPY.trainingAnswer}

See the [Privacy Policy](${DIRECTIONER_PRIVACY_POLICY_URL}) for complete details.

${DIRECTIONER_DATA_USE_GENERATED_MDX_BLOCK.end}`
}
