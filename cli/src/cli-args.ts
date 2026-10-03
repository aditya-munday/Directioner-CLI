import { createRequire } from 'module'

import { Argument, Command } from 'commander'

import { IS_DIRECTIONER, IS_HOSTED, type AgentMode } from './utils/constants'
import { getCliEnv } from './utils/env'

const require = createRequire(import.meta.url)

export type ParsedArgs = {
  initialPrompt: string | null
  command?: string
  agent?: string
  clearLogs: boolean
  continue: boolean
  continueId?: string | null
  cwd?: string
  initialMode?: AgentMode
  /** Load repository `.agents` content without the trust prompt (CI opt-in). */
  trustAgents: boolean
  /** Directioner only: the configured provider id to run on. */
  provider?: string
  /** Directioner only: run the provider pre-flight report and exit. */
  doctor: boolean
  /** Directioner only: with `doctor`, also send one minimal live request. */
  ping: boolean
}

export function loadPackageVersion(): string {
  const env = getCliEnv()
  if (env.BEYONDERS_CLI_VERSION) {
    return env.BEYONDERS_CLI_VERSION
  }

  try {
    const pkg = require('../package.json') as { version?: string }
    if (pkg.version) {
      return pkg.version
    }
  } catch {
    // Continue to dev fallback
  }

  return 'dev'
}

export function parseArgs({
  argv = process.argv,
  isHosted = IS_HOSTED,
  isDirectioner = IS_DIRECTIONER,
  version = loadPackageVersion(),
}: {
  argv?: string[]
  isHosted?: boolean
  isDirectioner?: boolean
  version?: string
} = {}): ParsedArgs {
  const program = new Command()

  if (isDirectioner) {
    // Directioner: no account, no hosted backend. A provider is configured in
    // the config file, so there is no `login` command and no mode switching.
    program
      .name('directioner')
      .description('Directioner - terminal coding agent on the provider you configure')
      .version(version, '-v, --version', 'Print the CLI version')
      .option(
        '--continue [conversation-id]',
        'Continue from a previous conversation (optionally specify a conversation id)',
      )
      .option(
        '--cwd <directory>',
        'Set the working directory (default: current directory)',
      )
      .option(
        '--agent <agent-id>',
        'Run a specific agent id (skips loading local .agents overrides)',
      )
      .option(
        '--trust-agents',
        "Load this repository's .agents files and mcp.json without asking (for CI)",
      )
      .option('--provider <id>', 'Use this configured provider for the run')
      .option(
        '--doctor',
        'Check the configured provider (config, key, endpoint) and exit',
      )
      .option(
        '--ping',
        'With --doctor, also send one minimal request to confirm the key and model',
      )
      .argument('[prompt...]', 'Initial prompt to send to the agent')
      .allowExcessArguments(true)
      .helpOption('-h, --help', 'Show this help message')
  } else if (isHosted) {
    // Directioner: simplified CLI - no prompt args, no agent override, no clear-logs
    program
      .name('directioner')
      .description('Directioner - Free AI coding assistant')
      .version(version, '-v, --version', 'Print the CLI version')
      .option(
        '--continue [conversation-id]',
        'Continue from a previous conversation (optionally specify a conversation id)',
      )
      .option(
        '--cwd <directory>',
        'Set the working directory (default: current directory)',
      )
      .option(
        '--trust-agents',
        "Load this repository's .agents files and mcp.json without asking (for CI)",
      )
      .addArgument(
        new Argument('[command]', 'Command to run').choices(['login']),
      )
      .helpOption('-h, --help', 'Show this help message')
  } else {
    // Beyonders: full CLI with all options
    program
      .name('beyonders')
      .description('Beyonders CLI - AI-powered coding assistant')
      .version(version, '-v, --version', 'Print the CLI version')
      .option(
        '--agent <agent-id>',
        'Run a specific agent id (skips loading local .agents overrides)',
      )
      .option(
        '--clear-logs',
        'Remove any existing CLI log files before starting',
      )
      .option(
        '--continue [conversation-id]',
        'Continue from a previous conversation (optionally specify a conversation id)',
      )
      .option(
        '--cwd <directory>',
        'Set the working directory (default: current directory)',
      )
      .option(
        '--trust-agents',
        "Load this repository's .agents files and mcp.json without asking (for CI)",
      )
      .option('--lite', 'Start in LITE mode')
      .option('--free', 'Start in LITE mode (deprecated alias)')
      .option('--max', 'Start in MAX mode')
      .option('--plan', 'Start in PLAN mode')
      .addHelpText(
        'after',
        '\nCommands:\n  login                          Log in to your account\n  publish                        Publish agents to the registry',
      )
      .helpOption('-h, --help', 'Show this help message')
      .argument('[prompt...]', 'Initial prompt to send to the agent')
      .allowExcessArguments(true)
  }

  program.parse(argv)

  const options = program.opts()
  const args = program.args

  const continueFlag = options.continue

  // Determine initial mode from flags (last flag wins if multiple specified)
  // Directioner always uses LITE mode. Directioner has no mode flags at all: the
  // quality/cost trade-off is the provider's model choice, not a tier of ours.
  let initialMode: AgentMode | undefined
  if (isHosted) {
    initialMode = 'LITE'
  } else if (!isDirectioner) {
    if (options.free || options.lite) initialMode = 'LITE'
    if (options.max) initialMode = 'MAX'
    if (options.plan) initialMode = 'PLAN'
  }

  return {
    initialPrompt:
      !isHosted && args.length > 0 ? args.join(' ') : null,
    command: isDirectioner ? undefined : args[0],
    agent: options.agent,
    clearLogs: options.clearLogs || false,
    continue: Boolean(continueFlag),
    continueId:
      typeof continueFlag === 'string' && continueFlag.trim().length > 0
        ? continueFlag.trim()
        : null,
    cwd: options.cwd,
    initialMode,
    trustAgents: Boolean(options.trustAgents),
    provider: isDirectioner ? options.provider : undefined,
    doctor: isDirectioner ? Boolean(options.doctor) : false,
    ping: isDirectioner ? Boolean(options.ping) : false,
  }
}
