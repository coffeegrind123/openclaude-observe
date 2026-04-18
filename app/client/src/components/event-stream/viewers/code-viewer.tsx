import { useMemo, useState } from 'react'
import { Copy, Check, FileCode } from 'lucide-react'
import { highlight } from './syntax-highlight'
import './syntax-highlight.css'
import { detectLanguage, getBaseName } from './lang-detect'

interface CodeViewerProps {
  fileName?: string
  language?: string | null
  content: string
  startLine?: number
  maxHeight?: string
  badge?: string
}

export function CodeViewer({
  fileName,
  language,
  content,
  startLine = 1,
  maxHeight = 'max-h-96',
  badge,
}: CodeViewerProps) {
  const detected = language ?? detectLanguage(fileName)
  const [copied, setCopied] = useState(false)

  const highlighted = useMemo(() => highlight(content, detected), [content, detected])
  const lineCount = useMemo(() => content.split('\n').length, [content])
  const endLine = startLine + lineCount - 1

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard rejected; no-op
    }
  }

  return (
    <div className="overflow-hidden rounded border border-border bg-muted/40">
      <div className="flex items-center gap-2 px-2 py-1 bg-muted/60 border-b border-border">
        <FileCode className="h-3 w-3 text-muted-foreground shrink-0" />
        {fileName && (
          <span className="truncate font-mono text-[11px] text-foreground" title={fileName}>
            {getBaseName(fileName)}
          </span>
        )}
        {detected && (
          <span className="shrink-0 rounded bg-background/60 px-1 py-[1px] text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
            {detected}
          </span>
        )}
        {badge && (
          <span className="shrink-0 rounded bg-blue-500/15 px-1 py-[1px] text-[9px] font-medium text-blue-700 dark:text-blue-400">
            {badge}
          </span>
        )}
        <span className="shrink-0 text-[9px] text-muted-foreground tabular-nums">
          L{startLine}–{endLine}
        </span>
        <button
          type="button"
          onClick={copy}
          className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
          title="Copy content"
        >
          {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <div className={`overflow-auto font-mono text-[11px] leading-[1.45] ${maxHeight}`}>
        <pre className="inline-block min-w-full p-0 m-0">
          <code>
            <HighlightedLines html={highlighted} startLine={startLine} />
          </code>
        </pre>
      </div>
    </div>
  )
}

function HighlightedLines({ html, startLine }: { html: string; startLine: number }) {
  const lines = useMemo(() => html.split('\n'), [html])
  // Pad the gutter to the widest line number.
  const gutterWidth = String(startLine + lines.length - 1).length

  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="flex hover:bg-foreground/[0.03]">
          <span
            className="shrink-0 select-none px-2 py-0 text-right tabular-nums text-muted-foreground/60 border-r border-border/50 bg-muted/20"
            style={{ minWidth: `${gutterWidth + 2}ch` }}
          >
            {startLine + i}
          </span>
          <span
            className="flex-1 whitespace-pre px-2"
            // highlight.js returns HTML escaped + wrapped in <span class="hljs-..."> tokens.
            dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }}
          />
        </div>
      ))}
    </>
  )
}
