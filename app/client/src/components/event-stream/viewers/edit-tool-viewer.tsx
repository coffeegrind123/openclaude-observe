import { DiffViewer } from './diff-viewer'

interface EditToolViewerProps {
  filePath: string
  toolInput: Record<string, unknown>
  toolResponse: Record<string, unknown> | string | undefined
  relPath: (p: string) => string
}

// OpenClaude's Edit tool sends { file_path, old_string, new_string } on the
// tool_input; the tool_response may include the same fields on a toolUseResult
// wrapper. Prefer input since that's always present; fall back to response for
// historical events that may have shifted.
function extractStrings(
  toolInput: Record<string, unknown>,
  toolResponse: EditToolViewerProps['toolResponse'],
): { oldString: string; newString: string } {
  let oldString = (toolInput.old_string as string) || ''
  let newString = (toolInput.new_string as string) || ''
  if ((!oldString || !newString) && toolResponse && typeof toolResponse !== 'string') {
    const r = toolResponse as Record<string, any>
    oldString = oldString || (r.oldString as string) || (r.old_string as string) || ''
    newString = newString || (r.newString as string) || (r.new_string as string) || ''
  }
  return { oldString, newString }
}

export function EditToolViewer({
  filePath,
  toolInput,
  toolResponse,
  relPath,
}: EditToolViewerProps) {
  const { oldString, newString } = extractStrings(toolInput, toolResponse)
  const displayPath = relPath(filePath)

  if (!oldString && !newString) {
    return (
      <div className="text-[11px] italic text-muted-foreground/70">No edit content captured.</div>
    )
  }

  const replaceAll = toolInput.replace_all === true

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate font-mono">{displayPath}</span>
        {replaceAll && (
          <span className="shrink-0 rounded bg-amber-500/20 px-1 py-[1px] font-medium text-amber-700 dark:text-amber-400">
            replace_all
          </span>
        )}
      </div>
      <DiffViewer fileName={filePath} oldString={oldString} newString={newString} />
    </div>
  )
}
