import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Returns true if `latest` is newer than `current`. Supports both
 *  semver (0.8.6) and date-based (DD.MM.YYYY) version formats. */
export function isNewerVersion(current: string, latest: string): boolean {
  const c = current.replace(/^v/, '')
  const l = latest.replace(/^v/, '')
  const toSortable = (v: string): number => {
    const p = v.split('.').map(Number)
    if (p.length === 3 && p[2] >= 2000) {
      return p[2] * 10000 + p[1] * 100 + p[0]
    }
    return p.reduce((a, n, i) => a + n * Math.pow(10000, p.length - i - 1), 0)
  }
  return toSortable(l) > toSortable(c)
}
