import { clientEnvSchema, clientProcessEnv } from './env-schema'

const parsedEnv = clientEnvSchema.safeParse(clientProcessEnv)
if (!parsedEnv.success) {
  // Every field is optional for Directioner, so reaching here means a value was
  // supplied but is malformed (e.g. a non-URL backend URL). That is worth
  // reporting; an *absent* value is not an error any more, and must not stop
  // the binary from starting.
  console.error('Environment validation failed:', parsedEnv.error.issues)
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`)
}

/**
 * A binary built with no NEXT_PUBLIC_* values inlined has an undefined
 * environment selector. Default it to 'prod' so the config-directory suffix and
 * the dev-only branches behave as they would on a real install, rather than
 * producing a `-undefined` directory name.
 */
export const env = {
  ...parsedEnv.data,
  NEXT_PUBLIC_CB_ENVIRONMENT:
    parsedEnv.data.NEXT_PUBLIC_CB_ENVIRONMENT ?? ('prod' as const),
}

// Only log environment in non-production
if (env.NEXT_PUBLIC_CB_ENVIRONMENT !== 'prod') {
  console.log('Using environment:', env.NEXT_PUBLIC_CB_ENVIRONMENT)
}

// Derived environment constants for convenience
export const IS_DEV = env.NEXT_PUBLIC_CB_ENVIRONMENT === 'dev'
export const IS_TEST = env.NEXT_PUBLIC_CB_ENVIRONMENT === 'test'
export const IS_PROD = env.NEXT_PUBLIC_CB_ENVIRONMENT === 'prod'
export const IS_CI = process.env.BEYONDERS_GITHUB_ACTIONS === 'true'

// Debug flag for logging analytics events in dev mode
// Set to true when actively debugging analytics - affects both CLI and backend
export const DEBUG_ANALYTICS = false
