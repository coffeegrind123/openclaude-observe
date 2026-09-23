import { useMemo } from 'react'
import { Gauge } from 'lucide-react'
import { useStackStore } from '@/stores/stack-store'
import { useStackMetrics } from '@/hooks/use-stack-metrics'
import {
  contextLevel,
  formatRatio,
  latestContext,
  weightedAcceptance,
  weightedDecodeTps,
} from '@/lib/stack-format'

// "Now" for the sidebar: the last minute. Longer and a finished burst keeps
// reading as live; shorter and a pause between turns reads as idle.
const LIVE_WINDOW_MS = 60_000

const DOT = { ok: 'bg-run', warn: 'bg-warn', critical: 'bg-fail' } as const

/** One-line live readout of the inference stack for the sidebar footer. */
export function StackStrip({ onOpen }: { onOpen: () => void }) {
  useStackMetrics()
  const status = useStackStore((s) => s.status)
  const samples = useStackStore((s) => s.samples)

  const live = useMemo(() => {
    const cutoff = (samples[samples.length - 1]?.at ?? 0) - LIVE_WINDOW_MS
    return samples.filter((s) => s.at >= cutoff)
  }, [samples])

  if (status.state === 'disabled') {
    return null
  }

  const tps = weightedDecodeTps(live)
  const acceptance = weightedAcceptance(live)
  const context = latestContext(samples)
  const unreachable = status.state === 'unreachable'
  const stalled = status.state === 'stalled'

  return (
    <button
      type="button"
      onClick={onOpen}
      title={
        unreachable || stalled
          ? `llama ${status.state}: ${status.lastError ?? ''}`
          : 'Inference stack'
      }
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-ink-2 hover:bg-accent"
    >
      <Gauge
        className={`h-3.5 w-3.5 shrink-0 ${unreachable ? 'text-fail' : stalled ? 'text-warn' : 'text-ink-3'}`}
        aria-hidden
      />
      {unreachable || stalled ? (
        <span className="truncate">
          {unreachable ? 'Stack unreachable' : 'llama queue stalled'}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 tabular-nums">
          <span className="truncate">{tps === null ? 'idle' : `${tps.toFixed(0)} t/s`}</span>
          {acceptance !== null && (
            <span className="text-ink-3">draft {formatRatio(acceptance)}</span>
          )}
          {context && (
            <span className="ml-auto inline-flex items-center gap-1 text-ink-3">
              <span
                className={`h-1.5 w-1.5 rounded-full ${DOT[contextLevel(context.percent)]}`}
                aria-hidden
              />
              ctx {Math.round(context.percent)}%
            </span>
          )}
        </span>
      )}
    </button>
  )
}
