import { useState } from 'react'
import type { StackTotals } from '@/types/stack'

const BAR_MAX = 24
const GAP = 2
const HEIGHT = 110
const PAD_BOTTOM = 18
const MAX_POSITIONS = 16

/**
 * How deep drafts survive: for each draft position, the share of drafts whose
 * token at that position was accepted. Position 0 is "the first drafted token
 * was right"; the fall-off is what caps speculative decoding's speed-up, and
 * it is what to watch when tuning the draft length.
 */
export function AcceptanceByPosition({ totals }: { totals: StackTotals | null }) {
  const [hover, setHover] = useState<number | null>(null)
  const perPos = totals?.acceptedPerPos ?? []
  // accepted-at-position / drafts = the share of drafts that got that far.
  const drafts = totals?.drafts ?? 0
  const shown = perPos.slice(0, MAX_POSITIONS)

  if (!drafts || shown.length === 0) {
    return null
  }

  const rates = shown.map((n) => n / drafts)
  const slot = 100 / shown.length

  return (
    <figure>
      <figcaption className="mb-1 flex items-baseline gap-2">
        <span className="text-[12px] font-semibold text-foreground">
          Acceptance by draft position
        </span>
        <span className="text-[11px] text-ink-3">
          share of drafts accepted at each position, since llama started
        </span>
      </figcaption>
      <div className="relative" style={{ height: HEIGHT }}>
        <svg width="100%" height={HEIGHT} role="img" aria-label="Acceptance by draft position">
          <line
            x1="0"
            x2="100%"
            y1={HEIGHT - PAD_BOTTOM}
            y2={HEIGHT - PAD_BOTTOM}
            stroke="var(--rule)"
            strokeWidth={1}
          />
          {rates.map((r, i) => {
            const h = Math.max(1, r * (HEIGHT - PAD_BOTTOM - 14))
            return (
              <g
                key={i}
                tabIndex={0}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              >
                {/* hit target: the whole slot, not the painted bar */}
                <rect
                  x={`${slot * i}%`}
                  y={0}
                  width={`${slot}%`}
                  height={HEIGHT}
                  fill="transparent"
                />
                <svg x={`${slot * i}%`} width={`${slot}%`} height={HEIGHT} overflow="visible">
                  <rect
                    x="50%"
                    transform={`translate(${-(BAR_MAX - GAP) / 2}, 0)`}
                    y={HEIGHT - PAD_BOTTOM - h}
                    width={BAR_MAX - GAP}
                    height={h}
                    rx={4}
                    fill="var(--brand)"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                  {/* square the baseline end; only the data end is rounded */}
                  <rect
                    x="50%"
                    transform={`translate(${-(BAR_MAX - GAP) / 2}, 0)`}
                    y={HEIGHT - PAD_BOTTOM - Math.min(4, h)}
                    width={BAR_MAX - GAP}
                    height={Math.min(4, h)}
                    fill="var(--brand)"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                  <text
                    x="50%"
                    y={HEIGHT - 4}
                    textAnchor="middle"
                    className="fill-ink-3 text-[10px] tabular-nums"
                  >
                    {i + 1}
                  </text>
                  {(i === 0 || hover === i) && (
                    <text
                      x="50%"
                      y={HEIGHT - PAD_BOTTOM - h - 4}
                      textAnchor="middle"
                      className="fill-foreground text-[10px] font-semibold tabular-nums"
                    >
                      {Math.round(r * 100)}%
                    </text>
                  )}
                </svg>
              </g>
            )
          })}
        </svg>
      </div>
      {hover !== null && (
        <p className="mt-1 text-[11px] text-ink-2" role="status">
          Position {hover + 1}: {shown[hover].toLocaleString()} accepted (
          {Math.round(rates[hover] * 100)}% of {Math.round(drafts).toLocaleString()} drafts)
        </p>
      )}
    </figure>
  )
}
