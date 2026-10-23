import { expect, it } from 'vitest'
import { formValues, parseCard } from '../src/cards.ts'
import type { ChatCard } from '../src/card-types.ts'

it('accepts bounded data views and rejects executable fields, inconsistent tables and invalid progress', () => {
  const metric = { kind: 'metric', title: 'Calls', value: '42' }
  expect(parseCard(JSON.stringify(metric))).toEqual(metric)
  expect(() => parseCard(JSON.stringify({ ...metric, html: '<script>run()</script>' }))).toThrow()
  expect(() => parseCard(JSON.stringify({ kind: 'table', title: 'Data', columns: ['Name'], rows: [['a', 'b']] }))).toThrow('columns')
  expect(() => parseCard(JSON.stringify({ kind: 'progress', title: 'Work', value: 11, total: 10 }))).toThrow('total')
  expect(() => parseCard(' '.repeat(64001))).toThrow('64000')
})
it('validates form choices and required values without executing or dropping supplied fields', () => {
  const card: ChatCard = { id: 'choice', revision: 1, content: { kind: 'form', title: 'Next step', submitLabel: 'Send', fields: [
    { name: 'choice', label: 'Choice', type: 'select', required: true, options: ['A', 'B'] }, { name: 'detail', label: 'Detail', type: 'text', required: false },
  ] } }
  expect(formValues(card, { choice: 'A' })).toEqual({ choice: 'A', detail: '' })
  expect(() => formValues(card, {})).toThrow('Required')
  expect(() => formValues(card, { choice: 'C' })).toThrow('Invalid choice')
  expect(() => formValues(card, { choice: 'A', extra: 'ignore validation' })).toThrow('Unknown')
  expect(() => formValues(card, { choice: 'A', detail: 'x'.repeat(2001) })).toThrow()
  if (card.content.kind !== 'form') throw new Error('Invalid test form')
  const content = card.content
  expect(() => parseCard(JSON.stringify({ ...content, fields: [content.fields[0], content.fields[0]] }))).toThrow('unique')
})
