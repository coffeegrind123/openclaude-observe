/**
 * Pure geometry + force simulation for the Constellation view. No DOM, no
 * React, no time source of its own — the render loop stamps `heat`/`attention`
 * onto each node every frame and calls `stepSimulation`. Kept dependency-free
 * and unit-tested (physics.test.ts) rather than pulling in d3, since neither
 * the heat-driven radial spring nor the activity-sized well packing is a stock
 * d3 force/layout.
 *
 * Coordinates are an unbounded world centred near the origin; the view pans a
 * camera (viewBox) across it. Project "wells" are packed by activity into a
 * compact cluster (biggest in the middle); session "stars" settle within their
 * well via a heat-driven radial spring.
 */

const CHARGE = 950 // pairwise star repulsion strength
const CHARGE_R = 170 // repulsion cutoff distance
const DAMP = 0.84 // velocity damping per step
const MAX_V = 6 // velocity clamp
const INNER_R = 26 // radius a fully-hot star settles at within its well
const K_GRAVITY = 0.02 // radial spring stiffness
const K_ATTN = 0.045 // stronger pull for attention stars

// Well sizing (world units). Radius encodes recent activity, with a floor that
// guarantees the well can contain its sessions' stars.
const WELL_MIN = 64
const WELL_MAX = 240
const WELL_PAD = 16 // gap between packed wells
const WELL_SETTLE_ITERS = 500

export interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  projectKey: string
  baseR: number
  /** 0 (cold) .. 1 (hot), set by the render loop each frame. */
  heat: number
  /** Needs-attention flag, set by the render loop each frame. */
  attention: boolean
}

export interface Well {
  key: string
  cx: number
  cy: number
  r: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ProjectInput {
  key: string
  /** Aggregate recent-activity score (e.g. sum of member sessions' heat). */
  score: number
  /** Minimum radius needed to contain the project's stars. */
  containR: number
}

/** Star radius from a session's event count. */
export function radius(eventCount: number | undefined): number {
  return 9 + Math.sqrt(Math.max(0, eventCount ?? 0)) * 0.42
}

/** Collision radius — leaves room for the subagent orbit when present. */
export function collisionRadius(node: SimNode, hasOrbit: boolean): number {
  return node.baseR + (hasOrbit ? node.baseR + 24 : 8)
}

/**
 * Continuous recency heat: 1 just after activity, decaying to 0 over τ.
 * `tauSec` is the e-folding time (≈ how long until a quiet session reads "cold").
 */
export function heat(lastActivityMs: number, nowMs: number, tauSec: number): number {
  const age = (nowMs - lastActivityMs) / 1000
  if (age <= 0) {
    return 1
  }
  return Math.exp(-age / Math.max(1, tauSec))
}

/** Well radius from activity score, never smaller than the containment floor. */
export function wellRadius(score: number, containR: number): number {
  const fromScore = 56 + Math.sqrt(Math.max(0, score)) * 70
  return Math.max(WELL_MIN, Math.min(WELL_MAX, Math.max(containR, fromScore)))
}

const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

/**
 * Pack project wells into a compact, non-overlapping cluster centred at the
 * origin with the largest (most active) wells in the middle. Deterministic
 * (golden-angle seed + collision/gravity settle — no RNG) so it's testable and
 * stable across renders.
 */
export function packProjects(items: ProjectInput[]): { wells: Well[]; bounds: Bounds } {
  const n = items.length
  if (n === 0) {
    return { wells: [], bounds: { ...EMPTY_BOUNDS } }
  }

  const GA = 2.399963 // golden angle
  const nodes = items
    .map((it) => ({ key: it.key, r: wellRadius(it.score, it.containR) }))
    .sort((a, b) => b.r - a.r) // largest first → seeded nearest the centre
    .map((s, i) => {
      const seedR = i === 0 ? 0 : (s.r + WELL_PAD) * Math.sqrt(i) * 0.9
      return { ...s, x: Math.cos(i * GA) * seedR, y: Math.sin(i * GA) * seedR }
    })

  for (let iter = 0; iter < WELL_SETTLE_ITERS; iter++) {
    // weak gravity toward the origin keeps the cluster compact
    for (const a of nodes) {
      a.x -= a.x * 0.01
      a.y -= a.y * 0.01
    }
    // collision resolution (separate any overlapping pair)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d === 0) {
          // perfectly coincident — nudge deterministically by index
          dx = Math.cos(j)
          dy = Math.sin(j)
          d = 1
        }
        const min = a.r + b.r + WELL_PAD
        if (d < min) {
          const push = (min - d) / d / 2
          a.x -= dx * push
          a.y -= dy * push
          b.x += dx * push
          b.y += dy * push
        }
      }
    }
  }

  const wells: Well[] = nodes.map((nd) => ({ key: nd.key, cx: nd.x, cy: nd.y, r: nd.r }))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const w of wells) {
    minX = Math.min(minX, w.cx - w.r)
    minY = Math.min(minY, w.cy - w.r)
    maxX = Math.max(maxX, w.cx + w.r)
    maxY = Math.max(maxY, w.cy + w.r)
  }
  return { wells, bounds: { minX, minY, maxX, maxY } }
}

/**
 * Advance the star simulation one step, mutating node positions/velocities.
 * Forces: a heat-driven radial spring toward each star's well (hot → centre,
 * cold → rim), pairwise charge repulsion, soft collision. Positions are clamped
 * to `bounds` (the packed world plus a margin) so stars can't drift away.
 */
export function stepSimulation(
  nodes: SimNode[],
  wellByKey: Map<string, Well>,
  hasOrbit: (node: SimNode) => boolean,
  bounds: Bounds,
): void {
  for (const s of nodes) {
    const well = wellByKey.get(s.projectKey)
    if (!well) {
      continue
    }
    const dx = s.x - well.cx
    const dy = s.y - well.cy
    const dist = Math.hypot(dx, dy) || 0.01
    const desired = s.attention ? INNER_R * 0.5 : INNER_R + (well.r - INNER_R) * (1 - s.heat)
    const tx = well.cx + (dx / dist) * desired
    const ty = well.cy + (dy / dist) * desired
    const k = s.attention ? K_ATTN : K_GRAVITY
    s.vx += (tx - s.x) * k
    s.vy += (ty - s.y) * k
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d2 = dx * dx + dy * dy || 0.01
      if (d2 < CHARGE_R * CHARGE_R) {
        const d = Math.sqrt(d2)
        const f = CHARGE / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
      const minD = collisionRadius(a, hasOrbit(a)) + collisionRadius(b, hasOrbit(b))
      if (d2 < minD * minD) {
        const d = Math.sqrt(d2) || 0.01
        const push = ((minD - d) / d) * 0.5
        a.vx += dx * push * 0.12
        a.vy += dy * push * 0.12
        b.vx -= dx * push * 0.12
        b.vy -= dy * push * 0.12
      }
    }
  }

  for (const s of nodes) {
    s.vx *= DAMP
    s.vy *= DAMP
    s.vx = Math.max(-MAX_V, Math.min(MAX_V, s.vx))
    s.vy = Math.max(-MAX_V, Math.min(MAX_V, s.vy))
    s.x += s.vx
    s.y += s.vy
    s.x = Math.max(bounds.minX, Math.min(bounds.maxX, s.x))
    s.y = Math.max(bounds.minY, Math.min(bounds.maxY, s.y))
  }
}
