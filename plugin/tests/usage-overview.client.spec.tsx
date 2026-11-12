// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UsageOverview } from '../src/client/UsageOverview.tsx'
import type { UsageReport } from '../src/usage.ts'
import type { UsageBucket } from '../src/usage-types.ts'
afterEach(cleanup)
const bucket = (key: string, input = 0, output = 0): UsageBucket => ({ key, input, output, records: 3, cacheRead: 50, cacheWrite: 0, unreported: 0, estimatedTokens: 0, legacyRecords: 0, unpricedRecords: 0, costs: [] })
function report(): UsageReport {
  return { generatedAt: Date.parse('2026-11-06T10:00:00Z'), budgets: [], bots: [{ botId: 'a', name: 'Designer', archived: false, deleted: false, pricesConfigured: true,
    conversation: { input: 100, output: 20, records: 3 }, memory: { input: 0, output: 0, records: 0 }, handoff: { input: 0, output: 0, records: 0 }, unreported: 0 }],
    ledger: { totals: { ...bucket('*', 100, 20), costs: [{ currency: 'USD', cost: 1 }, { currency: 'CNY', cost: 7 }], legacyRecords: 1 },
      days: [bucket('2026-11-04', 100, 20)], models: [], rooms: [], purposes: [bucket('conversation', 100, 20)], recent: [], matchedRecords: 3, activeCalls: 0 } }
}
it('keeps currencies separate and labels cache share and legacy counts accurately', () => {
  render(<UsageOverview report={report()} filter={{}} change={vi.fn()} botId="*" selectBot={vi.fn()} english/>)
  expect(screen.getByText('USD 1.00 · CNY 7.00')).toBeTruthy()
  expect(screen.getByText('50.0%')).toBeTruthy()
  expect(screen.getByText('Includes 1 legacy records')).toBeTruthy()
  expect(screen.getByRole('img', { name: '2026-11-04: 120 tokens' })).toBeTruthy()
})
it('selects complete UTC dates while preserving other ledger filters', () => {
  const change = vi.fn(), selectBot = vi.fn()
  render(<UsageOverview report={report()} filter={{ model: 'kimi', purpose: 'memory' }} change={change} botId="*" selectBot={selectBot} english/>)
  fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
  expect(change).toHaveBeenLastCalledWith({ model: 'kimi', purpose: 'memory', from: Date.parse('2026-10-31T00:00:00Z'), to: Date.parse('2026-11-07T00:00:00Z') })
  fireEvent.change(screen.getByRole('combobox', { name: 'Overview Bot' }), { target: { value: 'a' } })
  expect(selectBot).toHaveBeenCalledWith('a')
})
it('does not invent values for unavailable or empty ledgers', () => {
  const data = report(); delete data.ledger
  const view = render(<UsageOverview report={data} filter={{}} change={vi.fn()} botId="*" selectBot={vi.fn()} english/>)
  expect(screen.queryByText('Total tokens')).toBeNull()
  data.ledger = { ...report().ledger!, totals: bucket('*'), days: [], purposes: [] }; data.bots = []
  view.rerender(<UsageOverview report={data} filter={{}} change={vi.fn()} botId="*" selectBot={vi.fn()} english/>)
  expect(screen.getByText('No dated usage records')).toBeTruthy()
  expect(screen.getByText('No Bot records in this range')).toBeTruthy()
  expect(screen.queryByText('NaN%')).toBeNull()
})
it('shows model consumption and clears hidden ledger filters together', () => {
  const data = report(), change = vi.fn(), selectBot = vi.fn()
  data.ledger!.models = [bucket('["provider","vision-model"]', 100, 20)]
  render(<UsageOverview report={data} filter={{ model: 'vision-model' }} change={change} botId="a" selectBot={selectBot} english/>)
  expect(screen.getByRole('heading', { name: 'Model usage ranking' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Bot usage ranking' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
  expect(change).toHaveBeenCalledWith({})
  expect(selectBot).toHaveBeenCalledWith('*')
})
