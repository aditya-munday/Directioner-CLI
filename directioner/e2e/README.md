# Directioner E2E Tests

End-to-end tests for the Directioner CLI binary. Tests verify that the compiled binary works correctly by interacting with it via tmux.

## Architecture

Two testing approaches are supported:

### 1. Direct tmux tests (fast, deterministic)

Use the `DirectionerSession` class to start the binary in tmux, send commands, capture output, and assert directly.

```typescript
import { describe, test, expect, afterEach } from 'bun:test'
import { DirectionerSession, requireDirectionerBinary } from '../utils'

describe('My Feature', () => {
  let session: DirectionerSession | null = null

  afterEach(async () => {
    if (session) await session.stop()
    session = null
  })

  test('works correctly', async () => {
    const binary = requireDirectionerBinary()
    session = await DirectionerSession.start(binary)

    await session.send('/help')
    const output = await session.capture(2)

    expect(output).toContain('Shortcuts')
  }, 60_000)
})
```

### 2. SDK agent-driven tests (AI-powered verification)

Use the Beyonders SDK to run a testing agent that interacts with Directioner via custom tmux tools. The agent reasons about the CLI output and verifies complex behaviors.

```typescript
import { describe, test, expect, afterEach } from 'bun:test'
import { BeyondersClient } from '@beyonders/sdk'
import { directionerTesterAgent } from '../agent/directioner-tester'
import { createDirectionerTmuxTools, requireDirectionerBinary } from '../utils'

describe('Agent Test', () => {
  let cleanup: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (cleanup) await cleanup()
    cleanup = null
  })

  test('verifies startup', async () => {
    const apiKey = process.env.BEYONDERS_API_KEY
    if (!apiKey) return // Skip if no API key

    const binary = requireDirectionerBinary()
    const tmuxTools = createDirectionerTmuxTools(binary)
    cleanup = tmuxTools.cleanup

    const client = new BeyondersClient({ apiKey })
    const result = await client.run({
      agent: directionerTesterAgent.id,
      prompt: 'Start Directioner and verify the branding is correct.',
      agentDefinitions: [directionerTesterAgent],
      customToolDefinitions: tmuxTools.tools,
      handleEvent: () => {},
    })

    expect(result.output.type).not.toBe('error')
  }, 180_000)
})
```

### 3. Live smoke against production

`tests/live-turn.e2e.test.ts` is the one file here that talks to the real backend:
it navigates the landing picker to DeepSeek V4.1 Flash, starts a session, sends a
prompt, waits for the answer, then runs `/end-session` and checks the backend shows
no open session. It skips unless `DIRECTIONER_SMOKE_API_KEY` (or
`BEYONDERS_API_KEY`) is set, and needs a binary built with the production public
env. It is not in the `directioner-e2e.yml` matrix — `.github/workflows/prod-smoke.yml`
runs it on a schedule and before each release.

```bash
NEXT_PUBLIC_CB_ENVIRONMENT=prod NEXT_PUBLIC_BEYONDERS_APP_URL=https://www.beyonders.com \
NEXT_PUBLIC_DIRECTIONER_APP_URL=https://directioner.com NEXT_PUBLIC_SUPPORT_EMAIL=support@beyonders.com \
NEXT_PUBLIC_POSTHOG_API_KEY=test NEXT_PUBLIC_POSTHOG_HOST_URL=http://127.0.0.1:9 \
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=test NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL=http://127.0.0.1:9 \
NEXT_PUBLIC_WEB_PORT=3000 bun directioner/cli/build.ts 0.0.0-smoke
BEYONDERS_API_KEY=<your token> bun test directioner/e2e/tests/live-turn.e2e.test.ts --timeout=300000
```

The CLI runs with its own `HOSTED_CONFIG_DIR`, so your real profile is untouched.

## Prerequisites

- **tmux** must be installed: `brew install tmux` (macOS) or `sudo apt-get install tmux` (Ubuntu)
- **Directioner binary** must be built: `bun directioner/cli/build.ts 0.0.0-dev`
- **SDK built** (for agent tests): `cd sdk && bun run build`
- **BEYONDERS_API_KEY** (for agent tests only): Set this environment variable

## Running Tests

### Build the binary first

```bash
bun directioner/cli/build.ts 0.0.0-dev
```

### Run all tests

```bash
bun test directioner/e2e/tests/
```

### Run a specific test

```bash
bun test directioner/e2e/tests/version.e2e.test.ts
bun test directioner/e2e/tests/startup.e2e.test.ts
bun test directioner/e2e/tests/help-command.e2e.test.ts
bun test directioner/e2e/tests/agent-startup.e2e.test.ts
```

### Use a custom binary path

```bash
DIRECTIONER_BINARY=/path/to/directioner bun test directioner/e2e/tests/
```

## Adding New Tests

1. Create a new file in `directioner/e2e/tests/` with the naming convention `<feature>.e2e.test.ts`
2. Add the test name to `.github/workflows/directioner-e2e.yml` matrix:

```yaml
matrix:
  test:
    - version
    - startup
    - help-command
    - agent-startup
    - your-new-test    # <-- add here
```

3. The test will automatically run in parallel with other tests in CI.

## CI Workflow

The `.github/workflows/directioner-e2e.yml` workflow:

1. **Builds** the Directioner binary once (linux-x64)
2. **Runs each test file in parallel** via GitHub Actions matrix strategy
3. **Uploads tmux session logs** on failure for debugging

Triggers:
- **Nightly** at 6:00 AM PT
- **Manual** via workflow_dispatch

## Utilities Reference

### `DirectionerSession`

| Method | Description |
|--------|-------------|
| `DirectionerSession.start(binaryPath)` | Start binary in tmux, returns session |
| `session.send(text)` | Send text input (presses Enter) |
| `session.sendKey(key)` | Send special key (e.g. `'C-c'`, `'Escape'`) |
| `session.capture(waitSec?)` | Capture terminal output |
| `session.captureLabeled(label, waitSec?)` | Capture and save to session logs |
| `session.waitForText(pattern, timeoutMs?)` | Poll until text appears |
| `session.stop()` | Stop session and clean up |

### `createDirectionerTmuxTools(binaryPath)`

Creates SDK custom tools for agent-driven testing:
- `start_directioner` - Launch the CLI
- `send_to_directioner` - Send text input
- `capture_directioner_output` - Capture terminal output
- `stop_directioner` - Stop and clean up

### Helper functions

| Function | Description |
|----------|-------------|
| `requireDirectionerBinary()` | Get binary path, throws if not found |
| `getDirectionerBinaryPath()` | Get binary path (may not exist) |
