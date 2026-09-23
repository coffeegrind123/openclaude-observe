import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IconSettings } from './icon-settings'

describe('IconSettings grouping', () => {
  it('lists the pi event and tool keys from the icon registry, one header per category', () => {
    render(<IconSettings />)

    expect(screen.getAllByText('Tools', { selector: 'span' })).toHaveLength(1)
    expect(screen.getAllByText('Agents', { selector: 'span' })).toHaveLength(1)
    expect(screen.getByText('Injected Prompt')).toBeInTheDocument()
    expect(screen.getByText('browser_* tools')).toBeInTheDocument()
    expect(screen.getByText('Subagent Result')).toBeInTheDocument()
  })

  it('has no OpenClaude-only event types', () => {
    render(<IconSettings />)

    expect(screen.queryByText('Super Mode Toggle')).toBeNull()
    expect(screen.queryByText('Permission Request')).toBeNull()
    expect(screen.queryByText('Daemon Start')).toBeNull()
  })
})
