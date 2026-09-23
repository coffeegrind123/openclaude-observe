import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { ProjectList } from './project-list'
import { useUIStore } from '@/stores/ui-store'
import { clearNotification, pushNotification } from './notification-indicator'
import type { Session, Project } from '@/types'

// Polyfill ResizeObserver for Radix UI Tooltip in jsdom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

// ── Mock data ──────────────────────────────────────────────

const mockProjects: Project[] = []
const mockSessions: Session[] = []

vi.mock('@/hooks/use-projects', () => ({
  useProjects: () => ({ data: mockProjects }),
}))

const useSessionsCalls: Array<number | null> = []

vi.mock('@/hooks/use-sessions', () => ({
  useSessions: (projectId: number | null) => {
    useSessionsCalls.push(projectId)
    return { data: mockSessions }
  },
}))

const mockUpdateSessionSlug = vi.fn((_id: string, _slug: string) => Promise.resolve({ ok: true }))
const mockRenameProject = vi.fn((_id: number, _name: string) => Promise.resolve({ ok: true }))

vi.mock('@/lib/api-client', () => ({
  api: {
    updateSessionSlug: (id: string, slug: string) => mockUpdateSessionSlug(id, slug),
    renameProject: (id: number, name: string) => mockRenameProject(id, name),
    getProjects: vi.fn(() => Promise.resolve([])),
    getSessions: vi.fn(() => Promise.resolve([])),
  },
}))

function setMockProjects(projects: Project[]) {
  mockProjects.length = 0
  mockProjects.push(...projects)
}

function setMockSessions(sessions: Session[]) {
  mockSessions.length = 0
  mockSessions.push(...sessions)
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 1,
    slug: 'my-session',
    status: 'active',
    startedAt: Date.now() - 60000,
    stoppedAt: null,
    metadata: null,
    agentCount: 1,
    eventCount: 5,
    lastActivity: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalDurationMs: 0,
    llmCallCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  mockProjects.length = 0
  mockSessions.length = 0
  useSessionsCalls.length = 0
  mockUpdateSessionSlug.mockClear()
  mockRenameProject.mockClear()

  setMockProjects([
    { id: 1, slug: 'test-project', name: 'Test Project', createdAt: Date.now(), sessionCount: 1 },
  ])

  setMockSessions([makeSession()])

  useUIStore.setState({
    selectedProjectId: 1,
    selectedSessionId: null,
    sidebarCollapsed: false,
  })
})

describe('ProjectList - Session edit', () => {
  it('should render a pencil edit icon on session items', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-session-sess-1')
    expect(editIcon).toBeInTheDocument()
  })

  it('should open the session edit modal when pencil icon is clicked', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-session-sess-1')
    fireEvent.click(editIcon)

    expect(useUIStore.getState().editingSessionId).toBe('sess-1')
  })

  it('should not trigger session selection when clicking the pencil icon', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-session-sess-1')
    fireEvent.click(editIcon)

    // Should not have selected the session (it was null before)
    const state = useUIStore.getState()
    expect(state.selectedSessionId).toBeNull()
  })
})

describe('ProjectList - Project edit modal', () => {
  it('should render a pencil edit icon on project items', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-project-1')
    expect(editIcon).toBeInTheDocument()
  })

  it('should display project name', () => {
    setMockProjects([
      { id: 1, slug: 'test-project', name: 'Test Project', createdAt: Date.now(), sessionCount: 1 },
    ])

    renderWithProviders(<ProjectList collapsed={false} />)

    expect(screen.getByText('Test Project')).toBeInTheDocument()
  })

  it('should open project modal when pencil icon is clicked', async () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-project-1')
    fireEvent.click(editIcon)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('should not toggle project expand/collapse when clicking the pencil icon', () => {
    // Project is already expanded (selectedProjectId = 1)
    renderWithProviders(<ProjectList collapsed={false} />)

    const editIcon = screen.getByTestId('edit-project-1')
    fireEvent.click(editIcon)

    // Should still be expanded (selectedProjectId should not have changed)
    const state = useUIStore.getState()
    expect(state.selectedProjectId).toBe(1)
  })
})

describe('ProjectList - per-project fetch fan-out', () => {
  const otherProject: Project = {
    id: 2,
    slug: 'other-project',
    name: 'Other Project',
    createdAt: Date.now(),
    sessionCount: 3,
  }

  beforeEach(() => {
    setMockProjects([
      { id: 1, slug: 'test-project', name: 'Test Project', createdAt: Date.now(), sessionCount: 1 },
      otherProject,
    ])
    useUIStore.setState({ notificationsEnabled: true, projectPulses: {} })
    clearNotification('sess-in-project-2', Date.now())
  })

  it('only fetches sessions for the expanded project', () => {
    renderWithProviders(<ProjectList collapsed={false} />)

    expect(useSessionsCalls).toContain(1)
    expect(useSessionsCalls).not.toContain(2)
  })

  it('only fetches sessions for the expanded project when collapsed', () => {
    renderWithProviders(<ProjectList collapsed={true} />)

    expect(useSessionsCalls).not.toContain(2)
  })

  it('shows the folder bell for a notification in a non-expanded project', () => {
    pushNotification({ sessionId: 'sess-in-project-2', projectId: 2, ts: Date.now() })
    renderWithProviders(<ProjectList collapsed={false} />)

    expect(screen.getAllByRole('button', { name: 'Click to dismiss' })).toHaveLength(1)
  })

  it('pulses the folder of a non-expanded project from its project pulse counter', () => {
    const { container } = renderWithProviders(<ProjectList collapsed={false} />)
    expect(container.querySelector('.animate-ping')).toBeNull()

    act(() => {
      useUIStore.getState().pulseSession('sess-in-project-2', 2)
    })

    expect(container.querySelector('.animate-ping')).not.toBeNull()
  })
})
