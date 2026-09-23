import { describe, it, expect } from 'vitest'
import { clampTimelineHeight } from './activity-timeline'

describe('clampTimelineHeight', () => {
  it('allows heights up to 80% of the viewport', () => {
    expect(clampTimelineHeight(700, 1000)).toBe(700)
    expect(clampTimelineHeight(800, 1000)).toBe(800)
  })

  it('caps at 80% of the viewport', () => {
    expect(clampTimelineHeight(950, 1000)).toBe(800)
  })

  it('never goes below the 60px minimum', () => {
    expect(clampTimelineHeight(10, 1000)).toBe(60)
  })
})
