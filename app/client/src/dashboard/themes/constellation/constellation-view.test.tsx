import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { useUIStore } from '@/stores/ui-store'
import { ConstellationView } from './constellation-view'
import type { RecentSession } from '@/types'

// The constellation fetches its own activity-windowed sessions; mock that hook.
let mockWindowed: { data: RecentSession[]; isLoading: boolean } = { data: [], isLoading: false }
vi.mock('@/hooks/use-windowed-sessions', () => ({
  useWindowedSessions: () => mockWindowed,
}))

function session(id: string, over: Partial<RecentSession> = {}): RecentSession {
  return {
    id,
    projectId: 1,
    projectSlug: 'alpha',
    projectName: 'alpha',
    slug: id,
    status: 'active',
    startedAt: 0,
    stoppedAt: null,
    metadata: null,
    lastActivity: Date.now(),
    eventCount: 100,
    agentCount: 3,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalDurationMs: 0,
    llmCallCount: 0,
    ...over,
  }
}

const props = { sessions: [], isLoading: false, onOpenSession: () => {} }

afterEach(() => {
  cleanup()
  useUIStore.getState().clearPreviewSession()
  mockWindowed = { data: [], isLoading: false }
})

describe('ConstellationView', () => {
  it('mounts and renders a star + well label per session/project without throwing', () => {
    mockWindowed = {
      data: [
        session('swift-otter'),
        session('calm-harbor', { projectName: 'beta', projectId: 2, projectSlug: 'beta' }),
      ],
      isLoading: false,
    }
    renderWithProviders(<ConstellationView {...props} />)
    expect(screen.getByText('swift-otter')).toBeTruthy()
    expect(screen.getByText('calm-harbor')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy() // well label
    expect(screen.getByText('beta')).toBeTruthy()
    expect(screen.getByText('Deep Space')).toBeTruthy() // palette control
  })

  it('shows an empty state when there are no sessions in the window', () => {
    mockWindowed = { data: [], isLoading: false }
    renderWithProviders(<ConstellationView {...props} />)
    expect(screen.getByText(/No sessions active in the last 24h/i)).toBeTruthy()
  })

  it('runs its animation frame without error', () => {
    mockWindowed = { data: [session('a')], isLoading: false }
    let fired = false
    const raf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (!fired) {
          fired = true
          cb(0)
        }
        return 0
      })
    expect(() => renderWithProviders(<ConstellationView {...props} />)).not.toThrow()
    raf.mockRestore()
  })

  it('renders inline sliders and collapses the controls to a gear', () => {
    mockWindowed = { data: [session('a')], isLoading: false }
    renderWithProviders(<ConstellationView {...props} />)
    // sliders present
    expect(screen.getByText('window')).toBeTruthy()
    expect(screen.getByText('zoom')).toBeTruthy()
    expect(screen.getByText('decay τ')).toBeTruthy()
    expect(screen.getByText('Deep Space')).toBeTruthy() // palette visible while expanded

    fireEvent.click(screen.getByLabelText('Hide controls'))
    expect(screen.queryByText('Deep Space')).toBeNull() // body collapsed
    expect(screen.getByLabelText('Show controls')).toBeTruthy() // gear remains

    fireEvent.click(screen.getByLabelText('Show controls'))
    expect(screen.getByText('Deep Space')).toBeTruthy() // expanded again
  })

  it('the tooltip renders session names as text, never as markup', () => {
    mockWindowed = {
      data: [session('<img src=x onerror=alert(1)>', { projectName: '<b>p</b>' })],
      isLoading: false,
    }
    const { container } = renderWithProviders(<ConstellationView {...props} />)
    const star = container.querySelector('g.cst-star')!
    fireEvent.mouseMove(star, { clientX: 10, clientY: 10 })
    const tip = container.querySelector('.cst-tooltip')!
    expect(tip.querySelector('img')).toBeNull()
    expect(tip.querySelector('b b')).toBeNull()
    expect(tip.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(tip.textContent).toContain('<b>p</b>')
  })

  it('sets the sidebar preview on focus and clears it on background click', () => {
    mockWindowed = { data: [session('swift-otter', { projectId: 7 })], isLoading: false }
    const { container } = renderWithProviders(<ConstellationView {...props} />)
    expect(useUIStore.getState().previewSessionId).toBeNull()

    const star = screen.getByText('swift-otter').closest('g.cst-star')!
    fireEvent.click(star)
    expect(useUIStore.getState().previewSessionId).toBe('swift-otter')
    expect(useUIStore.getState().previewProjectId).toBe(7)

    fireEvent.click(container.querySelector('svg')!)
    expect(useUIStore.getState().previewSessionId).toBeNull()
  })
})
