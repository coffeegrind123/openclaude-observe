import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { useUIStore } from '@/stores/ui-store'
import { resolveDashboardTheme, DEFAULT_DASHBOARD_THEME_ID } from './registry'
import type { RecentSession } from '@/types'

vi.mock('@/hooks/use-recent-sessions', () => ({
  useRecentSessions: () => ({ data: [] as RecentSession[], isLoading: false }),
}))
vi.mock('@/hooks/use-windowed-sessions', () => ({
  useWindowedSessions: () => ({ data: [] as RecentSession[], isLoading: false }),
}))

const { DashboardHost } = await import('./dashboard-host')

beforeEach(() => {
  useUIStore.setState({ dashboardThemeId: 'sessions-list' })
})

describe('dashboard themes', () => {
  it('the recent-sessions list stays the default home; Constellation is an alternative', () => {
    expect(DEFAULT_DASHBOARD_THEME_ID).toBe('sessions-list')
    expect(resolveDashboardTheme(null).id).toBe('sessions-list')
    expect(resolveDashboardTheme('no-such-theme').id).toBe('sessions-list')
    expect(resolveDashboardTheme('constellation').id).toBe('constellation')
  })

  it('switches between the list and the constellation and remembers the choice', () => {
    renderWithProviders(<DashboardHost />)
    expect(screen.getByText('Recent Sessions')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Constellation/ }))
    expect(useUIStore.getState().dashboardThemeId).toBe('constellation')
    expect(localStorage.getItem('instantcoffee-observe-dashboard-theme')).toBe('constellation')
    expect(screen.getByText(/No sessions active in the last/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /List/ }))
    expect(useUIStore.getState().dashboardThemeId).toBe('sessions-list')
  })
})
