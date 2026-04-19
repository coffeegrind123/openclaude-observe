import { useMemo, useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { ChatMarkdown } from '@/components/chat-feed/chat-markdown'

interface ThinkingBlockProps {
  /**
   * Raw extended-thinking text captured by OpenClaude's ClaudeObserveExporter
   * from response blocks of type 'thinking'. Multiple passes within a single
   * LLM call are joined by `\n\n---\n\n` on the sender side.
   *
   * Currently carried on `payload.thinking_preview` (capped at 4kb). The full
   * thinking stream is only available when `OTEL_LOG_RAW_API_BODIES=1` is set
   * on the OpenClaude side — in that case `payload.llm_response_body` has
   * the untruncated content.
   */
  thinkingText: string
  defaultOpen?: boolean
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function truncatedFirstLine(text: string, max = 140): string {
  const firstParagraph = text.split('\n\n')[0]
  if (firstParagraph.length <= max) return firstParagraph.replace(/\s+/g, ' ').trim()
  return (
    firstParagraph
      .slice(0, max - 1)
      .replace(/\s+/g, ' ')
      .trim() + '…'
  )
}

export function ThinkingBlock({ thinkingText, defaultOpen = false }: ThinkingBlockProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)

  const passes = useMemo(
    () => thinkingText.split(/\n\n---\n\n/).filter((s) => s.trim().length > 0),
    [thinkingText],
  )
  const tokens = estimateTokens(thinkingText)
  const preview = truncatedFirstLine(thinkingText)

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(thinkingText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <div className="overflow-hidden rounded border border-purple-500/40 bg-purple-500/[0.06] dark:bg-purple-500/[0.09]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-purple-500/[0.08] transition-colors cursor-pointer"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-purple-600 dark:text-purple-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-purple-600 dark:text-purple-400 shrink-0" />
        )}
        <Brain className="h-3 w-3 text-purple-600 dark:text-purple-400 shrink-0" />
        <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300 shrink-0">
          Thinking
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
          ~{tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tok
        </span>
        {passes.length > 1 && (
          <span className="text-[9px] text-muted-foreground shrink-0">
            · {passes.length} passes
          </span>
        )}
        {!open && (
          <span className="text-[10px] text-muted-foreground/80 truncate flex-1 min-w-0 italic">
            {preview}
          </span>
        )}
        <span
          onClick={copy}
          className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer select-none"
          title="Copy thinking"
        >
          {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2 pt-1 border-t border-purple-500/30 text-[11px] text-foreground/90 max-h-[400px] overflow-auto">
          {passes.length === 1 ? (
            <ChatMarkdown text={passes[0]} />
          ) : (
            passes.map((pass, i) => (
              <div key={i} className={i > 0 ? 'mt-3 pt-3 border-t border-purple-500/20' : ''}>
                <div className="text-[9px] uppercase tracking-wider text-purple-600/70 dark:text-purple-400/70 mb-1">
                  Pass {i + 1}
                </div>
                <ChatMarkdown text={pass} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
