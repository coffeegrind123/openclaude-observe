import { describe, it, expect } from 'vitest'
import { formatTokens } from './format-utils'

describe('formatTokens', () => {
  describe('small numbers (< 1000)', () => {
    it('should return the number as string unchanged', () => {
      expect(formatTokens(0)).toBe('0')
      expect(formatTokens(1)).toBe('1')
      expect(formatTokens(42)).toBe('42')
      expect(formatTokens(999)).toBe('999')
    })
  })

  describe('thousands (1,000 to 999,999)', () => {
    it('should format numbers >= 1000 with k suffix', () => {
      expect(formatTokens(1000)).toBe('1.0k')
      expect(formatTokens(1100)).toBe('1.1k')
      expect(formatTokens(1500)).toBe('1.5k')
      expect(formatTokens(9999)).toBe('10.0k')
    })

    it('should round to 1 decimal place', () => {
      // 1234 / 1000 = 1.234 → toFixed(1) → "1.2"
      expect(formatTokens(1234)).toBe('1.2k')
      // 1567 / 1000 = 1.567 → toFixed(1) → "1.6"
      expect(formatTokens(1567)).toBe('1.6k')
    })

    it('should handle numbers near the boundary', () => {
      expect(formatTokens(999)).toBe('999')
      expect(formatTokens(1000)).toBe('1.0k')
      expect(formatTokens(1001)).toBe('1.0k')
      expect(formatTokens(999999)).toBe('1000.0k')
    })
  })

  describe('millions (>= 1,000,000)', () => {
    it('should format numbers >= 1 million with M suffix', () => {
      expect(formatTokens(1000000)).toBe('1.0M')
      expect(formatTokens(1500000)).toBe('1.5M')
      expect(formatTokens(2000000)).toBe('2.0M')
    })

    it('should round to 1 decimal place for millions', () => {
      // 1234567 / 1000000 = 1.234567 → toFixed(1) → "1.2"
      expect(formatTokens(1234567)).toBe('1.2M')
      // 1999999 / 1000000 = 1.999999 → toFixed(1) → "2.0"
      expect(formatTokens(1999999)).toBe('2.0M')
    })

    it('should handle very large numbers', () => {
      expect(formatTokens(100000000)).toBe('100.0M')
      expect(formatTokens(999999999)).toBe('1000.0M')
    })
  })

  describe('negative numbers', () => {
    it('should return negative numbers as string unchanged', () => {
      // In JS, -1 >= 1000 is false, -1 >= 1000000 is false
      // So negative numbers fall through to String(n)
      expect(formatTokens(-1)).toBe('-1')
      expect(formatTokens(-100)).toBe('-100')
      expect(formatTokens(-999)).toBe('-999')
      expect(formatTokens(-1000)).toBe('-1000')
      expect(formatTokens(-1000000)).toBe('-1000000')
    })
  })

  describe('zero and edge cases', () => {
    it('should handle 0', () => {
      expect(formatTokens(0)).toBe('0')
    })

    it('should handle very small positive numbers', () => {
      expect(formatTokens(0.5)).toBe('0.5')
      expect(formatTokens(1e-10)).toBe('1e-10')
    })

    it('should handle typical LLM context sizes', () => {
      // A realistic range of token counts
      expect(formatTokens(500)).toBe('500')
      expect(formatTokens(2000)).toBe('2.0k')
      expect(formatTokens(32768)).toBe('32.8k')
      expect(formatTokens(100000)).toBe('100.0k')
      expect(formatTokens(200000)).toBe('200.0k')
      expect(formatTokens(1000000)).toBe('1.0M')
      expect(formatTokens(5000000)).toBe('5.0M')
    })
  })
})
