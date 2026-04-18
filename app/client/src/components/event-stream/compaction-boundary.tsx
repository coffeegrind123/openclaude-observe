import { memo } from 'react'
import { Scissors, ArrowDown, Zap, User } from 'lucide-react'
import type { CompactionInfo } from '@/hooks/use-compactions'
import type { ParsedEvent } from '@/types'

interface CompactionBoundaryProps {
  event: ParsedEvent // the PreCompact or PostCompact event
  info: CompactionInfo | null
  variant: 'pre' | 'post'
}

function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}

export const CompactionBoundary = memo(function CompactionBoundary({
  event,
  info,
  variant,
}: CompactionBoundaryProps) {
  // The PreCompact row carries the headline card; PostCompact just shows a thin
  // closing rule so the pair reads as one unit.
  if (variant === 'post') {
    return (
      <div className="px-3 py-0.5 flex items-center gap-1.5 bg-amber-500/[0.07] dark:bg-amber-500/[0.12] border-y border-dashed border-amber-500/40">
        <div className="h-[1px] flex-1 bg-amber-500/30" />
        <span className="text-[9px] font-mono uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70">
          Compaction complete
        </span>
        <div className="h-[1px] flex-1 bg-amber-500/30" />
      </div>
    )
  }

  const trigger = info?.trigger ?? 'unknown'
  const tokensBefore = info?.tokensBefore ?? 0
  const tokensAfter = info?.tokensAfter ?? 0
  const tokensDropped = info?.tokensDropped ?? 0
  const reductionPct = tokensBefore > 0 ? Math.round((tokensDropped / tokensBefore) * 100) : 0

  const hasFlankingData = tokensBefore > 0 || tokensAfter > 0

  return (
    <div className="px-3 py-2 bg-amber-500/[0.07] dark:bg-amber-500/[0.12] border-y border-amber-500/40">
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex items-center justify-center h-7 w-7 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-400">
          <Scissors className="h-3.5 w-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-amber-900 dark:text-amber-300">
              Context compacted
            </span>
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-[1px] text-[9px] font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">
              {trigger === 'manual' ? (
                <User className="h-2.5 w-2.5" />
              ) : trigger === 'auto' ? (
                <Zap className="h-2.5 w-2.5" />
              ) : null}
              {trigger}
            </span>
            {!info?.postEventId && (
              <span className="text-[9px] text-muted-foreground italic">in progress…</span>
            )}
          </div>

          {hasFlankingData ? (
            <div className="mt-1 flex items-center gap-2 text-[11px] font-mono">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">before</span>
                <span className="text-foreground tabular-nums">{formatTokens(tokensBefore)}</span>
              </div>
              <ArrowDown className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">after</span>
                <span className="text-foreground tabular-nums">{formatTokens(tokensAfter)}</span>
              </div>
              {tokensDropped > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                    −{formatTokens(tokensDropped)} ({reductionPct}%)
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-muted-foreground italic">
              waiting for next LLM call to measure reduction…
            </div>
          )}

          {tokensBefore > 0 && tokensDropped > 0 && (
            <CompactionBar before={tokensBefore} after={tokensAfter} />
          )}

          {info?.compactSummary && (
            <div className="mt-1.5 text-[10px] text-muted-foreground line-clamp-2">
              {info.compactSummary}
            </div>
          )}
        </div>

        <span className="shrink-0 text-[9px] text-muted-foreground/60 tabular-nums">
          {new Date(event.timestamp).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      </div>
    </div>
  )
})

function CompactionBar({ before, after }: { before: number; after: number }) {
  const afterPct = before > 0 ? Math.min(100, (after / before) * 100) : 0
  return (
    <div className="mt-1.5">
      <div className="relative h-2 rounded-full bg-muted/50 overflow-hidden">
        {/* Full "before" bar (faded, represents what was discarded) */}
        <div
          className="absolute inset-y-0 left-0 bg-amber-500/40"
          style={{ width: '100%' }}
          title={`before: ${before.toLocaleString()}`}
        />
        {/* "After" portion (solid, represents what remains) */}
        <div
          className="absolute inset-y-0 left-0 bg-emerald-500/80"
          style={{ width: `${afterPct}%` }}
          title={`after: ${after.toLocaleString()}`}
        />
      </div>
    </div>
  )
}
