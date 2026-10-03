/**
 * Environment-variable names that must never reach a shell a model asked for.
 *
 * The sponsored-run boundary has asserted on these shapes since COD-336, where
 * they guard an allowlist against being widened for a build tool and taking a
 * credential with it. The default terminal boundary needs the same assertion,
 * so the shapes live here rather than in one of its two callers: there is one
 * definition, and both the sponsored scrub and the default scrub read it.
 */

const CREDENTIAL_ENV_SHAPES: readonly RegExp[] = Object.freeze([
  /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/i,
  /(^|_)(API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|SESSION)$/i,
  /^AWS_/i,
  /^GH_|^GITHUB_/i,
  /^NPM_/i,
  /^OPENAI_|^ANTHROPIC_|^GEMINI_/i,
])

export function looksLikeCredentialEnvVar(name: string): boolean {
  return CREDENTIAL_ENV_SHAPES.some((shape) => shape.test(name))
}
