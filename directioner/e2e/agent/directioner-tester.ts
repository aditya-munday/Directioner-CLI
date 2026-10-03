import type { AgentDefinition } from '@beyonders/sdk'

/**
 * Agent definition for testing the Directioner CLI via tmux.
 *
 * This agent is designed to be used with the custom tmux tools from
 * `createDirectionerTmuxTools()`. It receives a testing task in its prompt
 * and uses tmux tools to start Directioner, interact with it, and verify behavior.
 *
 * Example usage:
 * ```ts
 * const { tools, cleanup } = createDirectionerTmuxTools(binaryPath)
 * const result = await client.run({
 *   agent: directionerTesterAgent.id,
 *   prompt: 'Start directioner and verify the welcome screen shows Directioner branding',
 *   agentDefinitions: [directionerTesterAgent],
 *   customToolDefinitions: tools,
 *   handleEvent: collector.handleEvent,
 * })
 * await cleanup()
 * ```
 */
export const directionerTesterAgent: AgentDefinition = {
  id: 'directioner-tester',
  displayName: 'Directioner E2E Tester',
  model: 'anthropic/claude-sonnet-4.5',
  toolNames: [
    'start_directioner',
    'send_to_directioner',
    'capture_directioner_output',
    'stop_directioner',
  ],
  instructionsPrompt: `You are a QA tester for the Directioner CLI application.

Your job is to verify that Directioner behaves correctly by interacting with it
through tmux tools. Follow these steps:

1. Call start_directioner to launch the CLI
2. Use capture_directioner_output (with waitSeconds) to see the terminal output
3. Use send_to_directioner to type commands or text
4. Capture output again to verify behavior
5. ALWAYS call stop_directioner when done

Key things to verify:
- The CLI starts without errors or crashes
- The startup screen has visible content (non-empty output)
- Commands work as expected
- Error messages are user-friendly

Report your findings clearly. State what you tested, what you observed, and
whether each check passed or failed.`,
}
