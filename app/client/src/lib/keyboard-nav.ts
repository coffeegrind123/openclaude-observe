/**
 * Keyboard navigation helpers for focusable sibling lists.
 */

// Overload: keyboard-event driven navigation (used by sidebar)
export function focusSiblingMatching(
  e: React.KeyboardEvent,
  selector: string,
): void

// Overload: programmatic direction-based navigation (used by other callers)
export function focusSiblingMatching(
  current: HTMLElement,
  selector: string,
  container: HTMLElement,
  direction: -1 | 1,
): boolean

export function focusSiblingMatching(
  eOrCurrent: React.KeyboardEvent | HTMLElement,
  selector: string,
  container?: HTMLElement,
  direction?: -1 | 1,
): boolean | void {
  // Keyboard event path (2 args)
  if (container === undefined && direction === undefined) {
    const e = eOrCurrent as React.KeyboardEvent
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

    e.preventDefault()
    e.stopPropagation()

    const current = document.activeElement as HTMLElement | null
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ).filter((el) => el.offsetParent !== null) // visible only

    if (items.length === 0) return

    const idx = items.indexOf(current as HTMLElement)
    const next =
      e.key === 'ArrowDown'
        ? idx < 0
          ? 0
          : (idx + 1) % items.length
        : idx < 0
          ? items.length - 1
          : (idx - 1 + items.length) % items.length

    items[next]?.focus()
    return
  }

  // Programmatic path (4 args) — existing behavior
  const current = eOrCurrent as HTMLElement
  const items = Array.from(container!.querySelectorAll<HTMLElement>(selector))
  const idx = items.indexOf(current)
  if (idx === -1) return false
  const next = items[idx + direction!]
  if (!next) return false
  next.focus()
  return true
}
