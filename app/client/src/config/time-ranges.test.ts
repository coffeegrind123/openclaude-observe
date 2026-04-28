import { describe, it, expect } from 'vitest'
import {
  TIME_RANGES,
  TIME_RANGE_KEYS,
  getRangeMs,
  getRangeTicks,
} from './time-ranges'
import type { TimeRange } from './time-ranges'

describe('TIME_RANGES', () => {
  it('should contain all expected keys', () => {
    expect(TIME_RANGES).toHaveProperty('1m')
    expect(TIME_RANGES).toHaveProperty('5m')
    expect(TIME_RANGES).toHaveProperty('10m')
    expect(TIME_RANGES).toHaveProperty('60m')
    expect(TIME_RANGES).toHaveProperty('3h')
    expect(TIME_RANGES).toHaveProperty('24h')
  })

  it('should contain 6 entries', () => {
    expect(Object.keys(TIME_RANGES).length).toBe(6)
  })

  describe('1m', () => {
    it('should have ms = 60,000 (1 minute)', () => {
      expect(TIME_RANGES['1m'].ms).toBe(60_000)
    })

    it('should have 6 ticks', () => {
      expect(TIME_RANGES['1m'].ticks).toBe(6)
    })
  })

  describe('5m', () => {
    it('should have ms = 300,000 (5 minutes)', () => {
      expect(TIME_RANGES['5m'].ms).toBe(300_000)
    })

    it('should have 5 ticks', () => {
      expect(TIME_RANGES['5m'].ticks).toBe(5)
    })
  })

  describe('10m', () => {
    it('should have ms = 600,000 (10 minutes)', () => {
      expect(TIME_RANGES['10m'].ms).toBe(600_000)
    })

    it('should have 5 ticks', () => {
      expect(TIME_RANGES['10m'].ticks).toBe(5)
    })
  })

  describe('60m', () => {
    it('should have ms = 3,600,000 (60 minutes)', () => {
      expect(TIME_RANGES['60m'].ms).toBe(3_600_000)
    })

    it('should have 6 ticks', () => {
      expect(TIME_RANGES['60m'].ticks).toBe(6)
    })
  })

  describe('3h', () => {
    it('should have ms = 10,800,000 (3 hours)', () => {
      expect(TIME_RANGES['3h'].ms).toBe(10_800_000)
    })

    it('should have 6 ticks', () => {
      expect(TIME_RANGES['3h'].ticks).toBe(6)
    })
  })

  describe('24h', () => {
    it('should have ms = 86,400,000 (24 hours)', () => {
      expect(TIME_RANGES['24h'].ms).toBe(86_400_000)
    })

    it('should have 6 ticks', () => {
      expect(TIME_RANGES['24h'].ticks).toBe(6)
    })
  })

  describe('each entry shape', () => {
    it('should have ms and ticks as number properties', () => {
      for (const [key, value] of Object.entries(TIME_RANGES)) {
        expect(typeof value.ms, `${key}.ms should be a number`).toBe('number')
        expect(typeof value.ticks, `${key}.ticks should be a number`).toBe('number')
        expect(value.ms).toBeGreaterThan(0)
        expect(value.ticks).toBeGreaterThan(0)
        expect(Number.isInteger(value.ms)).toBe(true)
        expect(Number.isInteger(value.ticks)).toBe(true)
      }
    })
  })
})

describe('TIME_RANGE_KEYS', () => {
  it('should contain all TIME_RANGES keys in definition order', () => {
    expect(TIME_RANGE_KEYS).toEqual(['1m', '5m', '10m', '60m', '3h', '24h'])
  })

  it('should have the same length as TIME_RANGES entries', () => {
    expect(TIME_RANGE_KEYS.length).toBe(Object.keys(TIME_RANGES).length)
  })

  it('should be typed correctly (all entries are valid TimeRange keys)', () => {
    for (const key of TIME_RANGE_KEYS) {
      expect(key in TIME_RANGES).toBe(true)
    }
  })
})

describe('getRangeMs', () => {
  it('should return ms for each time range', () => {
    expect(getRangeMs('1m')).toBe(60_000)
    expect(getRangeMs('5m')).toBe(300_000)
    expect(getRangeMs('10m')).toBe(600_000)
    expect(getRangeMs('60m')).toBe(3_600_000)
    expect(getRangeMs('3h')).toBe(10_800_000)
    expect(getRangeMs('24h')).toBe(86_400_000)
  })

  it('should return a positive number for every valid key', () => {
    for (const key of TIME_RANGE_KEYS) {
      expect(getRangeMs(key)).toBeGreaterThan(0)
    }
  })

  it('should return consistent values matching TIME_RANGES directly', () => {
    for (const key of TIME_RANGE_KEYS) {
      expect(getRangeMs(key)).toBe(TIME_RANGES[key].ms)
    }
  })
})

describe('getRangeTicks', () => {
  it('should return ticks for each time range', () => {
    expect(getRangeTicks('1m')).toBe(6)
    expect(getRangeTicks('5m')).toBe(5)
    expect(getRangeTicks('10m')).toBe(5)
    expect(getRangeTicks('60m')).toBe(6)
    expect(getRangeTicks('3h')).toBe(6)
    expect(getRangeTicks('24h')).toBe(6)
  })

  it('should return a positive integer for every valid key', () => {
    for (const key of TIME_RANGE_KEYS) {
      const ticks = getRangeTicks(key)
      expect(ticks).toBeGreaterThan(0)
      expect(Number.isInteger(ticks)).toBe(true)
    }
  })

  it('should return consistent values matching TIME_RANGES directly', () => {
    for (const key of TIME_RANGE_KEYS) {
      expect(getRangeTicks(key)).toBe(TIME_RANGES[key].ticks)
    }
  })
})

describe('TimeRange type', () => {
  it('should accept valid literal keys', () => {
    const valid: TimeRange[] = ['1m', '5m', '10m', '60m', '3h', '24h']
    expect(valid.length).toBe(6)
  })
})
