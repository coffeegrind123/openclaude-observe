import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { useUIStore } from '@/stores/ui-store'
import { SessionEditModal } from './session-modal'
import type { Session } from '@/types'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

const { mockSession } = vi.hoisted(() => ({ mockSession: { current: null as Session | null } }))

vi.mock('@/lib/api-client', () => ({
  api: {
    getSession: () => Promise.resolve(mockSession.current),
    getSessions: () => Promise.resolve([]),
    getProjects: () => Promise.resolve([]),
    getAgents: () => Promise.resolve([]),
    getEvents: () => Promise.resolve([]),
    getLabels: () => Promise.resolve([]),
  },
}))

function session(metadata: Record<string, unknown> | null): Session {
  return {
    id: '01a0cea5-b997-73d4-853f-9a594c831c4e',
    projectId: 1,
    slug: null,
    status: 'active',
    startedAt: Date.now() - 60_000,
    stoppedAt: null,
    metadata,
    agentCount: 1,
    eventCount: 3,
    lastActivity: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalDurationMs: 0,
    llmCallCount: 0,
  }
}

describe('SessionEditModal details', () => {
  beforeEach(() => {
    useUIStore.setState({ editingSessionId: null, editingSessionTab: 'details' })
  })

  it("shows the session's git branch and repository", async () => {
    mockSession.current = session({
      cwd: '/work/repo',
      git_branch: 'feat/observe',
      git_repository_url: 'https://github.com/me/repo.git',
    })
    useUIStore.setState({ editingSessionId: mockSession.current.id })
    renderWithProviders(<SessionEditModal />)

    expect(await screen.findByText('feat/observe')).toBeInTheDocument()
    expect(screen.getByText('Branch')).toBeInTheDocument()
    expect(screen.getByText('https://github.com/me/repo.git')).toBeInTheDocument()
    expect(screen.getByText('Repository')).toBeInTheDocument()
  })

  it('leaves the rows out when the session is not in a repository', async () => {
    mockSession.current = session({ cwd: '/work/scratch', git_branch: null })
    useUIStore.setState({ editingSessionId: mockSession.current.id })
    renderWithProviders(<SessionEditModal />)

    expect(await screen.findByText('Working dir')).toBeInTheDocument()
    expect(screen.queryByText('Branch')).toBeNull()
    expect(screen.queryByText('Repository')).toBeNull()
  })
})
