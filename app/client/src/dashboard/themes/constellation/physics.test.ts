import { describe, it, expect } from 'vitest'
import {
  radius,
  heat,
  wellRadius,
  packProjects,
  stepSimulation,
  type SimNode,
  type Well,
  type Bounds,
} from './physics'

describe('radius', () => {
  it('grows with event count and handles missing/zero', () => {
    expect(radius(0)).toBeCloseTo(9)
    expect(radius(undefined)).toBeCloseTo(9)
    expect(radius(10000)).toBeGreaterThan(radius(100))
  })
})

describe('heat', () => {
  it('is 1 at/just-after the activity time', () => {
    expect(heat(1000, 1000, 60)).toBe(1)
    expect(heat(2000, 1000, 60)).toBe(1) // future timestamp clamps to 1
  })
  it('decays toward 0 as age grows', () => {
    const now = 100_000
    expect(heat(now - 1_000, now, 60)).toBeGreaterThan(heat(now - 180_000, now, 60))
    expect(heat(now - 180_000, now, 60)).toBeLessThan(0.1)
  })
  it('reaches ~1/e after one tau', () => {
    const now = 100_000
    expect(heat(now - 60_000, now, 60)).toBeCloseTo(Math.exp(-1), 3)
  })
})

describe('wellRadius', () => {
  it('grows with activity score', () => {
    expect(wellRadius(100, 0)).toBeGreaterThan(wellRadius(1, 0))
  })
  it('never goes below the containment floor', () => {
    expect(wellRadius(0, 180)).toBeGreaterThanOrEqual(180)
  })
  it('caps at the maximum even for huge scores', () => {
    expect(wellRadius(1e9, 0)).toBe(240)
  })
})

describe('packProjects', () => {
  it('centres a single project at the origin', () => {
    const { wells, bounds } = packProjects([{ key: 'a', score: 4, containR: 0 }])
    expect(wells).toHaveLength(1)
    expect(wells[0].cx).toBeCloseTo(0)
    expect(wells[0].cy).toBeCloseTo(0)
    expect(bounds.minX).toBeCloseTo(-wells[0].r)
    expect(bounds.maxX).toBeCloseTo(wells[0].r)
  })

  it('produces one non-overlapping well per project', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      key: `p${i}`,
      score: (i % 4) * 5,
      containR: 60,
    }))
    const { wells } = packProjects(items)
    expect(wells).toHaveLength(8)
    for (let i = 0; i < wells.length; i++) {
      for (let j = i + 1; j < wells.length; j++) {
        const a = wells[i]
        const b = wells[j]
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy)
        // allow a tiny epsilon; packer leaves a positive gap
        expect(d).toBeGreaterThan(a.r + b.r - 1)
      }
    }
  })

  it('is deterministic (same input → same layout)', () => {
    const items = [
      { key: 'a', score: 9, containR: 0 },
      { key: 'b', score: 1, containR: 0 },
      { key: 'c', score: 4, containR: 0 },
    ]
    expect(packProjects(items).wells).toEqual(packProjects(items).wells)
  })

  it('returns empty bounds for no projects', () => {
    const { wells, bounds } = packProjects([])
    expect(wells).toEqual([])
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })
})

function node(over: Partial<SimNode> = {}): SimNode {
  return {
    id: 'n',
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    projectKey: 'a',
    baseR: 12,
    heat: 0.5,
    attention: false,
    ...over,
  }
}

describe('stepSimulation', () => {
  const well: Well = { key: 'a', cx: 0, cy: 0, r: 200 }
  const wells = new Map([[well.key, well]])
  const bounds: Bounds = { minX: -400, minY: -400, maxX: 400, maxY: 400 }

  it('clamps stars to the provided bounds', () => {
    const n = node({ x: 5000, y: 5000, vx: 100, vy: 100 })
    stepSimulation([n], wells, () => false, bounds)
    expect(n.x).toBeLessThanOrEqual(bounds.maxX)
    expect(n.y).toBeLessThanOrEqual(bounds.maxY)
  })

  it('pulls a hot star closer to the well centre than a cold one', () => {
    const hotNode = node({ id: 'h', x: 150, y: 0, heat: 1 })
    const coldNode = node({ id: 'c', x: 150, y: 0, heat: 0 })
    for (let i = 0; i < 400; i++) {
      stepSimulation([hotNode], wells, () => false, bounds)
    }
    for (let i = 0; i < 400; i++) {
      stepSimulation([coldNode], wells, () => false, bounds)
    }
    expect(Math.hypot(hotNode.x, hotNode.y)).toBeLessThan(Math.hypot(coldNode.x, coldNode.y))
  })

  it('pushes two overlapping stars apart', () => {
    const a = node({ id: 'a', x: 0, y: 0 })
    const b = node({ id: 'b', x: 1, y: 0 })
    const before = Math.hypot(a.x - b.x, a.y - b.y)
    for (let i = 0; i < 30; i++) {
      stepSimulation([a, b], wells, () => false, bounds)
    }
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(before)
  })

  it('does not move stars whose well is missing', () => {
    const n = node({ projectKey: 'missing', x: 30, y: 30 })
    stepSimulation([n], wells, () => false, bounds)
    expect(n.x).toBe(30)
    expect(n.y).toBe(30)
  })
})
