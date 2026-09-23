import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { niceCeiling, segments, TimeSeriesChart } from './time-series-chart'

describe('niceCeiling', () => {
  it('rounds up to a 1/2/2.5/5 step', () => {
    expect(niceCeiling(63.9)).toBe(100)
    expect(niceCeiling(41)).toBe(50)
    expect(niceCeiling(1982)).toBe(2000)
    expect(niceCeiling(2400)).toBe(2500)
    expect(niceCeiling(0)).toBe(1)
  })
})

describe('segments', () => {
  it('breaks the line at idle (null) samples', () => {
    const runs = segments([
      { at: 1, value: 5 },
      { at: 2, value: 6 },
      { at: 3, value: null },
      { at: 4, value: 7 },
    ])
    expect(runs.map((r) => r.map((p) => p.at))).toEqual([[1, 2], [4]])
  })
})

describe('TimeSeriesChart', () => {
  it('says it is waiting until there are two samples', () => {
    render(<TimeSeriesChart title="Decode" points={[{ at: 1, value: 3 }]} format={String} />)
    expect(screen.getByText('Waiting for samples')).toBeInTheDocument()
  })

  it('labels the latest value for screen readers', () => {
    render(
      <TimeSeriesChart
        title="Decode"
        points={[
          { at: 1, value: 3 },
          { at: 2, value: 64 },
        ]}
        format={(v) => `${v} t/s`}
      />,
    )
    expect(screen.getByRole('img', { name: 'Decode, latest 64 t/s' })).toBeInTheDocument()
  })
})
