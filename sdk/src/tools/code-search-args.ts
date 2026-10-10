/**
 * Parse the user-facing `code_search` flag string into argv.
 *
 * Kept in its own module so both the search surface (`code-search.ts`) and the
 * flag allowlist (`code-search-flags.ts`) can use one parser without importing
 * each other. Quotes group whitespace but are not passed to ripgrep, because
 * spawn() does not invoke a shell.
 */
export function parseCodeSearchFlags(
  flags: string | undefined,
): string[] | null {
  if (!flags?.trim()) return []
  const tokens: string[] = []
  let token = ''
  let quote: "'" | '"' | null = null
  let tokenStarted = false
  for (const character of flags) {
    if (quote) {
      if (character === quote) quote = null
      else token += character
      tokenStarted = true
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      tokenStarted = true
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token)
        token = ''
        tokenStarted = false
      }
    } else {
      token += character
      tokenStarted = true
    }
  }
  if (quote) return null
  if (tokenStarted) tokens.push(token)
  return tokens
}
