import { describe, it, expect } from 'vitest'
import { cn, isNewerVersion } from './utils'

describe('cn', () => {
  it('should merge tailwind classes resolving conflicts', () => {
    // twMerge removes the earlier class when a later one conflicts
    expect(cn('px-4', 'px-2')).toBe('px-2')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500')
  })

  it('should handle conditional classes', () => {
    expect(cn('base', false && 'hidden', 'extra')).toBe('base extra')
    expect(cn('base', undefined, null, 'extra')).toBe('base extra')
    expect(cn('base', 0 && 'hidden', 'extra')).toBe('base extra')
  })

  it('should handle array inputs', () => {
    expect(cn(['px-4', 'py-2'])).toBe('px-4 py-2')
    expect(cn(['px-4', 'py-2'], 'mt-1')).toBe('px-4 py-2 mt-1')
  })

  it('should handle object inputs', () => {
    expect(cn({ 'text-red-500': true, 'text-blue-500': false })).toBe('text-red-500')
    expect(cn('base', { 'text-red-500': true })).toBe('base text-red-500')
  })

  it('should return empty string for no inputs', () => {
    expect(cn()).toBe('')
  })

  it('should return empty string for all falsy inputs', () => {
    expect(cn(false, undefined, null, '')).toBe('')
    expect(cn(0, false, null)).toBe('')
  })

  it('should handle single string input', () => {
    expect(cn('px-4')).toBe('px-4')
  })

  it('should merge non-conflicting classes', () => {
    expect(cn('px-4', 'py-2', 'text-red-500')).toBe('px-4 py-2 text-red-500')
  })

  it('should preserve !important classes separately from non-important', () => {
    // tailwind-merge treats !px-4 and px-2 as different utilities,
    // so both are preserved when they come from different sources
    expect(cn('!px-4', 'px-2')).toBe('!px-4 px-2')
  })

  it('should keep both classes when !important differs from non-important', () => {
    // tailwind-merge treats px-4 and !px-2 as different utilities since
    // the !important modifier changes the class identity
    expect(cn('px-4', '!px-2')).toBe('px-4 !px-2')
  })
})

describe('isNewerVersion', () => {
  describe('semver format (x.y.z)', () => {
    it('should detect newer patch version', () => {
      expect(isNewerVersion('0.8.6', '0.8.7')).toBe(true)
      expect(isNewerVersion('0.8.7', '0.8.6')).toBe(false)
    })

    it('should detect newer minor version', () => {
      expect(isNewerVersion('0.8.6', '0.9.0')).toBe(true)
      expect(isNewerVersion('0.9.0', '0.8.6')).toBe(false)
    })

    it('should detect newer major version', () => {
      expect(isNewerVersion('0.8.6', '1.0.0')).toBe(true)
      expect(isNewerVersion('1.0.0', '0.8.6')).toBe(false)
    })

    it('should detect version from 1.x to 2.x', () => {
      expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true)
      expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false)
    })

    it('should return false when versions are the same', () => {
      expect(isNewerVersion('0.8.6', '0.8.6')).toBe(false)
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    })

    it('should return false when current is newer than latest', () => {
      expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false)
      expect(isNewerVersion('0.9.0', '0.8.6')).toBe(false)
    })

    it('should compare across different segment counts within semver range', () => {
      // 0.10.0 → 10*10000 + 0 = 100000 (two parts treated as reduce)
      // Actually wait: 0.10.0 has three parts and p[2]=0 < 2000, so uses reduce:
      // [0,10,0] → 0*10000^2 + 10*10000^1 + 0 = 100000
      // 0.9.0 → [0,9,0] → 0*10000^2 + 9*10000^1 + 0 = 90000
      // So 0.10.0 > 0.9.0 which is correct
      expect(isNewerVersion('0.9.0', '0.10.0')).toBe(true)
    })
  })

  describe('date-based format (DD.MM.YYYY)', () => {
    it('should treat DD.MM.YYYY as a sortable date number', () => {
      expect(isNewerVersion('25.12.2024', '01.01.2025')).toBe(true)
      expect(isNewerVersion('01.01.2025', '25.12.2024')).toBe(false)
    })

    it('should detect newer year', () => {
      expect(isNewerVersion('01.01.2023', '01.01.2024')).toBe(true)
      expect(isNewerVersion('01.01.2024', '01.01.2023')).toBe(false)
    })

    it('should detect newer month in same year', () => {
      expect(isNewerVersion('15.01.2024', '15.02.2024')).toBe(true)
      expect(isNewerVersion('15.12.2024', '15.01.2024')).toBe(false)
    })

    it('should detect newer day in same month', () => {
      expect(isNewerVersion('01.01.2024', '02.01.2024')).toBe(true)
      expect(isNewerVersion('31.01.2024', '01.01.2024')).toBe(false)
    })

    it('should handle year boundaries', () => {
      expect(isNewerVersion('31.12.2023', '01.01.2024')).toBe(true)
      expect(isNewerVersion('01.01.2024', '31.12.2023')).toBe(false)
    })

    it('should return false when dates are the same', () => {
      expect(isNewerVersion('01.01.2024', '01.01.2024')).toBe(false)
    })

    it('should distinguish date-based from semver at year >= 2000 boundary', () => {
      // 1.0.2000 → p[2]=2000 >= 2000, so date-based: 2000*10000 + 0*100 + 1 = 20000001
      // 1.0.2024 → p[2]=2024 >= 2000, so date-based: 2024*10000 + 0*100 + 1 = 20240001
      expect(isNewerVersion('1.0.2000', '1.0.2024')).toBe(true)
      expect(isNewerVersion('1.0.2024', '1.0.2000')).toBe(false)
    })
  })

  describe('v-prefix handling', () => {
    it('should strip leading v from current version', () => {
      expect(isNewerVersion('v0.8.6', '0.8.7')).toBe(true)
    })

    it('should strip leading v from latest version', () => {
      expect(isNewerVersion('0.8.6', 'v0.8.7')).toBe(true)
    })

    it('should strip leading v from both versions', () => {
      expect(isNewerVersion('v0.8.6', 'v0.8.7')).toBe(true)
    })

    it('should handle v prefix with same versions', () => {
      expect(isNewerVersion('v0.8.6', '0.8.6')).toBe(false)
      expect(isNewerVersion('v0.8.6', 'v0.8.6')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle two-segment versions as semver', () => {
      // 0.8 → [0, 8], p.length=2, no date detection
      // p.reduce: 0*10000^1 + 8*10000^0 = 80000
      // 0.9 → [0, 9] → 90000
      expect(isNewerVersion('0.8', '0.9')).toBe(true)
      expect(isNewerVersion('0.9', '0.8')).toBe(false)
    })

    it('should handle single-segment versions', () => {
      // 1 → [1], reduce: 1*10000^0 = 1
      // 2 → [2], reduce: 2*10000^0 = 2
      expect(isNewerVersion('1', '2')).toBe(true)
      expect(isNewerVersion('2', '1')).toBe(false)
    })

    it('should handle leading zeros in segments', () => {
      // 0.08.06 → [0, 8, 6], p[2]=6 < 2000 → semver: 80006
      // 0.08.07 → [0, 8, 7] → 80007
      // Number("08") = 8 in JS
      expect(isNewerVersion('0.08.06', '0.08.07')).toBe(true)
    })

    it('should handle empty string', () => {
      // ''.split('.') → [''], map(Number) → [0]
      // 0 < 2000? Not really applicable with length 1.
      // reduce: 0*10000^0 = 0
      // ''.split('.').map(Number) → [NaN] for ''?
      // Actually: ''.split('.') → [''], Number('') → 0
      // So '' → [0] → 0
      expect(isNewerVersion('', '1.0.0')).toBe(true)
    })

    it('should not crash with non-numeric segments (NaN)', () => {
      // Number('abc') → NaN, and NaN * Math.pow(...) = NaN
      // reduce with NaN: NaN + NaN = NaN
      // So these will produce NaN comparisons; the function
      // relies on valid version strings.
      // Just verify it doesn't throw.
      expect(() => isNewerVersion('abc', 'def')).not.toThrow()
    })

    it('should handle versions with more than 3 segments', () => {
      // 1.2.3.4 → [1,2,3,4], p.length=4, no date path (p[2]=3 < 2000)
      // reduce: 1*10000^3 + 2*10000^2 + 3*10000^1 + 4*10000^0
      // = 1_000_000_000_000 + 200_000_000 + 30_000 + 4
      expect(isNewerVersion('1.2.3.4', '1.2.3.5')).toBe(true)
    })

    it('should correctly compare date vs semver when year < 2000', () => {
      // 1.1.1999 → p[2]=1999 < 2000, so semver path (not date)
      // This is an ambiguous case but the code treats it as semver
      expect(isNewerVersion('1.1.1999', '2.1.1999')).toBe(true)
    })
  })
})
