import { useEffect } from 'react'

interface Region {
  target: string
  key: string
  label: string
}

function isTextInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  const htmlEl = el as HTMLElement
  if (htmlEl.isContentEditable || htmlEl.contentEditable === 'true') return true
  return false
}

function clearActiveRegion() {
  document.querySelectorAll<HTMLElement>('[data-region-active]').forEach((el) => {
    el.removeAttribute('data-region-active')
  })
}

function setActiveRegion(selector: string) {
  const target = document.querySelector<HTMLElement>(selector)
  if (!target) return
  clearActiveRegion()
  target.setAttribute('data-region-active', '')
}

function focusSearch() {
  const target = document.querySelector<HTMLElement>('[data-region-target="search"]')
  if (target) {
    clearActiveRegion()
    target.focus()
  }
}

function clickAgentsTrigger() {
  const target = document.querySelector<HTMLElement>('[data-region-target="agents"]')
  target?.click()
}

function focusFirstFilterPill() {
  const target = document.querySelector<HTMLElement>('[data-filter-pill]')
  target?.focus()
}

function focusSidebar() {
  const selected = document.querySelector<HTMLElement>('[data-sidebar-item][aria-current="true"]')
  const target = selected ?? document.querySelector<HTMLElement>('[data-sidebar-item]')
  target?.focus()
}

function focusEventStream() {
  const target = document.querySelector<HTMLElement>('[data-region-target="events"]')
  if (target) {
    setActiveRegion('[data-region-target="events"]')
    target.focus()
  }
}

export function useRegionShortcuts(opts?: { regions?: Region[] }) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.defaultPrevented) return
      if (isTextInputFocused()) return

      switch (e.key) {
        case '/':
        case 's':
          e.preventDefault()
          focusSearch()
          return
        case 'a':
          e.preventDefault()
          clickAgentsTrigger()
          return
        case 'f':
          e.preventDefault()
          focusFirstFilterPill()
          return
        case 'b':
          e.preventDefault()
          focusSidebar()
          return
        case 'e':
          e.preventDefault()
          focusEventStream()
          return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const shortcuts = {
    onKeyDown: (e: KeyboardEvent) => {
      // Scrolling shortcuts for the active region (e.g. event stream)
      if (e.ctrlKey || e.altKey) return
      if (isTextInputFocused()) return

      const activeRegionEl = document.querySelector<HTMLElement>('[data-region-active]')
      if (!activeRegionEl) return

      const scrollBy = (delta: number) => {
        activeRegionEl.scrollBy({ top: delta, behavior: 'auto' })
      }

      switch (e.key) {
        case 'ArrowUp':
          if (e.metaKey) {
            e.preventDefault()
            activeRegionEl.scrollTo({ top: 0, behavior: 'auto' })
          } else {
            e.preventDefault()
            scrollBy(-40)
          }
          return
        case 'ArrowDown':
          if (e.metaKey) {
            e.preventDefault()
            activeRegionEl.scrollTo({ top: activeRegionEl.scrollHeight, behavior: 'auto' })
          } else {
            e.preventDefault()
            scrollBy(40)
          }
          return
        case 'PageUp':
          e.preventDefault()
          scrollBy(-activeRegionEl.clientHeight * 0.8)
          return
        case 'PageDown':
          e.preventDefault()
          scrollBy(activeRegionEl.clientHeight * 0.8)
          return
        case 'Home':
          e.preventDefault()
          activeRegionEl.scrollTo({ top: 0, behavior: 'auto' })
          return
        case 'End':
          e.preventDefault()
          activeRegionEl.scrollTo({ top: activeRegionEl.scrollHeight, behavior: 'auto' })
          return
      }
    },
  }

  return { shortcuts }
}
