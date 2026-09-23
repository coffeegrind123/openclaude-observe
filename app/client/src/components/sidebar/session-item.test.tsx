import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { SessionItem } from './session-item'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Session } from '@/types'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: '01a0cea5-b997-73d4-853f-9a594c831c4e',
    projectId: 1,
    slug: 'my-session',
    status: 'active',
    startedAt: Date.now() - 60_000,
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

function renderItem(props: Partial<React.ComponentProps<typeof SessionItem>> = {}): {
  onSelect: ReturnType<typeof vi.fn>
  onRename: ReturnType<typeof vi.fn>
} {
  const onSelect = vi.fn()
  const onRename = vi.fn(async () => {})
  renderWithProviders(
    <TooltipProvider>
      <SessionItem
        session={makeSession()}
        isSelected={false}
        isPinned={false}
        onSelect={onSelect}
        onTogglePin={() => {}}
        onRename={onRename}
        {...props}
      />
    </TooltipProvider>,
  )
  return { onSelect, onRename }
}

function row(): HTMLElement {
  return screen.getAllByText('my-session')[0].closest('[role="button"]') as HTMLElement
}

describe('SessionItem accessibility', () => {
  it('is a focusable sidebar item', () => {
    renderItem()
    expect(row()).toHaveAttribute('tabindex', '0')
    expect(row()).toHaveAttribute('data-sidebar-item')
    expect(row()).not.toHaveAttribute('aria-current')
  })

  it('marks the selected session with aria-current', () => {
    renderItem({ isSelected: true })
    expect(row()).toHaveAttribute('aria-current', 'true')
  })

  it('selects on Enter and Space', () => {
    const { onSelect } = renderItem()
    fireEvent.keyDown(row(), { key: 'Enter' })
    fireEvent.keyDown(row(), { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })
})

describe('SessionItem inline rename', () => {
  it("keys typed into the rename box don't select the session", () => {
    const { onSelect, onRename } = renderItem()
    fireEvent.doubleClick(screen.getByText('my-session'))

    const input = screen.getByDisplayValue('my-session')
    // The row leaves the tab order while its name is being edited.
    expect(input.closest('[role="button"]')).toHaveAttribute('tabindex', '-1')

    fireEvent.change(input, { target: { value: 'renamed with space' } })
    fireEvent.keyDown(input, { key: ' ' })
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onRename).toHaveBeenCalledWith(
      '01a0cea5-b997-73d4-853f-9a594c831c4e',
      'renamed with space',
    )
  })

  it('Escape cancels without renaming', () => {
    const { onRename } = renderItem()
    fireEvent.doubleClick(screen.getByText('my-session'))
    const input = screen.getByDisplayValue('my-session')
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getAllByText('my-session').length).toBeGreaterThan(0)
  })
})
