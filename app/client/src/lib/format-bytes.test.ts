import { describe, it, expect } from 'vitest'
import { formatBytes } from './format-bytes'

describe('formatBytes', () => {
  describe('zero', () => {
    it('should return "0 B" for zero bytes', () => {
      expect(formatBytes(0)).toBe('0 B')
    })
  })

  describe('bytes (B)', () => {
    it('should format values < 1024 as plain bytes', () => {
      expect(formatBytes(1)).toBe('1 B')
      expect(formatBytes(42)).toBe('42 B')
      expect(formatBytes(512)).toBe('512 B')
      expect(formatBytes(1023)).toBe('1023 B')
    })
  })

  describe('kilobytes (KB)', () => {
    it('should format values in KB range with 1 decimal for small values', () => {
      expect(formatBytes(1024)).toBe('1.0 KB')
      expect(formatBytes(1536)).toBe('1.5 KB')
      expect(formatBytes(2048)).toBe('2.0 KB')
      expect(formatBytes(10240 - 1)).toBe('10.0 KB')
    })

    it('should switch to rounded integer for values >= 10 * unit', () => {
      // 10240 / 1024 = 10, value >= 10 → Math.round → 10
      expect(formatBytes(10240)).toBe('10 KB')
      expect(formatBytes(50000)).toBe('49 KB') // 50000/1024 ≈ 48.8 → round → 49
      expect(formatBytes(102400)).toBe('100 KB')
    })
  })

  describe('megabytes (MB)', () => {
    it('should format values in MB range with 1 decimal for small values', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB') // 1024 * 1024
      expect(formatBytes(1572864)).toBe('1.5 MB') // 1.5 * 1024^2
      expect(formatBytes(2097152)).toBe('2.0 MB')
      expect(formatBytes(9437184)).toBe('9.0 MB')
    })

    it('should switch to rounded integer for values >= 10 MB', () => {
      expect(formatBytes(10485760)).toBe('10 MB') // 10 * 1024^2
      expect(formatBytes(104857600)).toBe('100 MB') // 100 * 1024^2
      expect(formatBytes(52428800)).toBe('50 MB') // 50 * 1024^2
    })
  })

  describe('gigabytes (GB)', () => {
    it('should format values in GB range with 1 decimal for small values', () => {
      expect(formatBytes(1073741824)).toBe('1.0 GB') // 1024^3
      expect(formatBytes(1610612736)).toBe('1.5 GB')
      expect(formatBytes(2147483648)).toBe('2.0 GB')
      expect(formatBytes(9663676416)).toBe('9.0 GB')
    })

    it('should switch to rounded integer for values >= 10 GB', () => {
      expect(formatBytes(10737418240)).toBe('10 GB') // 10 * 1024^3
      expect(formatBytes(107374182400)).toBe('100 GB')
    })
  })

  describe('terabytes (TB)', () => {
    it('should format values in TB range', () => {
      expect(formatBytes(1099511627776)).toBe('1.0 TB') // 1024^4
      expect(formatBytes(1649267441664)).toBe('1.5 TB')
      expect(formatBytes(10995116277760)).toBe('10 TB')
    })
  })

  describe('rounding behavior', () => {
    it('should round up at 0.05 threshold for toFixed(1)', () => {
      // 1075 / 1024 ≈ 1.0498... → toFixed(1) → "1.0"
      expect(formatBytes(1075)).toBe('1.0 KB')
      // 1100 / 1024 ≈ 1.0742... → toFixed(1) → "1.1"
      expect(formatBytes(1100)).toBe('1.1 KB')
    })

    it('should use Math.round for values >= 10 of the unit', () => {
      // 10752 / 1024 = 10.5 → Math.round → 11
      expect(formatBytes(10752)).toBe('11 KB')
      // 10240 / 1024 = 10 → Math.round → 10
      expect(formatBytes(10240)).toBe('10 KB')
    })
  })

  describe('large and boundary values', () => {
    it('should handle typical OS/container memory sizes', () => {
      expect(formatBytes(256 * 1024 * 1024)).toBe('256 MB') // 256 MiB
      expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB')
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB') // 1 GiB
      expect(formatBytes(4 * 1024 * 1024 * 1024)).toBe('4.0 GB') // 4 GiB
    })

    it('should handle Numbers up to TB range without overflow', () => {
      // Number.MAX_SAFE_INTEGER ≈ 9 PB, well within 5-unit range
      expect(() => formatBytes(Number.MAX_SAFE_INTEGER)).not.toThrow()
    })
  })
})
