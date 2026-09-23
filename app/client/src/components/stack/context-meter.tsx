import { AlertTriangle } from 'lucide-react'
import { compactTokens, contextLevel } from '@/lib/stack-format'
import type { ForgeUsage } from '@/types/stack'

const FILL = { ok: 'bg-run', warn: 'bg-warn', critical: 'bg-fail' } as const
const LABEL = { ok: '', warn: 'Compaction getting close', critical: 'Compaction imminent' } as const

/** Context fill as a meter; the fill color escalates with severity, never alone. */
export function ContextMeter({
  context,
  compact = false,
}: {
  context: ForgeUsage | null
  compact?: boolean
}) {
  if (!context) {
    return (
      <div className="min-w-0 rounded-md border border-rule bg-card px-3 py-2">
        <div className="text-[11px] text-ink-3">Context fill</div>
        <div className="text-xl font-semibold text-foreground">—</div>
        {!compact && <div className="text-[10px] text-ink-3">forge has not reported a session</div>}
      </div>
    )
  }

  const level = contextLevel(context.percent)
  const pct = Math.min(100, Math.max(0, context.percent))
  return (
    <div className="min-w-0 rounded-md border border-rule bg-card px-3 py-2">
      <div className="text-[11px] text-ink-3">Context fill</div>
      <div className="text-xl font-semibold text-foreground">{Math.round(pct)}%</div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-paper-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="Context fill"
      >
        <div className={`h-full rounded-full ${FILL[level]}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex items-center gap-1 truncate text-[10px] text-ink-3">
        {level !== 'ok' && <AlertTriangle className="h-3 w-3 shrink-0 text-warn" aria-hidden />}
        {level !== 'ok'
          ? LABEL[level]
          : `${compactTokens(context.currentTokens)} of ${compactTokens(context.contextWindow)}`}
      </div>
    </div>
  )
}
