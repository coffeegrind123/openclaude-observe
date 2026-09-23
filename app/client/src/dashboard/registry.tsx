import type { DashboardTheme } from './types'
import { sessionsListTheme } from './themes/sessions-list'
import { constellationTheme } from './themes/constellation'

/**
 * All registered dashboard themes, in display order. Add a new home-page
 * visualization by creating a folder under `themes/` that exports a
 * `DashboardTheme` and listing it here — nothing else needs to change.
 */
export const dashboardThemes: DashboardTheme[] = [sessionsListTheme, constellationTheme]

// The recent-sessions list stays the default home: the Constellation is an
// alternative view, not a replacement.
export const DEFAULT_DASHBOARD_THEME_ID = sessionsListTheme.id

/** Resolve a (possibly stale/unknown) id to a registered theme, never null. */
export function resolveDashboardTheme(id: string | null | undefined): DashboardTheme {
  return (
    dashboardThemes.find((t) => t.id === id) ??
    dashboardThemes.find((t) => t.id === DEFAULT_DASHBOARD_THEME_ID) ??
    dashboardThemes[0]
  )
}
