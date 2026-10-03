/**
 * Separator between an MCP server name and its tool name in the exposed tool
 * name (`server__tool`). Shared by the runtime, which builds exposed names, and
 * by the message boundary, which reads the server back out to tag a result's
 * provenance.
 *
 * LLM APIs (OpenRouter/Anthropic) only allow tool names matching
 * `^[a-zA-Z0-9_-]{1,128}$`, which excludes `/`, so a double underscore is used:
 * allowed by the pattern, unlikely to collide, and clearly a separator.
 */
export const MCP_TOOL_SEPARATOR = '__'
