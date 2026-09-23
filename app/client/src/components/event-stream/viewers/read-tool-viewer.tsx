import { useState, useMemo } from 'react'
import { CodeViewer } from './code-viewer'
import { MermaidViewer, extractMermaid } from './mermaid-viewer'
import { ChatMarkdown } from '@/components/chat-feed/chat-markdown'
import { Code, FileText } from 'lucide-react'

interface ReadToolViewerProps {
  /** Path as the tool was called with it (used for language detection). */
  path: string
  /** Path for display (relative to cwd when possible). */
  displayPath: string
  offset?: number
  limit?: number
  /** File content returned by the tool; null when nothing was captured. */
  content: string | null
  /** Tool's continuation / truncation notice, shown under the content. */
  notice?: string | null
}

export function ReadToolViewer({
  path,
  displayPath,
  offset,
  limit,
  content,
  notice,
}: ReadToolViewerProps) {
  const isMarkdown = /\.(mdx?|markdown)$/i.test(path)
  const [viewMode, setViewMode] = useState<'code' | 'markdown'>(isMarkdown ? 'markdown' : 'code')

  const mermaidSource = useMemo(() => {
    if (content == null || !isMarkdown) {
      return null
    }
    return extractMermaid(content)
  }, [content, isMarkdown])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate font-mono">{displayPath}</span>
        {(offset != null || limit != null) && (
          <span className="shrink-0 rounded bg-muted/50 px-1 py-[1px]">
            {offset != null ? `offset ${offset}` : 'offset 1'}
            {limit != null ? ` · limit ${limit}` : ''}
          </span>
        )}
        {isMarkdown && content != null && (
          <div className="ml-auto flex items-center gap-0.5 text-[9px]">
            <ModeButton
              active={viewMode === 'code'}
              onClick={() => setViewMode('code')}
              icon={<Code className="h-2.5 w-2.5" />}
              label="code"
            />
            <ModeButton
              active={viewMode === 'markdown'}
              onClick={() => setViewMode('markdown')}
              icon={<FileText className="h-2.5 w-2.5" />}
              label="preview"
            />
          </div>
        )}
      </div>

      {content == null ? (
        <div className="text-[11px] italic text-muted-foreground/70">
          No content captured for this read.
        </div>
      ) : viewMode === 'markdown' && isMarkdown ? (
        <div className="space-y-2">
          {mermaidSource && <MermaidViewer source={mermaidSource} />}
          <div className="max-h-96 overflow-auto rounded border border-border bg-muted/40 p-3 text-[11px]">
            <ChatMarkdown text={content} />
          </div>
        </div>
      ) : (
        <CodeViewer fileName={path} content={content} startLine={offset ?? 1} />
      )}

      {notice && <div className="font-mono text-[10px] text-muted-foreground">{notice}</div>}
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-0.5 rounded border px-1.5 py-[2px] transition-colors ${
        active
          ? 'border-border bg-muted text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon} {label}
    </button>
  )
}
