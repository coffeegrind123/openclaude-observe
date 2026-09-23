// app/server/src/services/stack-metrics.ts
// Polls the instantcoffee inference stack — llama-server's Prometheus
// /metrics and forge's /forge/usage — and turns llama's server-wide
// cumulative counters into per-interval rates. pi never sees these numbers:
// forge rebuilds the usage block and drops llama's per-request `timings`, so
// this is the only place decode speed and speculative-decoding acceptance
// surface.
//
// Counter semantics (verified against llama.cpp b11118 server-task.cpp):
//   prompt_tokens_total         prompt tokens processed, EXCLUDING cache hits
//   prompt_tokens_cached_total  prompt tokens reused from the KV cache
//   *_seconds_total             busy time only, so Δtokens/Δseconds is the
//                               real decode/prefill speed, not a wall average
//
// Every counter resets when llama-server restarts. The `Process-Start-Time-
// Unix` response header changes on restart (its value is not a Unix time —
// treat it as an opaque token), so a changed token, or any counter going
// backwards, starts a fresh baseline instead of producing a negative rate.

export const METRIC_PREFIX = 'llamacpp:'
export const RESTART_HEADER = 'process-start-time-unix'

export interface LlamaSnapshot {
  at: number
  restartToken: string | null
  counters: Record<string, number>
  // Accepted draft tokens by draft position — how deep drafts survive.
  acceptedPerPos: number[]
}

export interface ForgeUsage {
  currentTokens: number
  contextWindow: number
  percent: number
  model: string | null
}

export interface StackSample {
  at: number
  intervalMs: number
  // Rates over the interval; null when the stack was idle for the whole of it.
  decodeTps: number | null
  prefillTps: number | null
  acceptance: number | null
  acceptedPerDraft: number | null
  cacheReuse: number | null
  // Raw interval deltas.
  generatedTokens: number
  prefillTokens: number
  cachedTokens: number
  draftTokens: number
  acceptedTokens: number
  drafts: number
  // Gauges at sample time.
  requestsProcessing: number
  requestsDeferred: number
  context: ForgeUsage | null
}

// Lifetime figures since llama-server last started.
export interface StackTotals {
  generatedTokens: number
  prefillTokens: number
  cachedTokens: number
  drafts: number
  draftTokens: number
  acceptance: number | null
  acceptedPerDraft: number | null
  cacheReuse: number | null
  decodeTps: number | null
  prefillTps: number | null
  acceptedPerPos: number[]
}

// 'stalled': llama answered the connection but not /metrics in time. /metrics
// goes through llama's task queue, so this is a busy or wedged queue — the
// server is up. 'unreachable': no connection at all.
export type StackState = 'disabled' | 'starting' | 'ok' | 'stalled' | 'unreachable'

export interface StackStatus {
  state: StackState
  llamaUrl: string
  forgeUrl: string
  pollMs: number
  lastOkAt: number | null
  lastError: string | null
  restarts: number
}

export interface StackMetricsView {
  status: StackStatus
  latest: StackSample | null
  totals: StackTotals | null
  samples: StackSample[]
}

const LABELLED_POS = /^llamacpp:spec_decode_num_accepted_tokens_per_pos_total\{position="(\d+)"\}$/

/** Parse llama.cpp's Prometheus text exposition into a snapshot. */
export function parseLlamaMetrics(
  text: string,
  restartToken: string | null,
  at: number,
): LlamaSnapshot {
  const counters: Record<string, number> = {}
  const acceptedPerPos: number[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const space = line.lastIndexOf(' ')
    if (space < 0) {
      continue
    }
    const name = line.slice(0, space)
    const value = Number(line.slice(space + 1))
    if (!Number.isFinite(value)) {
      continue
    }

    const pos = LABELLED_POS.exec(name)
    if (pos) {
      acceptedPerPos[Number(pos[1])] = value
      continue
    }
    if (name.startsWith(METRIC_PREFIX) && !name.includes('{')) {
      counters[name.slice(METRIC_PREFIX.length)] = value
    }
  }

  for (let i = 0; i < acceptedPerPos.length; i++) {
    acceptedPerPos[i] ??= 0
  }
  return { at, restartToken, counters, acceptedPerPos }
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null
}

function counter(s: LlamaSnapshot, name: string): number {
  return s.counters[name] ?? 0
}

const MONOTONIC = [
  'prompt_tokens_total',
  'prompt_tokens_cached_total',
  'prompt_seconds_total',
  'tokens_predicted_total',
  'tokens_predicted_seconds_total',
  'spec_decode_num_draft_tokens_total',
  'spec_decode_num_accepted_tokens_total',
  'spec_decode_num_drafts_total',
]

/** True when `cur` cannot be diffed against `prev` (llama restarted). */
export function isReset(prev: LlamaSnapshot, cur: LlamaSnapshot): boolean {
  if (prev.restartToken !== null && cur.restartToken !== null) {
    if (prev.restartToken !== cur.restartToken) {
      return true
    }
  }
  return MONOTONIC.some((m) => counter(cur, m) < counter(prev, m))
}

/** Rates and deltas between two snapshots from the same llama process. */
export function diffSnapshots(
  prev: LlamaSnapshot,
  cur: LlamaSnapshot,
  context: ForgeUsage | null,
): StackSample {
  const d = (name: string) => counter(cur, name) - counter(prev, name)

  const generated = d('tokens_predicted_total')
  const prefill = d('prompt_tokens_total')
  const cached = d('prompt_tokens_cached_total')
  const draft = d('spec_decode_num_draft_tokens_total')
  const accepted = d('spec_decode_num_accepted_tokens_total')
  const drafts = d('spec_decode_num_drafts_total')

  return {
    at: cur.at,
    intervalMs: cur.at - prev.at,
    decodeTps: ratio(generated, d('tokens_predicted_seconds_total')),
    prefillTps: ratio(prefill, d('prompt_seconds_total')),
    acceptance: ratio(accepted, draft),
    acceptedPerDraft: ratio(accepted, drafts),
    cacheReuse: ratio(cached, cached + prefill),
    generatedTokens: generated,
    prefillTokens: prefill,
    cachedTokens: cached,
    draftTokens: draft,
    acceptedTokens: accepted,
    drafts,
    requestsProcessing: counter(cur, 'requests_processing'),
    requestsDeferred: counter(cur, 'requests_deferred'),
    context,
  }
}

export function totalsOf(s: LlamaSnapshot): StackTotals {
  const prefill = counter(s, 'prompt_tokens_total')
  const cached = counter(s, 'prompt_tokens_cached_total')
  const accepted = counter(s, 'spec_decode_num_accepted_tokens_total')
  return {
    generatedTokens: counter(s, 'tokens_predicted_total'),
    prefillTokens: prefill,
    cachedTokens: cached,
    drafts: counter(s, 'spec_decode_num_drafts_total'),
    draftTokens: counter(s, 'spec_decode_num_draft_tokens_total'),
    acceptance: ratio(accepted, counter(s, 'spec_decode_num_draft_tokens_total')),
    acceptedPerDraft: ratio(accepted, counter(s, 'spec_decode_num_drafts_total')),
    cacheReuse: ratio(cached, cached + prefill),
    decodeTps: ratio(counter(s, 'tokens_predicted_total'), counter(s, 'tokens_predicted_seconds_total')),
    prefillTps: ratio(prefill, counter(s, 'prompt_seconds_total')),
    acceptedPerPos: s.acceptedPerPos,
  }
}

/** Parse forge's GET /forge/usage body; null if it isn't the expected shape. */
export function parseForgeUsage(body: unknown): ForgeUsage | null {
  if (!body || typeof body !== 'object') {
    return null
  }
  const b = body as Record<string, unknown>
  const current = b.current_usage_tokens
  const window = b.context_window_tokens
  if (typeof current !== 'number' || typeof window !== 'number' || window <= 0) {
    return null
  }
  return {
    currentTokens: current,
    contextWindow: window,
    percent: typeof b.usage_percent === 'number' ? b.usage_percent : (current / window) * 100,
    model: typeof b.model === 'string' ? b.model : null,
  }
}

export interface StackPollerOptions {
  llamaUrl: string
  forgeUrl: string
  pollMs: number
  timeoutMs: number
  maxSamples: number
  onSample?: (sample: StackSample, totals: StackTotals) => void
  onStatus?: (status: StackStatus) => void
  fetchFn?: typeof fetch
  now?: () => number
}

export class StackPoller {
  private readonly opts: StackPollerOptions
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private prev: LlamaSnapshot | null = null
  private samples: StackSample[] = []
  private totals: StackTotals | null = null
  private status: StackStatus

  constructor(opts: StackPollerOptions) {
    this.opts = opts
    this.fetchFn = opts.fetchFn ?? fetch
    this.now = opts.now ?? Date.now
    this.status = {
      state: opts.pollMs > 0 ? 'starting' : 'disabled',
      llamaUrl: opts.llamaUrl,
      forgeUrl: opts.forgeUrl,
      pollMs: opts.pollMs,
      lastOkAt: null,
      lastError: null,
      restarts: 0,
    }
  }

  start(): void {
    if (this.opts.pollMs <= 0 || this.timer) {
      return
    }
    const loop = async () => {
      await this.tick()
      this.timer = setTimeout(loop, this.opts.pollMs)
    }
    this.timer = setTimeout(loop, 0)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  view(): StackMetricsView {
    return {
      status: { ...this.status },
      latest: this.samples[this.samples.length - 1] ?? null,
      totals: this.totals,
      samples: [...this.samples],
    }
  }

  /** One poll. Public so tests can drive it without timers. */
  async tick(): Promise<void> {
    // /metrics goes through llama's task queue and can hang when the queue
    // wedges; never stack polls on top of a stuck one.
    if (this.inFlight) {
      return
    }
    this.inFlight = true
    try {
      const [snap, context] = await Promise.all([this.fetchLlama(), this.fetchForge()])
      this.accept(snap, context)
    } catch (err) {
      if (isTimeout(err)) {
        this.setStatus({
          state: 'stalled',
          lastError: `no /metrics answer within ${this.opts.timeoutMs} ms — llama's task queue is busy or wedged`,
        })
      } else {
        this.setStatus({ state: 'unreachable', lastError: describeError(err) })
      }
    } finally {
      this.inFlight = false
    }
  }

  private accept(snap: LlamaSnapshot, context: ForgeUsage | null): void {
    this.totals = totalsOf(snap)
    const prev = this.prev
    this.prev = snap

    const restarted = prev !== null && isReset(prev, snap)
    this.setStatus({
      state: 'ok',
      lastOkAt: snap.at,
      lastError: null,
      restarts: this.status.restarts + (restarted ? 1 : 0),
    })
    if (!prev || restarted) {
      return
    }

    const sample = diffSnapshots(prev, snap, context)
    this.samples.push(sample)
    if (this.samples.length > this.opts.maxSamples) {
      this.samples.splice(0, this.samples.length - this.opts.maxSamples)
    }
    this.opts.onSample?.(sample, this.totals)
  }

  private async fetchLlama(): Promise<LlamaSnapshot> {
    const res = await this.fetchFn(`${this.opts.llamaUrl}/metrics`, {
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    })
    if (!res.ok) {
      // 501 means llama-server was started without --metrics.
      throw new Error(`llama /metrics HTTP ${res.status}`)
    }
    const text = await res.text()
    return parseLlamaMetrics(text, res.headers.get(RESTART_HEADER), this.now())
  }

  // Context fill is a nice-to-have: forge being down must not blank the
  // llama figures, so any failure here is just "no context reading".
  private async fetchForge(): Promise<ForgeUsage | null> {
    try {
      const res = await this.fetchFn(`${this.opts.forgeUrl}/forge/usage`, {
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      })
      return res.ok ? parseForgeUsage(await res.json()) : null
    } catch {
      return null
    }
  }

  private setStatus(patch: Partial<StackStatus>): void {
    const next = { ...this.status, ...patch }
    const changed =
      next.state !== this.status.state ||
      next.lastError !== this.status.lastError ||
      next.restarts !== this.status.restarts
    this.status = next
    if (changed) {
      this.opts.onStatus?.({ ...next })
    }
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string } }).cause
    return cause?.code ? `${err.message} (${cause.code})` : err.message
  }
  return String(err)
}
