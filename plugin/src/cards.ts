import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CardContent, ChatCard } from './card-types.ts'
import { optionalService } from './compatibility.ts'

const title = z.string().trim().min(1).max(200), detail = z.string().max(2000).optional()
export const cardContentSchema: z.ZodType<CardContent> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('metric'), title, value: z.string().max(200), detail }).strict(),
  z.object({ kind: z.literal('table'), title, columns: z.array(title).min(1).max(12), rows: z.array(z.array(z.string().max(500)).max(12)).max(100) }).strict()
    .refine(card => card.rows.every(row => row.length === card.columns.length), 'Every row must match the columns'),
  z.object({ kind: z.literal('progress'), title, value: z.number().finite().nonnegative(), total: z.number().finite().positive(), detail }).strict()
    .refine(card => card.value <= card.total, 'Progress cannot exceed its total'),
  z.object({ kind: z.literal('form'), title, description: detail, submitLabel: title,
    fields: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), label: title,
      type: z.enum(['text', 'textarea', 'select']), required: z.boolean(), options: z.array(title).min(1).max(30).optional() }).strict()
      .refine(field => field.type === 'select' ? !!field.options && new Set(field.options).size === field.options.length : field.options === undefined, 'Only select fields have unique options')).min(1).max(12),
  }).strict().refine(card => new Set(card.fields.map(field => field.name)).size === card.fields.length, 'Field names must be unique'),
])
export const cardSchema: z.ZodType<ChatCard> = z.object({ id: z.string(), revision: z.number().int().positive(), content: cardContentSchema,
  submitted: z.object({ messageId: z.string(), values: z.record(z.string(), z.string()), time: z.number() }).optional() })

export function parseCard(raw: string): CardContent {
  if (raw.length > 64000) throw new Error('Card data exceeds 64000 characters')
  return cardContentSchema.parse(JSON.parse(raw))
}
export function formValues(card: ChatCard, input: unknown): Record<string, string> {
  if (card.content.kind !== 'form') throw new Error('This card has no form')
  const fields = card.content.fields
  const values = z.record(z.string(), z.string().max(2000)).parse(input)
  if (Object.keys(values).some(name => !fields.some(field => field.name === name))) throw new Error('Unknown form field')
  return Object.fromEntries(fields.map(field => {
    const value = values[field.name] ?? ''
    if (field.required && !value.trim()) throw new Error(`Required field: ${field.label}`)
    if (value && field.type === 'select' && !field.options!.includes(value)) throw new Error(`Invalid choice: ${field.label}`)
    return [field.name, value]
  }))
}
export function installCardTool(agent: Agent, show: (id: string, content: CardContent) => Promise<unknown>): () => void {
  const registry = optionalService<Agent['ctx']['tools']>(agent.ctx, 'tools')
  if (!registry) return () => {}
  return registry.register(defineTool({ name: 'show_card',
    description: 'Show a data-only card beside this response. card is JSON: metric {kind,title,value,detail?}; table {kind,title,columns:string[],rows:string[][]}; progress {kind,title,value:number,total:number,detail?}; form {kind,title,description?,submitLabel,fields:[{name,label,type:"text"|"textarea"|"select",required:boolean,options?:string[]}]}. Max 8 cards, 100 rows, 12 columns or fields; no HTML, code, URLs or action handlers. Reuse id to update a card during this response. Form submission creates a new local human message to you; it does not approve tools or send platform messages. Also explain important results in your text reply for IM readers.',
    parameters: { id: { type: 'string', required: true }, card: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (exec.agent !== agent || exec.signal.aborted) throw new Error('This card belongs to the current Bot delivery')
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(args.id)) throw new Error('Use a short lowercase card id')
      return { result: JSON.stringify(await show(args.id, parseCard(args.card))) }
    },
  }))
}
