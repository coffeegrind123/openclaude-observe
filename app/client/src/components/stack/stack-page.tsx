import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, Table2, LineChart } from 'lucide-react'
import { useStackStore } from '@/stores/stack-store'
import { useStackMetrics } from '@/hooks/use-stack-metrics'
import {
  compactTokens,
  formatRatio,
  formatTps,
  latestContext,
  weightedAcceptance,
  weightedDecodeTps,
} from '@/lib/stack-format'
import { TimeSeriesChart, type TimePoint } from './time-series-chart'
import { ContextMeter } from './context-meter'
import { AcceptanceByPosition } from './acceptance-by-position'
import type { StackSample, StackStatus } from '@/types/stack'

// Headline figures summarise the last few minutes, not the hour: "how fast is
// it right now" is the question the tiles answer.
const RECENT_WINDOW_MS = 5 * 60_000
const TABLE_ROWS = 60

function StatusLine({ status }: { status: StackStatus }) {
  if (status.state === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-2">
        <CheckCircle2 className="h-3.5 w-3.5 text-run" aria-hidden />
        Connected to {status.llamaUrl}
        {status.restarts ? ` · llama restarted ${status.restarts}× since observe started` : ''}
      </span>
    )
  }
  if (status.state === 'stalled') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-2">
        <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden />
        Stalled: {status.llamaUrl} — {status.lastError}
      </span>
    )
  }
  if (status.state === 'unreachable') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-2">
        <AlertTriangle className="h-3.5 w-3.5 text-fail" aria-hidden />
        Unreachable: {status.llamaUrl} — {status.lastError}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-2">
      <CircleDashed className="h-3.5 w-3.5 text-ink-3" aria-hidden />
      {status.state === 'disabled' ? 'Polling is disabled (INSTANTCOFFEE_OBSERVE_STACK_POLL_MS=0)' : 'Connecting…'}
    </span>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-rule bg-card px-3 py-2">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
      {note && <div className="truncate text-[10px] text-ink-3">{note}</div>}
    </div>
  )
}

function series(samples: StackSample[], pick: (s: StackSample) => number | null): TimePoint[] {
  return samples.map((s) => ({ at: s.at, value: pick(s) }))
}

function SampleTable({ samples }: { samples: StackSample[] }) {
  const rows = samples.slice(-TABLE_ROWS).reverse()
  return (
    <div className="overflow-x-auto rounded-md border border-rule">
      <table className="w-full text-[11px] tabular-nums">
        <thead className="bg-paper-2 text-ink-2">
          <tr>
            {['Time', 'Decode', 'Prefill', 'Generated', 'Prefilled', 'Cached', 'Acceptance', 'Tok/draft', 'Context'].map(
              (h) => (
                <th key={h} scope="col" className="px-2 py-1 text-left font-medium">
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.at} className="border-t border-rule">
              <td className="px-2 py-1">{new Date(s.at).toLocaleTimeString()}</td>
              <td className="px-2 py-1">{formatTps(s.decodeTps)}</td>
              <td className="px-2 py-1">{formatTps(s.prefillTps)}</td>
              <td className="px-2 py-1">{s.generatedTokens.toLocaleString()}</td>
              <td className="px-2 py-1">{s.prefillTokens.toLocaleString()}</td>
              <td className="px-2 py-1">{s.cachedTokens.toLocaleString()}</td>
              <td className="px-2 py-1">{formatRatio(s.acceptance)}</td>
              <td className="px-2 py-1">{s.acceptedPerDraft === null ? '—' : s.acceptedPerDraft.toFixed(2)}</td>
              <td className="px-2 py-1">{s.context ? `${Math.round(s.context.percent)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The inference stack behind pi — llama-server and forge — as the observe
 * server sees it. pi's own events never carry these numbers (forge drops
 * llama's per-request timings), so this page is the only place decode speed
 * and speculative-decoding acceptance show up.
 */
export function StackPage() {
  useStackMetrics()
  const status = useStackStore((s) => s.status)
  const samples = useStackStore((s) => s.samples)
  const totals = useStackStore((s) => s.totals)
  const [tableView, setTableView] = useState(false)

  const recent = useMemo(() => {
    const cutoff = (samples[samples.length - 1]?.at ?? 0) - RECENT_WINDOW_MS
    return samples.filter((s) => s.at >= cutoff)
  }, [samples])
  const context = latestContext(samples)

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Inference stack</h1>
            <StatusLine status={status} />
          </div>
          <button
            type="button"
            onClick={() => setTableView((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-rule px-2.5 py-1 text-[12px] text-ink-2 hover:bg-accent"
            aria-pressed={tableView}
          >
            {tableView ? <LineChart className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
            {tableView ? 'Charts' : 'Table'}
          </button>
        </header>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Last five minutes">
          <Tile
            label="Decode speed"
            value={formatTps(weightedDecodeTps(recent))}
            note={`lifetime ${formatTps(totals?.decodeTps)}`}
          />
          <Tile label="Prefill speed" value={formatTps(recent.at(-1)?.prefillTps ?? totals?.prefillTps)} note={`lifetime ${formatTps(totals?.prefillTps)}`} />
          <Tile
            label="Draft acceptance"
            value={formatRatio(weightedAcceptance(recent) ?? totals?.acceptance)}
            note={totals?.acceptedPerDraft ? `${totals.acceptedPerDraft.toFixed(2)} tokens per draft` : undefined}
          />
          <Tile
            label="Prompt cache reuse"
            value={formatRatio(totals?.cacheReuse)}
            note={totals ? `${compactTokens(totals.cachedTokens)} of ${compactTokens(totals.cachedTokens + totals.prefillTokens)} tokens` : undefined}
          />
          <ContextMeter context={context} />
        </section>

        {tableView ? (
          <SampleTable samples={samples} />
        ) : (
          <>
            <section className="grid gap-5 md:grid-cols-2">
              <TimeSeriesChart
                title="Decode speed"
                subtitle="tokens/s while generating"
                points={series(samples, (s) => s.decodeTps)}
                format={(v) => `${Math.round(v)}`}
              />
              <TimeSeriesChart
                title="Prefill speed"
                subtitle="prompt tokens/s, cache hits excluded"
                points={series(samples, (s) => s.prefillTps)}
                format={(v) => compactTokens(v)}
              />
              <TimeSeriesChart
                title="Draft acceptance"
                subtitle="% of drafted tokens accepted"
                points={series(samples, (s) => (s.acceptance === null ? null : s.acceptance * 100))}
                format={(v) => `${Math.round(v)}%`}
                yMax={100}
              />
              <TimeSeriesChart
                title="Context fill"
                subtitle="forge's view of the live session"
                points={series(samples, (s) => (s.context ? s.context.percent : null))}
                format={(v) => `${Math.round(v)}%`}
                yMax={100}
              />
            </section>
            <AcceptanceByPosition totals={totals} />
          </>
        )}
      </div>
    </div>
  )
}
