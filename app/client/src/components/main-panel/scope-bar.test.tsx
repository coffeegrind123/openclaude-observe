import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { ScopeBar } from './scope-bar'
import { useUIStore } from '@/stores/ui-store'

vi.mock('@/lib/api-client', () => ({
  api: {
    getEvents: () => Promise.resolve([]),
    getAgents: () => Promise.resolve([]),
    getAgent: () => Promise.resolve(null),
  },
}))

beforeEach(() => {
  useUIStore.setState({
    selectedProjectId: null,
    selectedProjectSlug: null,
    selectedSessionId: null,
    selectedAgentIds: [],
    expandedEventIds: new Set(),
  })
})

describe('ScopeBar', () => {
  // A `#/_/<sessionId>` link selects the session before (or without) its
  // project; the agent picker and session buttons must render anyway.
  it('renders for a session whose project is not resolved', () => {
    useUIStore.setState({ selectedProjectId: null, selectedSessionId: 'sess-1' })

    renderWithProviders(<ScopeBar />)

    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByLabelText('Session stats')).toBeInTheDocument()
    expect(screen.getByLabelText('Edit session')).toBeInTheDocument()
  })

  it('renders when a project is selected', () => {
    useUIStore.setState({ selectedProjectId: 1, selectedSessionId: 'sess-1' })

    renderWithProviders(<ScopeBar />)

    expect(screen.getByText('Agents')).toBeInTheDocument()
  })

  it('renders nothing without a session', () => {
    useUIStore.setState({ selectedProjectId: 1, selectedSessionId: null })

    const { container } = renderWithProviders(<ScopeBar />)

    expect(container).toBeEmptyDOMElement()
  })
})
