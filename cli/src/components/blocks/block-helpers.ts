import { sanitizeForTerminalDisplay } from '@beyonders/common/util/string'

export function trimNewlines(str: string): string {
  return str.replace(/^\n+|\n+$/g, '')
}

export function sanitizePreview(text: string): string {
  // Preview text can come from a tool result (a command's last output lines, a
  // file's first line). Strip terminal escapes and control bytes before the
  // markdown punctuation, so nothing in the preview can drive the terminal.
  return sanitizeForTerminalDisplay(text)
    .replace(/[#*_`~\[\]()]/g, '')
    .trim()
}

// Re-export from block-processor for backwards compatibility
export { isReasoningTextBlock } from '../../utils/block-processor'
