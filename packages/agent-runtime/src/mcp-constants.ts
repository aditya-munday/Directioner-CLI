/**
 * Separator used between MCP server name and tool name.
 * 
 * LLM APIs (OpenRouter/Anthropic) only allow tool names matching the pattern
 * ^[a-zA-Z0-9_-]{1,128}$, which doesn't include forward slashes.
 * 
 * We use double underscore as the separator since it's:
 * - Allowed by the LLM API pattern
 * - Unlikely to conflict with existing tool names
 * - Clearly identifiable as a separator
 *
 * Defined in `@beyonders/common` so the message boundary (which reads the
 * server back out of a tool name to tag a result's provenance) and the runtime
 * (which builds the name) cannot drift apart.
 */
export { MCP_TOOL_SEPARATOR } from '@beyonders/common/constants/mcp'
