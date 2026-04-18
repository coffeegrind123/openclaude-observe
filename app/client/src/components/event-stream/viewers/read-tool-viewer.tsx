import { useState, useMemo } from 'react'
import { CodeViewer } from './code-viewer'
import { MermaidViewer, extractMermaid } from './mermaid-viewer'
import { ChatMarkdown } from '@/components/chat-feed/chat-markdown'
import { Code, FileText } from 'lucide-react'

interface ReadToolViewerProps {
  filePath: string
  toolInput: Record<string, unknown>
  toolResponse: Record<string, unknown> | string | undefined
  relPath: (p: string) => string
}

// Extracts the actual file content from whatever tool_response shape OpenClaude
// sends — the payload is either { file: { content, startLine, numLines } },
// { content: string }, or a plain string. Returns null if nothing usable.
function extractFileContent(
  toolResponse: ReadToolViewerProps['toolResponse'],
): { content: string; startLine: number; numLines?: number } | null {
  if (!toolResponse) return null
  if (typeof toolResponse === 'string') {
    return { content: toolResponse, startLine: 1 }
  }
  const r = toolResponse as Record<string, any>
  const file = r.file as Record<string, any> | undefined
  if (file?.content && typeof file.content === 'string') {
    return {
      content: file.content,
      startLine: typeof file.startLine === 'number' ? file.startLine : 1,
      numLines: typeof file.numLines === 'number' ? file.numLines : undefined,
    }
  }
  if (typeof r.content === 'string') {
    return { content: r.content, startLine: 1 }
  }
  return null
}

export function ReadToolViewer({
  filePath,
  toolInput,
  toolResponse,
  relPath,
}: ReadToolViewerProps) {
  const displayPath = relPath(filePath)
  const offset = toolInput.offset as number | undefined
  const limit = toolInput.limit as number | undefined
  const file = extractFileContent(toolResponse)

  const isMarkdown = /\.(mdx?|markdown)$/i.test(filePath)
  const [viewMode, setViewMode] = useState<'code' | 'markdown'>(isMarkdown ? 'markdown' : 'code')

  const startLine = file?.startLine ?? offset ?? 1

  const mermaidSource = useMemo(() => {
    if (!file || !isMarkdown) return null
    return extractMermaid(file.content)
  }, [file, isMarkdown])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
        <span className="truncate font-mono">{displayPath}</span>
        {offset != null && (
          <span className="shrink-0 rounded bg-muted/50 px-1 py-[1px]">
            line {offset}
            {limit ? `, limit ${limit}` : ''}
          </span>
        )}
        {isMarkdown && file && (
          <div className="ml-auto flex items-center gap-0.5 text-[9px]">
            <button
              type="button"
              onClick={() => setViewMode('code')}
              className={`flex items-center gap-0.5 px-1.5 py-[2px] rounded border transition-colors cursor-pointer ${
                viewMode === 'code'
                  ? 'bg-muted text-foreground border-border'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Code className="h-2.5 w-2.5" /> code
            </button>
            <button
              type="button"
              onClick={() => setViewMode('markdown')}
              className={`flex items-center gap-0.5 px-1.5 py-[2px] rounded border transition-colors cursor-pointer ${
                viewMode === 'markdown'
                  ? 'bg-muted text-foreground border-border'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="h-2.5 w-2.5" /> preview
            </button>
          </div>
        )}
      </div>

      {file ? (
        viewMode === 'markdown' && isMarkdown ? (
          <div className="space-y-2">
            {mermaidSource && <MermaidViewer source={mermaidSource} />}
            <div className="rounded border border-border bg-muted/40 p-3 overflow-auto max-h-96 text-[11px]">
              <ChatMarkdown text={file.content} />
            </div>
          </div>
        ) : (
          <CodeViewer fileName={filePath} content={file.content} startLine={startLine} />
        )
      ) : (
        <div className="text-[11px] italic text-muted-foreground/70">
          No content captured for this read.
        </div>
      )}
    </div>
  )
}
