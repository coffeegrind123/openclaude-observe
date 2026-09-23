import { describe, it, expect, beforeEach } from 'vitest'
import { migrateStorageKeys } from './storage-migration'

describe('migrateStorageKeys', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renames openclaude-observe-* keys to the current prefix', () => {
    localStorage.setItem('openclaude-observe-pinned-sessions', '["a"]')

    expect(migrateStorageKeys(localStorage)).toBe(1)
    expect(localStorage.getItem('instantcoffee-observe-pinned-sessions')).toBe('["a"]')
    expect(localStorage.getItem('openclaude-observe-pinned-sessions')).toBeNull()
  })

  it('rescues agents-observe-* keys dropped by the previous rebrand', () => {
    localStorage.setItem('agents-observe-labels', '[]')

    migrateStorageKeys(localStorage)
    expect(localStorage.getItem('instantcoffee-observe-labels')).toBe('[]')
  })

  it('prefers the newest legacy prefix when both exist', () => {
    localStorage.setItem('agents-observe-sidebar-tab', 'old')
    localStorage.setItem('openclaude-observe-sidebar-tab', 'newer')

    migrateStorageKeys(localStorage)
    expect(localStorage.getItem('instantcoffee-observe-sidebar-tab')).toBe('newer')
    expect(localStorage.getItem('agents-observe-sidebar-tab')).toBeNull()
  })

  it('never overwrites a key that already uses the current prefix', () => {
    localStorage.setItem('instantcoffee-observe-reverse-feed', 'true')
    localStorage.setItem('openclaude-observe-reverse-feed', 'false')

    expect(migrateStorageKeys(localStorage)).toBe(0)
    expect(localStorage.getItem('instantcoffee-observe-reverse-feed')).toBe('true')
  })

  it('leaves unrelated keys alone and is idempotent', () => {
    localStorage.setItem('app-theme', 'dark')
    localStorage.setItem('openclaude-observe-notifications', 'off')

    migrateStorageKeys(localStorage)
    expect(migrateStorageKeys(localStorage)).toBe(0)
    expect(localStorage.getItem('app-theme')).toBe('dark')
    expect(localStorage.getItem('instantcoffee-observe-notifications')).toBe('off')
  })
})
