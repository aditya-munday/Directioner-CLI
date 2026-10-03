import { readFilePathsOf } from '@beyonders/common/tools/params/tool/read-files'
import { isEnvTemplateFilePath } from '@beyonders/common/util/env-file-path'
import { sanitizeForTerminalDisplay } from '@beyonders/common/util/string'
import { TextAttributes } from '@opentui/core'

import { SimpleToolCallItem } from './tool-call-item'
import { defineToolComponent } from './types'
import { useTheme } from '../../hooks/use-theme'
import { isSensitiveFile } from '../../utils/create-run-config'

import type { ToolRenderConfig } from './types'

function FilePathsDescription({ filePaths }: { filePaths: string[] }) {
  const theme = useTheme()

  return (
    <>
      {filePaths.map((fp, idx) => {
        const isLast = idx === filePaths.length - 1
        const separator = isLast ? '' : ', '
        // File paths are model-generated and can carry escape sequences; only
        // the displayed copy is sanitized, the logic checks the raw path.
        const displayPath = sanitizeForTerminalDisplay(fp)

        if (isSensitiveFile(fp)) {
          return (
            <span key={fp}>
              <span fg={theme.muted} attributes={TextAttributes.STRIKETHROUGH}>
                {displayPath}
              </span>
              <span fg={theme.muted}> (blocked)</span>
              <span fg={theme.foreground}>{separator}</span>
            </span>
          )
        }

        if (isEnvTemplateFilePath(fp)) {
          return (
            <span key={fp}>
              <span fg={theme.foreground}>{displayPath}</span>
              <span fg={theme.muted}> (allowed - example only)</span>
              <span fg={theme.foreground}>{separator}</span>
            </span>
          )
        }

        return (
          <span key={fp} fg={theme.foreground}>
            {displayPath}
            {separator}
          </span>
        )
      })}
    </>
  )
}

/**
 * UI component for read_files tool.
 * Displays file paths with labels for blocked/template files.
 */
export const ReadFilesComponent = defineToolComponent({
  toolName: 'read_files',

  render(toolBlock): ToolRenderConfig {
    const input = toolBlock.input as any

    // Extract file paths from input
    const filePaths: string[] = readFilePathsOf(input?.paths)

    if (filePaths.length === 0) {
      return { content: null }
    }

    // Check if any files need special labels
    const hasSpecialFiles = filePaths.some(
      (fp) => isSensitiveFile(fp) || isEnvTemplateFilePath(fp),
    )

    return {
      content: (
        <SimpleToolCallItem
          name="Read"
          description={
            hasSpecialFiles ? (
              <FilePathsDescription filePaths={filePaths} />
            ) : (
              filePaths.join(', ')
            )
          }
        />
      ),
    }
  },
})
