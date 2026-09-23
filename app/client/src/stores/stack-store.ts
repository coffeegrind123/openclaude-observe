import { create } from 'zustand'
import type { StackMetricsView, StackSample, StackStatus, StackTotals } from '@/types/stack'

// Matches the server's history (one hour at the default 5 s poll) so a live
// session and a reload show the same window.
export const MAX_STACK_SAMPLES = 720

interface StackStore {
  status: StackStatus
  samples: StackSample[]
  totals: StackTotals | null
  hydrated: boolean
  hydrate: (view: StackMetricsView) => void
  pushSample: (sample: StackSample, totals: StackTotals) => void
  setStatus: (status: StackStatus) => void
}

export const useStackStore = create<StackStore>((set) => ({
  status: { state: 'starting' },
  samples: [],
  totals: null,
  hydrated: false,

  // A WebSocket sample can land before the initial GET resolves; keep any
  // sample newer than the snapshot so the chart never steps backwards.
  hydrate: (view) =>
    set((s) => {
      const lastAt = view.samples[view.samples.length - 1]?.at ?? 0
      const newer = s.samples.filter((x) => x.at > lastAt)
      return {
        status: view.status,
        totals: view.totals ?? s.totals,
        samples: [...view.samples, ...newer].slice(-MAX_STACK_SAMPLES),
        hydrated: true,
      }
    }),

  pushSample: (sample, totals) =>
    set((s) => {
      if (s.samples.length > 0 && s.samples[s.samples.length - 1].at >= sample.at) {
        return {}
      }
      const samples = s.samples.length >= MAX_STACK_SAMPLES ? s.samples.slice(1) : s.samples.slice()
      samples.push(sample)
      return {
        samples,
        totals,
        status: s.status.state === 'ok' ? s.status : { ...s.status, state: 'ok' },
      }
    }),

  setStatus: (status) => set({ status }),
}))
