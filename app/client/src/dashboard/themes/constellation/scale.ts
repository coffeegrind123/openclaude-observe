/**
 * Pure mapping helpers for the Constellation control sliders (activity window
 * and zoom). Both use a logarithmic scale so a single slider can span a wide
 * range with useful resolution at the low end. Unit-tested in scale.test.ts.
 */

export const WINDOW_MIN_MS = 30 * 60 * 1000 // 30 minutes
export const WINDOW_MAX_MS = 90 * 24 * 60 * 60 * 1000 // 90 days
export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

// Camera "zoom" expressed as the world-height shown in the viewport. Smaller =
// zoomed in (bigger bubbles); larger = zoomed out (more of the canvas).
export const ZOOM_MIN_VIEW = 380 // most zoomed in
export const ZOOM_MAX_VIEW = 3200 // most zoomed out
export const DEFAULT_VIEW_H = 1000

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Slider position [0,1] → activity window in ms (log scale). */
export function windowPosToMs(t: number): number {
  return Math.round(WINDOW_MIN_MS * Math.pow(WINDOW_MAX_MS / WINDOW_MIN_MS, clamp01(t)))
}

/** Activity window in ms → slider position [0,1]. */
export function windowMsToPos(ms: number): number {
  const clamped = Math.max(WINDOW_MIN_MS, Math.min(WINDOW_MAX_MS, ms))
  return clamp01(Math.log(clamped / WINDOW_MIN_MS) / Math.log(WINDOW_MAX_MS / WINDOW_MIN_MS))
}

/** Slider position [0,1] → view height. Right end (1) = most zoomed in. */
export function zoomPosToViewH(t: number): number {
  return ZOOM_MAX_VIEW * Math.pow(ZOOM_MIN_VIEW / ZOOM_MAX_VIEW, clamp01(t))
}

/** View height → slider position [0,1]. */
export function viewHToZoomPos(vh: number): number {
  const clamped = Math.max(ZOOM_MIN_VIEW, Math.min(ZOOM_MAX_VIEW, vh))
  return clamp01(Math.log(ZOOM_MAX_VIEW / clamped) / Math.log(ZOOM_MAX_VIEW / ZOOM_MIN_VIEW))
}

/** Zoom as a percentage where the default view height reads 100%. */
export function zoomPercent(vh: number): number {
  return Math.round((DEFAULT_VIEW_H / vh) * 100)
}

/** Human-readable duration label for the window slider (e.g. "30m", "24h", "90d"). */
export function fmtDuration(ms: number): string {
  const minutes = ms / 60000
  if (minutes < 60) {
    return `${Math.round(minutes)}m`
  }
  const hours = minutes / 60
  if (hours < 48) {
    return `${Math.round(hours)}h`
  }
  return `${Math.round(hours / 24)}d`
}
