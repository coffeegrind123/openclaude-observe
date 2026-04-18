import { useEffect, useRef, useState } from 'react'
import { GitBranch, AlertCircle } from 'lucide-react'

// mermaid is heavyweight (~900kb gz). Lazy-load it once on first render.
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const inst = m.default
      inst.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
      })
      return inst
    })
  }
  return mermaidPromise
}

let idCounter = 0
function nextId() {
  return `mermaid-${Date.now().toString(36)}-${(idCounter++).toString(36)}`
}

interface MermaidViewerProps {
  source: string
  maxHeight?: string
}

export function MermaidViewer({ source, maxHeight = 'max-h-[500px]' }: MermaidViewerProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef(nextId())

  useEffect(() => {
    let cancelled = false
    setError(null)
    setSvg(null)
    loadMermaid()
      .then(async (mermaid) => {
        try {
          const { svg } = await mermaid.render(idRef.current, source)
          if (!cancelled) setSvg(svg)
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load mermaid')
      })
    return () => {
      cancelled = true
    }
  }, [source])

  return (
    <div className="overflow-hidden rounded border border-border bg-muted/40">
      <div className="flex items-center gap-2 px-2 py-1 bg-muted/60 border-b border-border">
        <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="font-mono text-[11px] text-foreground">mermaid</span>
        {error && (
          <span className="ml-auto flex items-center gap-1 text-[9px] text-red-500">
            <AlertCircle className="h-2.5 w-2.5" />
            render failed
          </span>
        )}
      </div>
      <div
        className={`overflow-auto ${maxHeight} p-3 flex items-start justify-center bg-background/30`}
      >
        {error ? (
          <pre className="text-[11px] font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap">
            {error}
          </pre>
        ) : svg ? (
          <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className="text-[11px] text-muted-foreground">Rendering…</span>
        )}
      </div>
    </div>
  )
}

// Detect a mermaid code fence inside a markdown-ish string. Returns the source
// of the first fence if found.
const MERMAID_FENCE = /```mermaid\n([\s\S]*?)```/m

export function extractMermaid(markdown: string): string | null {
  const m = MERMAID_FENCE.exec(markdown)
  return m ? m[1] : null
}
