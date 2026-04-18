import { useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'

interface GrepToolViewerProps {
  toolInput: Record<string, unknown>
  toolResponse: Record<string, unknown> | string | undefined
  relPath: (p: string) => string
}

interface GrepHit {
  file: string
  line: number
  content: string
}

// Parse ripgrep-style output ("path:line:content") into structured hits.
// Leaves unrecognized lines alone (rendered as-is).
function parseGrepOutput(raw: string): { hits: GrepHit[]; remainder: string[] } {
  const hits: GrepHit[] = []
  const remainder: string[] = []
  const lineRe = /^(.+?):(\d+):(.*)$/
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const m = lineRe.exec(line)
    if (m) {
      hits.push({ file: m[1], line: parseInt(m[2], 10), content: m[3] })
    } else {
      remainder.push(line)
    }
  }
  return { hits, remainder }
}

// Extract the raw text output from the Grep tool_response
function extractOutput(toolResponse: GrepToolViewerProps['toolResponse']): string {
  if (!toolResponse) return ''
  if (typeof toolResponse === 'string') return toolResponse
  const r = toolResponse as Record<string, any>
  if (typeof r.content === 'string') return r.content
  if (Array.isArray(r.content)) {
    return r.content
      .map((c: unknown) => (typeof c === 'string' ? c : ((c as any)?.text ?? '')))
      .join('\n')
  }
  if (typeof r.output === 'string') return r.output
  return ''
}

const HITS_COLLAPSED = 20

export function GrepToolViewer({ toolInput, toolResponse, relPath }: GrepToolViewerProps) {
  const pattern = (toolInput.pattern as string) || ''
  const path = toolInput.path as string | undefined
  const glob = toolInput.glob as string | undefined
  const type = toolInput.type as string | undefined
  const outputMode = (toolInput.output_mode as string) || 'files_with_matches'
  const caseInsensitive = toolInput['-i'] === true

  const raw = extractOutput(toolResponse)
  const parsed = useMemo(() => parseGrepOutput(raw), [raw])
  const [expanded, setExpanded] = useState(false)

  const hitsToShow = expanded ? parsed.hits : parsed.hits.slice(0, HITS_COLLAPSED)
  const canCollapse = parsed.hits.length > HITS_COLLAPSED

  // Build regex to highlight matches in content-mode results. Tolerate invalid regex.
  const highlightRe = useMemo(() => {
    if (!pattern || outputMode !== 'content') return null
    try {
      return new RegExp(pattern, caseInsensitive ? 'gi' : 'g')
    } catch {
      return null
    }
  }, [pattern, caseInsensitive, outputMode])

  return (
    <div className="overflow-hidden rounded border border-border bg-muted/40">
      <div className="flex items-center gap-2 px-2 py-1 bg-muted/60 border-b border-border">
        <Search className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="font-mono text-[11px] text-foreground truncate">/{pattern}/</span>
        {caseInsensitive && (
          <span className="shrink-0 rounded bg-background/60 px-1 py-[1px] text-[9px] uppercase tracking-wide text-muted-foreground">
            i
          </span>
        )}
        <span className="shrink-0 rounded bg-background/60 px-1 py-[1px] text-[9px] text-muted-foreground">
          {outputMode}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {parsed.hits.length > 0
            ? `${parsed.hits.length} match${parsed.hits.length === 1 ? '' : 'es'}`
            : parsed.remainder.length > 0
              ? `${parsed.remainder.length} line${parsed.remainder.length === 1 ? '' : 's'}`
              : 'no matches'}
        </span>
      </div>
      <div className="px-2 py-1 border-b border-border/60 flex gap-3 text-[10px] text-muted-foreground font-mono">
        {path && <span>path: {relPath(path)}</span>}
        {glob && <span>glob: {glob}</span>}
        {type && <span>type: {type}</span>}
      </div>
      <div className="max-h-96 overflow-auto font-mono text-[11px]">
        {hitsToShow.length > 0 &&
          hitsToShow.map((hit, i) => (
            <HitRow key={i} hit={hit} relPath={relPath} highlightRe={highlightRe} />
          ))}
        {canCollapse && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-2 py-1 border-t border-border/50 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full"
          >
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            {expanded ? 'collapse' : `show ${parsed.hits.length - HITS_COLLAPSED} more`}
          </button>
        )}
        {parsed.remainder.length > 0 && (
          <div className="border-t border-border/50 px-2 py-1 whitespace-pre-wrap text-muted-foreground/80">
            {parsed.remainder.join('\n')}
          </div>
        )}
        {parsed.hits.length === 0 && parsed.remainder.length === 0 && (
          <div className="px-2 py-2 text-[11px] italic text-muted-foreground/70">
            No output captured.
          </div>
        )}
      </div>
    </div>
  )
}

function HitRow({
  hit,
  relPath,
  highlightRe,
}: {
  hit: GrepHit
  relPath: (p: string) => string
  highlightRe: RegExp | null
}) {
  // Split content on regex matches so we can wrap hits in a highlighted span.
  const parts = useMemo(() => {
    if (!highlightRe) return [{ text: hit.content, hit: false }]
    const out: { text: string; hit: boolean }[] = []
    let lastIdx = 0
    const re = new RegExp(highlightRe.source, highlightRe.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(hit.content))) {
      if (m.index > lastIdx) out.push({ text: hit.content.slice(lastIdx, m.index), hit: false })
      out.push({ text: m[0], hit: true })
      lastIdx = m.index + m[0].length
      if (m[0].length === 0) re.lastIndex++
    }
    if (lastIdx < hit.content.length) out.push({ text: hit.content.slice(lastIdx), hit: false })
    return out
  }, [hit.content, highlightRe])

  return (
    <div className="flex gap-2 px-2 py-0.5 border-b border-border/30 hover:bg-foreground/[0.03]">
      <span className="shrink-0 text-blue-600 dark:text-blue-400 truncate max-w-[40%]">
        {relPath(hit.file)}
      </span>
      <span className="shrink-0 text-muted-foreground/60 tabular-nums">:{hit.line}</span>
      <span className="flex-1 whitespace-pre text-foreground/80 min-w-0 overflow-hidden">
        {parts.map((p, i) =>
          p.hit ? (
            <span key={i} className="bg-yellow-500/30 text-foreground rounded px-[1px]">
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </span>
    </div>
  )
}
