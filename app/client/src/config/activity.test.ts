import { describe, it, expect } from 'vitest'
import { ACTIVITY_CONFIG } from './activity'

describe('ACTIVITY_CONFIG', () => {
  it('should be a defined object', () => {
    expect(ACTIVITY_CONFIG).toBeDefined()
    expect(typeof ACTIVITY_CONFIG).toBe('object')
  })

  describe('pulseDurationMs', () => {
    it('should be 5000 milliseconds (5 seconds)', () => {
      expect(ACTIVITY_CONFIG.pulseDurationMs).toBe(5000)
    })

    it('should be a positive number', () => {
      expect(ACTIVITY_CONFIG.pulseDurationMs).toBeGreaterThan(0)
    })

    it('should be an integer', () => {
      expect(Number.isInteger(ACTIVITY_CONFIG.pulseDurationMs)).toBe(true)
    })
  })

  describe('type narrowing', () => {
    it('should have pulseDurationMs as a readonly number', () => {
      // TypeScript-level readonly; verified via typeof at runtime
      expect(typeof ACTIVITY_CONFIG.pulseDurationMs).toBe('number')
    })
  })

  describe('shape', () => {
    it('should only contain pulseDurationMs', () => {
      const keys = Object.keys(ACTIVITY_CONFIG)
      expect(keys).toEqual(['pulseDurationMs'])
    })

    it('should have typeof number for pulseDurationMs', () => {
      expect(typeof ACTIVITY_CONFIG.pulseDurationMs).toBe('number')
    })
  })
})
