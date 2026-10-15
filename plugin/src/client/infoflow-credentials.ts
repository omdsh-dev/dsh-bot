/** Parse the platform's labeled credential copy locally; never retain the original clipboard text. */
export function parseInfoFlowCredentials(text: string): { agentId?: string; appKey: string; appSecret: string } | null {
  if (text.length > 16000) return null
  const fields = new Map<string, string>()
  const accept = (label: string, value: unknown) => {
    const key = label.toLowerCase().replace(/[\s_-]/g, '')
    if (!['appid', 'agentid', '应用id', 'appkey', 'appsecret'].includes(key)) return
    if (typeof value !== 'string' && typeof value !== 'number') return
    fields.set(key === 'appid' || key === '应用id' ? 'agentid' : key, String(value).trim())
  }
  try {
    const object: unknown = JSON.parse(text)
    if (object && typeof object === 'object' && !Array.isArray(object)) for (const [label, value] of Object.entries(object)) accept(label, value)
  } catch { /* The platform also copies labeled plain text rather than JSON. */ }
  if (!fields.size) {
    for (const match of text.matchAll(/(?:^|[\r\n,，;；])\s*["']?(App[\s_-]*ID|Agent[\s_-]*ID|应用\s*ID|App[\s_-]*Key|App[\s_-]*Secret)["']?\s*[:：=\t]\s*["']?([^\s"',，;；]+)["']?/gi)) accept(match[1]!, match[2]!)
  }
  const appKey = fields.get('appkey'), appSecret = fields.get('appsecret'), agentId = fields.get('agentid')
  if (!appKey || !appSecret || (agentId && !/^[1-9]\d*$/.test(agentId))) return null
  return { appKey, appSecret, ...(agentId ? { agentId } : {}) }
}
