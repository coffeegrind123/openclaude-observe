import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface TimePoint {
  at: number
  value: number | null
}

interface TimeSeriesChartProps {
  title: string
  subtitle?: string
  points: TimePoint[]
  format: (v: number) => string
  /** Fixed y ceiling (e.g. 100 for a percentage); otherwise from the data. */
  yMax?: number
  height?: number
}

const PAD = { top: 12, right: 44, bottom: 20, left: 44 }
const TICKS = 3

/** Round a ceiling up to a clean 1/2/5 × 10^n step so ticks read cleanly. */
export function niceCeiling(max: number): number {
  if (!(max > 0)) {
    return 1
  }
  const exp = Math.pow(10, Math.floor(Math.log10(max)))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * exp >= max) {
      return step * exp
    }
  }
  return 10 * exp
}

/**
 * Split into runs of consecutive non-null points, so an idle stretch is a gap
 * in the line rather than a slope drawn through values that never happened.
 */
export function segments(points: TimePoint[]): TimePoint[][] {
  const out: TimePoint[][] = []
  let run: TimePoint[] = []
  for (const p of points) {
    if (p.value === null) {
      if (run.length) {
        out.push(run)
      }
      run = []
      continue
    }
    run.push(p)
  }
  if (run.length) {
    out.push(run)
  }
  return out
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * One series over time. Single-series by design: every stack measure has its
 * own scale, and two scales on one chart is the dual-axis mistake.
 */
export function TimeSeriesChart({
  title,
  subtitle,
  points,
  format,
  yMax,
  height = 120,
}: TimeSeriesChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(480)
  const [hover, setHover] = useState<number | null>(null)
  const areaId = useId()

  useEffect(() => {
    const el = wrapRef.current
    if (!el) {
      return
    }
    const measure = () => setWidth(Math.max(200, el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geom = useMemo(() => {
    const innerW = width - PAD.left - PAD.right
    const innerH = height - PAD.top - PAD.bottom
    const first = points[0]?.at ?? 0
    const last = points[points.length - 1]?.at ?? 1
    const span = Math.max(1, last - first)
    const dataMax = Math.max(0, ...points.map((p) => p.value ?? 0))
    const top = yMax ?? niceCeiling(dataMax)
    const x = (at: number) => PAD.left + ((at - first) / span) * innerW
    const y = (v: number) => PAD.top + innerH - (Math.min(v, top) / top) * innerH
    return { innerW, innerH, first, last, top, x, y }
  }, [points, width, height, yMax])

  const runs = useMemo(() => segments(points), [points])
  const lastPoint = [...points].reverse().find((p) => p.value !== null) ?? null
  const hovered = hover !== null ? points[hover] : null

  const nearest = (clientX: number, rect: DOMRect) => {
    if (points.length === 0) {
      return null
    }
    const px = clientX - rect.left
    const at = geom.first + ((px - PAD.left) / geom.innerW) * (geom.last - geom.first)
    let best = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].at - at) < Math.abs(points[best].at - at)) {
        best = i
      }
    }
    return best
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (points.length === 0) {
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setHover((h) => Math.max(0, (h ?? points.length) - 1))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1))
    } else if (e.key === 'Escape') {
      setHover(null)
    }
  }

  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (geom.top / TICKS) * i)

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex items-baseline gap-2">
        <span className="text-[12px] font-semibold text-foreground">{title}</span>
        {subtitle && <span className="text-[11px] text-ink-3">{subtitle}</span>}
      </figcaption>
      <div ref={wrapRef} className="relative">
        {points.length < 2 ? (
          <div
            className="flex items-center justify-center rounded-sm border border-rule text-[11px] text-ink-3"
            style={{ height }}
          >
            Waiting for samples
          </div>
        ) : (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${title}${lastPoint?.value != null ? `, latest ${format(lastPoint.value)}` : ''}`}
            tabIndex={0}
            className="block outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            onPointerMove={(e) =>
              setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))
            }
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
          >
            <defs>
              <linearGradient id={areaId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--brand)" stopOpacity={0.12} />
                <stop offset="1" stopColor="var(--brand)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={geom.y(t)}
                  y2={geom.y(t)}
                  stroke="var(--rule)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={geom.y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-ink-3 text-[10px] tabular-nums"
                >
                  {format(t)}
                </text>
              </g>
            ))}
            <text x={PAD.left} y={height - 4} className="fill-ink-3 text-[10px] tabular-nums">
              {clock(geom.first)}
            </text>
            <text
              x={width - PAD.right}
              y={height - 4}
              textAnchor="end"
              className="fill-ink-3 text-[10px] tabular-nums"
            >
              {clock(geom.last)}
            </text>

            {runs.map((run, i) => {
              const line = run
                .map((p, j) => `${j ? 'L' : 'M'}${geom.x(p.at)},${geom.y(p.value!)}`)
                .join('')
              const base = geom.y(0)
              const area =
                run.length > 1
                  ? `${line}L${geom.x(run[run.length - 1].at)},${base}L${geom.x(run[0].at)},${base}Z`
                  : null
              return (
                <g key={i}>
                  {area && <path d={area} fill={`url(#${areaId})`} />}
                  {run.length > 1 ? (
                    <path
                      d={line}
                      fill="none"
                      stroke="var(--brand)"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ) : (
                    <circle
                      cx={geom.x(run[0].at)}
                      cy={geom.y(run[0].value!)}
                      r={2}
                      fill="var(--brand)"
                    />
                  )}
                </g>
              )
            })}

            {lastPoint && lastPoint.value !== null && (
              <g>
                <circle
                  cx={geom.x(lastPoint.at)}
                  cy={geom.y(lastPoint.value)}
                  r={4}
                  fill="var(--brand)"
                  stroke="var(--background)"
                  strokeWidth={2}
                />
                <text
                  x={geom.x(lastPoint.at) + 8}
                  y={geom.y(lastPoint.value)}
                  dominantBaseline="middle"
                  className="fill-foreground text-[10px] font-semibold tabular-nums"
                >
                  {format(lastPoint.value)}
                </text>
              </g>
            )}

            {hovered && (
              <line
                x1={geom.x(hovered.at)}
                x2={geom.x(hovered.at)}
                y1={PAD.top}
                y2={height - PAD.bottom}
                stroke="var(--ink-3)"
                strokeWidth={1}
              />
            )}
            {hovered && hovered.value !== null && (
              <circle
                cx={geom.x(hovered.at)}
                cy={geom.y(hovered.value)}
                r={4}
                fill="var(--brand)"
                stroke="var(--background)"
                strokeWidth={2}
              />
            )}
          </svg>
        )}

        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 rounded-md border border-rule bg-popover px-2 py-1 shadow-sm"
            style={{
              left: Math.min(Math.max(geom.x(hovered.at) + 8, 0), width - 120),
            }}
          >
            <div className="text-[12px] font-semibold tabular-nums text-foreground">
              {hovered.value === null ? 'idle' : format(hovered.value)}
            </div>
            <div className="text-[10px] text-ink-3 tabular-nums">
              {new Date(hovered.at).toLocaleTimeString()}
            </div>
          </div>
        )}
      </div>
    </figure>
  )
}
