/**
 * CLI-specific environment variable types.
 *
 * Extends base types from common with CLI-specific vars for:
 * - Terminal/IDE detection
 * - Editor preferences
 * - Binary build configuration
 */

import type { BaseEnv, ClientEnv } from '@beyonders/common/types/contracts/env'

/**
 * CLI-specific env vars for terminal/IDE detection and editor preferences.
 */
export type CliEnv = BaseEnv & {
  // Windows system paths
  SystemRoot?: string

  // Terminal detection (for tmux/screen passthrough)
  TERM?: string
  TMUX?: string
  STY?: string

  // SSH/remote session detection
  SSH_CLIENT?: string
  SSH_TTY?: string
  SSH_CONNECTION?: string
  CODESPACES?: string

  // Display server detection (Linux headless check)
  DISPLAY?: string
  WAYLAND_DISPLAY?: string

  // Terminal-specific
  KITTY_WINDOW_ID?: string
  SIXEL_SUPPORT?: string
  ZED_NODE_ENV?: string
  ZED_TERM?: string
  ZED_SHELL?: string
  COLORTERM?: string

  // VS Code family detection
  VSCODE_THEME_KIND?: string
  VSCODE_COLOR_THEME_KIND?: string
  VSCODE_GIT_IPC_HANDLE?: string
  VSCODE_PID?: string
  VSCODE_CWD?: string
  VSCODE_NLS_CONFIG?: string

  // Cursor editor detection
  CURSOR_PORT?: string
  CURSOR?: string

  // JetBrains IDE detection
  JETBRAINS_REMOTE_RUN?: string
  IDEA_INITIAL_DIRECTORY?: string
  IDE_CONFIG_DIR?: string
  JB_IDE_CONFIG_DIR?: string

  // Editor preferences
  VISUAL?: string
  EDITOR?: string
  BEYONDERS_CLI_EDITOR?: string
  BEYONDERS_EDITOR?: string

  // Theme preferences
  OPEN_TUI_THEME?: string
  OPENTUI_THEME?: string

  // Beyonders CLI-specific (set during binary build)
  BEYONDERS_IS_BINARY?: string
  BEYONDERS_CLI_VERSION?: string
  BEYONDERS_CLI_TARGET?: string
  BEYONDERS_RG_PATH?: string
  // Comma-separated registry publishers whose agents may run executable
  // handleSteps on this machine; read by the SDK (sdk/src/agent-publisher-trust.ts)
  BEYONDERS_TRUSTED_AGENT_PUBLISHERS?: string
  BEYONDERS_SCROLL_MULTIPLIER?: string
  BEYONDERS_PERF_TEST?: string
  BEYONDERS_TRACE?: string
  BEYONDERS_LAUNCHER_PID?: string
  // Toggle for mirroring CLI logs to the server's /api/logs sink (Axiom).
  BEYONDERS_SHIP_LOGS?: string
  // Set to 1/true to suppress the terminal-reset watchdog on machines where
  // the PowerShell process shape conflicts with endpoint-security policy.
  BEYONDERS_NO_TERMINAL_WATCHDOG?: string
  // Set to 1/true to load repository `.agents` files and mcp.json without the
  // interactive trust prompt (CI opt-in; see utils/agent-dir-trust.ts).
  BEYONDERS_TRUST_AGENT_DIRS?: string
  HOSTED_MODE?: string
  /** Directioner build flag (see utils/constants.ts IS_DIRECTIONER). */
  DIRECTIONER_MODE?: string
  /** Absolute per-process override for isolated CLI settings and transcripts. */
  HOSTED_CONFIG_DIR?: string
  /**
   * Directioner equivalent of HOSTED_CONFIG_DIR. Must be absolute; a relative
   * path is rejected so settings can never land inside the current project.
   */
  DIRECTIONER_CONFIG_DIR?: string
  /** Local agentic-ads harness only (`scripts/local-agentic-ads`). */
  TEST_AGENTIC_ADS?: string
  TEST_AGENTIC_ADS_CAMPAIGN?: string
}

/**
 * Full CLI env deps combining client env and CLI env.
 */
export type CliEnvDeps = {
  clientEnv: ClientEnv
  env: CliEnv
}

/**
 * Function type for getting CLI env values.
 */
export type GetCliEnvFn = () => CliEnv
