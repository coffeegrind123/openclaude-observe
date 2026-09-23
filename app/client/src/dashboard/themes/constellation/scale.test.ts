import { describe, it, expect } from 'vitest'
import {
  WINDOW_MIN_MS,
  WINDOW_MAX_MS,
  ZOOM_MIN_VIEW,
  ZOOM_MAX_VIEW,
  windowPosToMs,
  windowMsToPos,
  zoomPosToViewH,
  viewHToZoomPos,
  zoomPercent,
  fmtDuration,
  DEFAULT_VIEW_H,
} from './scale'

describe('window slider scale', () => {
  it('maps the endpoints to 30 min and 90 days', () => {
    expect(windowPosToMs(0)).toBe(WINDOW_MIN_MS)
    expect(windowPosToMs(1)).toBe(WINDOW_MAX_MS)
  })
  it('is monotonic increasing', () => {
    expect(windowPosToMs(0.25)).toBeLessThan(windowPosToMs(0.75))
  })
  it('round-trips ms ↔ position', () => {
    for (const ms of [WINDOW_MIN_MS, 60 * 60 * 1000, 24 * 60 * 60 * 1000, WINDOW_MAX_MS]) {
      expect(windowPosToMs(windowMsToPos(ms))).toBeCloseTo(ms, -3)
    }
  })
  it('clamps out-of-range positions and values', () => {
    expect(windowPosToMs(-1)).toBe(WINDOW_MIN_MS)
    expect(windowPosToMs(2)).toBe(WINDOW_MAX_MS)
    expect(windowMsToPos(1)).toBe(0)
    expect(windowMsToPos(Number.MAX_SAFE_INTEGER)).toBe(1)
  })
})

describe('zoom slider scale', () => {
  it('right end is most zoomed in (smallest view height)', () => {
    expect(zoomPosToViewH(1)).toBeCloseTo(ZOOM_MIN_VIEW)
    expect(zoomPosToViewH(0)).toBeCloseTo(ZOOM_MAX_VIEW)
  })
  it('round-trips view height ↔ position', () => {
    for (const vh of [ZOOM_MIN_VIEW, DEFAULT_VIEW_H, ZOOM_MAX_VIEW]) {
      expect(zoomPosToViewH(viewHToZoomPos(vh))).toBeCloseTo(vh, 0)
    }
  })
  it('reports 100% at the default view height and higher when zoomed in', () => {
    expect(zoomPercent(DEFAULT_VIEW_H)).toBe(100)
    expect(zoomPercent(ZOOM_MIN_VIEW)).toBeGreaterThan(100)
    expect(zoomPercent(ZOOM_MAX_VIEW)).toBeLessThan(100)
  })
})

describe('fmtDuration', () => {
  it('formats minutes, hours, and days', () => {
    expect(fmtDuration(WINDOW_MIN_MS)).toBe('30m')
    expect(fmtDuration(60 * 60 * 1000)).toBe('1h')
    expect(fmtDuration(24 * 60 * 60 * 1000)).toBe('24h')
    expect(fmtDuration(WINDOW_MAX_MS)).toBe('90d')
  })
})
