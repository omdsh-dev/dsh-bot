/** Bounded history queries and validated execution policy shared by Host commands. */
import type { BotPolicy, ChatMessage, HistoryPage, HistoryRequest, Room } from './types.ts'

export function validatePolicy(policy: BotPolicy): BotPolicy {
  const provider = policy.provider?.trim(), model = policy.model?.trim()
  if (!!provider !== !!model || (provider?.length ?? 0) > 200 || (model?.length ?? 0) > 200) throw new Error('Specify both provider and model, or leave both empty')
  const tools = [...new Set((policy.tools ?? []).map(name => name.trim()).filter(Boolean))]
  if (tools.length > 200 || tools.some(name => name.length > 200)) throw new Error('Invalid tool allowlist')
  for (const price of [policy.inputPrice, policy.outputPrice]) if (price !== undefined && (!Number.isFinite(price) || price < 0)) throw new Error('Prices must be finite nonnegative numbers')
  return { ...policy, provider: provider || undefined, model: model || undefined, tools }
}

export function historyPage(room: Room, request: HistoryRequest): HistoryPage {
  const limit = Math.max(1, Math.min(200, Math.floor(request.limit ?? 50)))
  if (!Number.isFinite(limit)) throw new Error('Invalid history page size')
  const end = request.before ? room.messages.findIndex(message => message.id === request.before) : room.messages.length
  if (end < 0) throw new Error('History cursor no longer exists')
  const query = request.query?.trim().toLocaleLowerCase()
  const matches = (message: ChatMessage) => !query || message.text.toLocaleLowerCase().includes(query)
  const available = room.messages.slice(0, end).filter(matches)
  const messages = available.slice(-limit)
  return structuredClone({ messages, before: available.length > limit ? messages[0]!.id : null, total: room.messages.filter(matches).length })
}

export function exportRoom(room: Room, format: 'json' | 'markdown'): string {
  if (format === 'json') return JSON.stringify(room, null, 2)
  return `# ${room.title}\n\n` + room.messages.map(message =>
    `## ${message.botId ? '@' + message.botId : message.external?.sender.name ?? 'User'} · ${new Date(message.time).toISOString()} · ${message.status}\n\n${message.text}\n`
    + (message.attachments ?? []).map(item => `\nAttachment: ${JSON.stringify(item.attachment.name)} (${item.type}, ${item.attachment.bytes} bytes, ${item.attachment.attachmentId})\n`).join('')
    + (message.cards ?? []).map(card => `\nCard:\n\n\`\`\`json\n${JSON.stringify(card, null, 2)}\n\`\`\`\n`).join('')
    + (message.error ? `\nError: ${message.error}\n` : ''),
  ).join('\n')
}
