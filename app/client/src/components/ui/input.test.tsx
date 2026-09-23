import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Input } from './input'

// On the dark slate palette --input is --rule (#23252d) over a #0a0c10 page:
// the old `dark:bg-input/30` fill and an --input border were both near
// invisible, so fields read as bare text. The field needs a visible fill, an
// edge distinct from that fill, and a hover lift.
describe('Input dark-mode contrast', () => {
  it('has a visible fill, a distinct border and a hover lift in dark mode', () => {
    render(<Input placeholder="name" />)
    const cls = screen.getByPlaceholderText('name').className.split(/\s+/)

    expect(cls).not.toContain('dark:bg-input/30')
    expect(cls).toContain('dark:bg-input/70')
    expect(cls).toContain('dark:border-ink-4')
    expect(cls).toContain('dark:hover:bg-ink-4/60')
    expect(cls).toContain('dark:hover:border-ink-3')
    // The background change must animate with the rest.
    expect(cls.some((c) => c.startsWith('transition-[') && c.includes('background-color'))).toBe(
      true,
    )
  })

  it('still lets callers override the fill', () => {
    render(<Input placeholder="x" className="bg-transparent dark:bg-transparent" />)
    const cls = screen.getByPlaceholderText('x').className.split(/\s+/)
    expect(cls).toContain('dark:bg-transparent')
    expect(cls).not.toContain('dark:bg-input/70')
  })
})
