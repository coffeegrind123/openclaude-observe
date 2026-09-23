import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SessionList } from './session-list'
import { pushNotification } from '@/components/sidebar/notification-indicator'
import { useUIStore } from '@/stores/ui-store'
import type { Session } from '@/types'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-bell',
    projectId: 1,
    slug: 'bell-session',
    status: 'active',
    startedAt: Date.now() - 60000,
    stoppedAt: null,
    metadata: null,
    agentCount: 1,
    eventCount: 3,
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

describe('SessionList row with a pending notification', () => {
  beforeEach(() => {
    useUIStore.setState({ notificationsEnabled: true })
    pushNotification({ sessionId: 'sess-bell', projectId: 1, ts: Date.now() })
  })

  it('does not nest the notification <button> inside another <button>', () => {
    const { container } = render(<SessionList sessions={[makeSession()]} />)

    expect(screen.getByRole('button', { name: 'Click to dismiss' })).toBeInTheDocument()
    expect(container.querySelector('button button')).toBeNull()
  })

  it('selects the session on Enter on the row but not on Enter on the bell', () => {
    const openSession = vi.fn()
    useUIStore.setState({ openSession })
    render(<SessionList sessions={[makeSession()]} />)

    const bell = screen.getByRole('button', { name: 'Click to dismiss' })
    fireEvent.keyDown(bell, { key: 'Enter' })
    expect(openSession).not.toHaveBeenCalled()

    const row = screen.getByText('bell-session').closest('[role="button"]') as HTMLElement
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(openSession).toHaveBeenCalledWith(1, '', 'sess-bell')
  })
})
