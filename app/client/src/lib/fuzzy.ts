// Tiny fuzzy subsequence matcher for the command palette. Returns a score
// (higher = better) or null when `query` isn't a subsequence of `text`.
// Bonuses: consecutive matches, start-of-word, and start-of-string.

export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  let prevMatchIdx = -2
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let bonus = 1
      if (ti === prevMatchIdx + 1) bonus += 2 // consecutive
      if (ti === 0)
        bonus += 3 // start of string
      else if (/[\s\-_/.]/.test(t[ti - 1])) bonus += 2 // start of word
      score += bonus
      prevMatchIdx = ti
      qi++
    }
  }
  return qi === q.length ? score : null
}

export interface Ranked<T> {
  item: T
  score: number
}

/** Rank items by best fuzzy score over the provided text accessor(s). */
export function fuzzyRank<T>(
  query: string,
  items: T[],
  text: (item: T) => string | string[],
): Ranked<T>[] {
  const out: Ranked<T>[] = []
  for (const item of items) {
    const fields = text(item)
    const arr = Array.isArray(fields) ? fields : [fields]
    let best: number | null = null
    for (const f of arr) {
      const s = fuzzyScore(query, f)
      if (s != null && (best == null || s > best)) best = s
    }
    if (best != null) out.push({ item, score: best })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
