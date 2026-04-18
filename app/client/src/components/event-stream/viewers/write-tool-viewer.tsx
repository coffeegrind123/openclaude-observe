import { CodeViewer } from './code-viewer'

interface WriteToolViewerProps {
  filePath: string
  toolInput: Record<string, unknown>
  toolResponse: Record<string, unknown> | string | undefined
  relPath: (p: string) => string
}

function isNewFile(toolResponse: WriteToolViewerProps['toolResponse']): boolean {
  if (!toolResponse || typeof toolResponse === 'string') return false
  const r = toolResponse as Record<string, any>
  return r.type === 'create' || r.created === true
}

export function WriteToolViewer({
  filePath,
  toolInput,
  toolResponse,
  relPath,
}: WriteToolViewerProps) {
  const content = (toolInput.content as string) ?? ''
  const displayPath = relPath(filePath)
  const newFile = isNewFile(toolResponse)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate font-mono">{displayPath}</span>
      </div>
      <CodeViewer
        fileName={filePath}
        content={content}
        badge={newFile ? 'NEW FILE' : 'OVERWRITE'}
      />
    </div>
  )
}
