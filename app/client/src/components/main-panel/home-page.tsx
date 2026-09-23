import { DashboardHost } from '@/dashboard/dashboard-host'

/**
 * The home page is the pluggable dashboard host: the recent-sessions list by
 * default, or another registered view (Constellation) the user picked. See
 * src/dashboard/.
 */
export function HomePage() {
  return <DashboardHost />
}
