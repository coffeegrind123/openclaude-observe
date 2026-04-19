import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, ChevronDown } from 'lucide-react'
import { api } from '@/lib/api-client'
import {
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  CATEGORY_TEXT_COLORS,
  type ContextCategory,
  type TurnAttribution,
} from '@/types/context'

function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

interface ContextBadgeProps {
  sessionId: string
  llmEventId: number
}

export function ContextBadge({ sessionId, llmEventId }: ContextBadgeProps) {
  const { data } = useQuery({
    queryKey: ['context', sessionId],
    queryFn: () => api.getSessionContext(sessionId),
    staleTime: 5_000,
  })

  const turn = useMemo(
    () => data?.turns.find((t) => t.llmEventId === llmEventId),
    [data, llmEventId],
  )

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  // Recompute the popover's absolute position whenever it opens. Using a
  // portal with viewport coordinates keeps the popover outside the event
  // row's <button> ancestry (so nested-button click swallowing doesn't
  // apply) and sidesteps clipping from `overflow: hidden` ancestors.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPosition({ top: rect.bottom + 4, left: rect.left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!turn) return null

  const displayTokens = turn.inputTokens > 0 ? turn.inputTokens : turn.estimatedTokens
  if (displayTokens === 0) return null

  // Trigger is a <span role="button"> (not a real <button>) because this
  // badge appears inside the event row's outer <button>. Nested native
  // buttons are invalid HTML — browsers collapse them and the inner click
  // never fires. The popover itself is portalled to document.body for the
  // same reason (its internal CategoryRow uses real <button>s).
  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            setOpen((v) => !v)
          }
        }}
        className="inline-flex items-center gap-1 rounded bg-muted/60 hover:bg-muted border border-border px-1.5 py-[1px] text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
        title="Context breakdown"
      >
        <BarChart3 className="h-2.5 w-2.5" />
        {formatTokens(displayTokens)} ctx
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </span>

      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ top: position.top, left: position.left }}
            className="fixed z-[1000] min-w-[320px] rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
            role="dialog"
          >
            <ContextPopover turn={turn} />
          </div>,
          document.body,
        )}
    </>
  )
}

function ContextPopover({ turn }: { turn: TurnAttribution }) {
  // Pick the total to render against. Prefer the authoritative input_tokens
  // from the LLM call; fall back to the summed estimate when cache hit == 100%
  // (i.e. input_tokens reads as 0).
  const total = turn.inputTokens > 0 ? turn.inputTokens : Math.max(turn.estimatedTokens, 1)
  const sorted = [...turn.buckets].sort((a, b) => b.tokens - a.tokens)

  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-start gap-2 pb-2 border-b border-border">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Context at this turn
          </div>
          <div className="text-sm font-semibold tabular-nums">
            {turn.inputTokens > 0
              ? turn.inputTokens.toLocaleString()
              : `~${turn.estimatedTokens.toLocaleString()}`}{' '}
            tokens
          </div>
          {turn.cacheReadTokens > 0 && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              cache read: {formatTokens(turn.cacheReadTokens)}
              {turn.cacheCreationTokens > 0 &&
                ` · cache create: ${formatTokens(turn.cacheCreationTokens)}`}
            </div>
          )}
          {turn.inputTokens > 0 && turn.estimatedTokens > 0 && (
            <div className="text-[9px] text-muted-foreground/70 mt-0.5">
              categorized: ~{formatTokens(turn.estimatedTokens)} (
              {Math.round((turn.estimatedTokens / turn.inputTokens) * 100)}%)
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {sorted.map((b) => {
          if (b.tokens === 0) return null
          const denom = total > 0 ? total : 1
          const pct = Math.min(100, (b.tokens / denom) * 100)
          return (
            <CategoryRow
              key={b.category}
              category={b.category}
              tokens={b.tokens}
              pct={pct}
              sources={b.sources}
            />
          )
        })}
        {sorted.every((b) => b.tokens === 0) && (
          <div className="text-[11px] text-muted-foreground italic">
            No categorizable events prior to this turn.
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryRow({
  category,
  tokens,
  pct,
  sources,
}: {
  category: ContextCategory
  tokens: number
  pct: number
  sources: { eventId: number; description: string; tokens: number; scope?: string }[]
}) {
  const [expanded, setExpanded] = useState(false)
  const barColor = CATEGORY_COLORS[category]
  const textColor = CATEGORY_TEXT_COLORS[category]
  const label = CATEGORY_LABELS[category]

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-[11px] hover:bg-muted/40 rounded px-1 py-0.5 cursor-pointer"
      >
        <span className={`w-[86px] shrink-0 font-medium text-left ${textColor}`}>{label}</span>
        <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor} opacity-70`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-12 text-right tabular-nums text-muted-foreground shrink-0">
          {formatTokens(tokens)}
        </span>
        <span className="w-10 text-right tabular-nums text-muted-foreground/70 shrink-0 text-[10px]">
          {pct.toFixed(0)}%
        </span>
      </button>
      {expanded && sources.length > 0 && (
        <div className="pl-[92px] pr-1 py-1 space-y-0.5 text-[10px] text-muted-foreground">
          {sources.slice(0, 10).map((s, i) => (
            <div key={`${s.eventId}-${i}`} className="flex gap-2">
              <span className="truncate flex-1" title={s.description}>
                {s.scope && <span className="text-muted-foreground/60">[{s.scope}] </span>}
                {s.description || '(no description)'}
              </span>
              <span className="tabular-nums shrink-0">{formatTokens(s.tokens)}</span>
            </div>
          ))}
          {sources.length > 10 && (
            <div className="text-muted-foreground/50">… {sources.length - 10} more</div>
          )}
        </div>
      )}
    </div>
  )
}
