import { CodeViewer } from './code-viewer'

interface WriteToolViewerProps {
  path: string
  displayPath: string
  content: string | null
  /** The tool's result text, e.g. "Successfully wrote to …". */
  resultText?: string | null
}

export function WriteToolViewer({ path, displayPath, content, resultText }: WriteToolViewerProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate font-mono">{displayPath}</span>
        {content != null && (
          <span className="shrink-0 rounded bg-muted/50 px-1 py-[1px]">
            {content.length.toLocaleString()} chars
          </span>
        )}
      </div>
      {content == null ? (
        <div className="text-[11px] italic text-muted-foreground/70">No content captured.</div>
      ) : (
        <CodeViewer fileName={path} content={content} />
      )}
      {resultText && (
        <div className="font-mono text-[10px] text-muted-foreground">{resultText}</div>
      )}
    </div>
  )
}
