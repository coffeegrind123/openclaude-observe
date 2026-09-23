import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { PI_SESSION_ID } from '@/test/pi-fixture'

const { getSession, getProjects } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getProjects: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ api: { getSession, getProjects } }))

const { useRouteSync } = await import('./use-route-sync')

const PROJECT = { id: 3, slug: 'piproj', name: 'piproj' }

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  getSession.mockReset()
  getProjects.mockReset()
  getProjects.mockResolvedValue([PROJECT])
  getSession.mockImplementation(async (id: string) => {
    if (id === PI_SESSION_ID) {
      return { id, projectId: PROJECT.id, projectSlug: PROJECT.slug }
    }
    throw new Error('404')
  })
  window.history.replaceState(null, '', '#/')
  useUIStore.setState({
    view: 'observe',
    selectedProjectId: null,
    selectedProjectSlug: null,
    selectedSessionId: null,
    editingSessionId: null,
    editingSessionTab: 'details',
    deepLinkView: null,
    routeError: null,
  })
})

describe('useRouteSync', () => {
  it('`#/_/<id>` resolves the project from the session and rewrites the URL in place', async () => {
    window.history.replaceState(null, '', `#/_/${PI_SESSION_ID}`)
    useUIStore.setState({ selectedSessionId: PI_SESSION_ID })
    const before = window.history.length

    renderHook(() => useRouteSync(), { wrapper })

    await waitFor(() => expect(useUIStore.getState().selectedProjectId).toBe(PROJECT.id))
    expect(useUIStore.getState().selectedProjectSlug).toBe('piproj')
    await waitFor(() => expect(window.location.hash).toBe(`#/piproj/${PI_SESSION_ID}`))
    // replaceState, not pushState
    expect(window.history.length).toBe(before)
  })

  it('a stale project segment is corrected from the session', async () => {
    window.history.replaceState(null, '', `#/wrong-project/${PI_SESSION_ID}`)
    useUIStore.setState({ selectedSessionId: PI_SESSION_ID, selectedProjectSlug: 'wrong-project' })

    renderHook(() => useRouteSync(), { wrapper })

    await waitFor(() => expect(window.location.hash).toBe(`#/piproj/${PI_SESSION_ID}`))
    expect(useUIStore.getState().selectedProjectId).toBe(PROJECT.id)
  })

  it('a legacy single-segment `#/<sessionId>` link is looked up as a session', async () => {
    window.history.replaceState(null, '', `#/${PI_SESSION_ID}`)
    useUIStore.setState({ selectedProjectSlug: PI_SESSION_ID })

    renderHook(() => useRouteSync(), { wrapper })

    await waitFor(() => expect(useUIStore.getState().selectedSessionId).toBe(PI_SESSION_ID))
    await waitFor(() => expect(window.location.hash).toBe(`#/piproj/${PI_SESSION_ID}`))
    expect(useUIStore.getState().routeError).toBeNull()
  })

  it('an id that is neither a project nor a session flags a route error', async () => {
    useUIStore.setState({ selectedProjectSlug: 'nope' })
    renderHook(() => useRouteSync(), { wrapper })
    await waitFor(() => expect(useUIStore.getState().routeError).toBe('nope'))
  })

  it('an unknown session id flags a route error', async () => {
    useUIStore.setState({ selectedSessionId: 'gone' })
    renderHook(() => useRouteSync(), { wrapper })
    await waitFor(() => expect(useUIStore.getState().routeError).toBe('gone'))
  })

  it('a `:session.stats` deep link opens the session modal on its stats tab', async () => {
    window.history.replaceState(null, '', `#/piproj/${PI_SESSION_ID}:session.stats`)
    useUIStore.setState({
      selectedSessionId: PI_SESSION_ID,
      selectedProjectSlug: 'piproj',
      deepLinkView: 'session.stats',
    })

    renderHook(() => useRouteSync(), { wrapper })

    await waitFor(() => expect(useUIStore.getState().editingSessionId).toBe(PI_SESSION_ID))
    expect(useUIStore.getState().editingSessionTab).toBe('stats')
    // The canonical URL keeps the suffix.
    await waitFor(() =>
      expect(window.location.hash).toBe(`#/piproj/${PI_SESSION_ID}:session.stats`),
    )
  })

  it('strips an unknown deep-link view', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useUIStore.setState({ selectedSessionId: PI_SESSION_ID, deepLinkView: 'session.bogus' })
    renderHook(() => useRouteSync(), { wrapper })
    await waitFor(() => expect(useUIStore.getState().deepLinkView).toBeNull())
    expect(useUIStore.getState().editingSessionId).toBeNull()
    warn.mockRestore()
  })

  it('leaves the URL alone while the instructions page owns it', async () => {
    window.history.replaceState(null, '', '#/instructions')
    useUIStore.setState({ view: 'instructions', selectedSessionId: PI_SESSION_ID })

    renderHook(() => useRouteSync(), { wrapper })
    await waitFor(() => expect(getProjects).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))

    expect(window.location.hash).toBe('#/instructions')
    expect(getSession).not.toHaveBeenCalled()
  })
})
