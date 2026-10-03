/**
 * Generate a closing XML tag for a single tool name
 * @param toolName Single tool name to generate closing tag for
 * @returns Closing XML tag string
 */
export function closeXml(toolName: string): string {
  return `</${toolName}>`
}

/**
 * Escape text that is placed inside an element in the model's prompt.
 *
 * A name, path, or branch taken from a cloned repository is attacker-chosen
 * text. Interpolated raw inside `<project_file_tree>...</project_file_tree>`
 * it can emit the closing tag itself — inline (`evil</project_file_tree>`) or
 * after a newline — and everything after it reads as prompt-level text rather
 * than as the contents of a data block. Escaping the angle brackets makes the
 * tag unrepresentable, so the boundary holds for any input.
 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Escape text that is placed inside a quoted XML **attribute** value.
 *
 * This is a different context from {@link escapeXmlText}: inside `key="…"` the
 * dangerous characters are the quote (which ends the value) and a newline
 * (which some readers treat as a value terminator). Neither is escaped by
 * `escapeXmlText`, so a value interpolated raw into an attribute can close it
 * and append attributes of its own.
 *
 * Concretely, the tool-result and tool-metadata wrappers name their origin
 * with values an attacker controls — a repository `.agents/mcp.json` server
 * key, or a tool name — and those wrappers carry a `trust="untrusted"` claim.
 * A raw value containing `"` forges a second `trust="trusted"`, and a value
 * containing a newline ends the tag line and drops the remainder into the
 * prompt at instruction priority. Both defeat the boundary the wrapper exists
 * to draw. Escaping the quote and every C0/C1-style control character makes
 * the attribute unforgeable for any input while leaving ordinary names
 * (including `__`, `:`, `.`) readable.
 */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
}

/**
 * Replace control characters (including newlines and ANSI escapes) with a
 * space. Used for single-line fields so a value cannot add lines to the prompt
 * or rewrite the terminal.
 */
export function stripControlCharacters(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ')
}

/**
 * A repository-controlled name or path rendered for the model: one line, with
 * no character able to close the surrounding element.
 *
 * Only the angle brackets are escaped, not `&`. A path is something the model
 * may have to reproduce in a command, and `&` is common in real directory
 * names (`R&D`); leaving it alone keeps the name usable while still making a
 * closing tag unrepresentable.
 */
export function sanitizeDisplayedName(value: string): string {
  return stripControlCharacters(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Generate stop sequences (closing XML tags) for a list of tool names
 * @param toolNames Array of tool names to generate closing tags for
 * @returns Array of closing XML tag strings
 */
export function getStopSequences(toolNames: readonly string[]): string[] {
  return toolNames.map((toolName) => `</beyonders_tool_${toolName}>`)
}
