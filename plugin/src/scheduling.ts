/** Calendar recurrence evaluated against wall time, including DST transitions. */
import type { CalendarRule } from './types.ts'

export function validateCalendar(rule: CalendarRule): CalendarRule {
  try { new Intl.DateTimeFormat('en', { timeZone: rule.timeZone }).format() } catch { throw new Error('Unknown IANA time zone') }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time) || !rule.weekdays.length
    || rule.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error('Choose a wall-clock time and at least one weekday')
  return { timeZone: rule.timeZone, time: rule.time, weekdays: [...new Set(rule.weekdays)].sort() }
}

/** Skip a missing DST wall time; repeat an ambiguous wall time only once per local day. */
export function nextCalendar(rule: CalendarRule, after: number): number {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: rule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const parts = (at: number) => Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, part.value]))
  const wallStamp = (p: Record<string, string>) => Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute))
  const start = parts(after), [hour, minute] = rule.time.split(':').map(Number)
  // Candidate dates, then actual zone offsets around each date, avoid scanning every minute.
  // Sixteen days also cover a weekly occurrence skipped by the spring DST transition.
  for (let day = 0; day <= 16; day++) {
    const wall = Date.UTC(Number(start.year), Number(start.month) - 1, Number(start.day) + day, hour, minute)
    const weekday = new Date(wall).getUTCDay() || 7
    if (!rule.weekdays.includes(weekday)) continue
    const offsets = new Set([-36, -12, 0, 12, 36].map(hours => {
      const sample = wall + hours * 3600000
      return wallStamp(parts(sample)) - sample
    }))
    const matches = [...offsets].map(offset => wall - offset).filter(at => wallStamp(parts(at)) === wall).sort((a, b) => a - b)
    // Select only the first instant in a repeated wall-clock minute, even if it has already passed.
    if (matches[0] !== undefined && matches[0] > after) return matches[0]
  }
  throw new Error('Could not find the next calendar occurrence')
}
