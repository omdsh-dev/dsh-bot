import { expect, it } from 'vitest'
import { botDomain } from '../src/domain.ts'
import { actOnMemory, saveMemory } from '../src/memory.ts'
import { applySemanticSuggestions, currentSuggestion, resolveSuggestion, scanMemories } from '../src/memory-governance.ts'

function fixture() {
  const state = botDomain.global.schema.parse({ bots: [{ id: 'sage', name: 'Sage', instructions: '', preset: 'standard' }], rooms: [] })
  const save = (body: string, topic = 'language') => saveMemory(state, { scope: 'bot', ownerId: 'sage', kind: 'preference', subject: 'reply', topic, body, evidence: 'operator evidence' })
  return { state, save }
}
it('creates stable review suggestions without applying them, and records explicit dismissal', () => {
  const { state, save } = fixture()
  save('Use Chinese.'); save('Use Chinese!'); save('Use English')
  scanMemories(state)
  expect(state.memories!.every(memory => memory.status === 'active')).toBe(true)
  expect(state.memorySuggestions!.map(suggestion => suggestion.relation).sort()).toEqual(['conflict', 'conflict', 'duplicate'])
  const suggestion = state.memorySuggestions![0]!
  resolveSuggestion(state, { id: suggestion.id, action: 'dismiss' }); scanMemories(state)
  expect(state.memorySuggestions).toHaveLength(3)
  expect(suggestion.status).toBe('dismissed')
})
it('accepts paraphrase suggestions only for current records with identical access boundaries', () => {
  const { state, save } = fixture(), a = save('用中文回答', '语言'), b = save('Reply in Chinese', 'response-language')
  const global = saveMemory(state, { scope: 'global', ownerId: '*', kind: 'preference', subject: 'reply', topic: 'language', body: a.body, evidence: '' })
  const text = JSON.stringify({ suggestions: [
    { left: a.id, right: b.id, relation: 'duplicate', reason: 'Equivalent language preferences', proposedBody: '请使用中文回答。' },
    { left: a.id, right: global.id, relation: 'duplicate', reason: 'Similar wording', proposedBody: a.body },
    { left: a.id, right: 'invented', relation: 'conflict', reason: 'Untrusted ID', proposedBody: '' },
  ] })
  expect(applySemanticSuggestions(state, [a, b, global], text)).toBe(1)
  expect(state.memorySuggestions).toHaveLength(1)
  expect(state.memorySuggestions![0]!.source).toBe('semantic')
  expect(state.memories).toHaveLength(3)
  const copied = structuredClone([a, b, global])
  actOnMemory(state, { id: b.id, revision: b.revision, action: 'forget' })
  expect(applySemanticSuggestions(state, copied, text)).toBe(0)
  expect(state.memorySuggestions![0]).toMatchObject({ status: 'stale', proposedBody: '', reason: '' })
})
it('merges only after review, preserves both provenance chains and erases them when forgotten', () => {
  const { state, save } = fixture(), a = save('中文回答'), b = save('中文回答')
  scanMemories(state)
  const suggestion = state.memorySuggestions![0]!
  resolveSuggestion(state, { id: suggestion.id, action: 'merge', body: '请用中文回答' })
  const merged = state.memories!.find(memory => memory.status === 'active')!
  expect(merged.mergedFrom).toEqual(expect.arrayContaining([a.id, b.id]))
  expect(a.status).toBe('superseded'); expect(b.status).toBe('superseded')
  expect(merged.source.evidence).toBe('operator evidence')
  const persisted = botDomain.global.schema.parse(state)
  actOnMemory(persisted, { id: merged.id, revision: merged.revision, action: 'forget' })
  expect(persisted.memories!.every(memory => memory.status === 'forgotten' && !memory.body && !memory.source.evidence)).toBe(true)
  expect(persisted.memorySuggestions![0]).toMatchObject({ status: 'stale', reason: '', proposedBody: '' })
})
it('rejects stale decisions, changed visibility and unresolved conflict merges', () => {
  const { state, save } = fixture(), a = save('Use Chinese'), b = save('Use English')
  scanMemories(state)
  const suggestion = state.memorySuggestions![0]!
  expect(() => resolveSuggestion(state, { id: suggestion.id, action: 'merge' })).toThrow('Resolve the conflicting')
  b.access = 'source-room'; b.source.roomId = 'another-room'
  expect(() => resolveSuggestion(state, { id: suggestion.id, action: 'keep-left' })).toThrow('ownership')
  b.revision++
  expect(currentSuggestion(state, suggestion)).toBe(false)
  expect(() => resolveSuggestion(state, { id: suggestion.id, action: 'merge', body: a.body })).toThrow('Memory changed')
})
