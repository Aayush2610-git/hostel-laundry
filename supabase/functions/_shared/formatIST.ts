// Same IST math as src/lib/laundryDay.ts, ported here because edge
// functions deploy standalone and can't import from src/. IST has no DST,
// fixed +5:30 offset (CLAUDE.md rule 1).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// e.g. "7:12 PM" from any ISO timestamp string.
export function formatIST(isoTimestamp: string): string {
  const istMs = new Date(isoTimestamp).getTime() + IST_OFFSET_MS
  const totalMinutes = Math.floor(istMs / 60000) % (24 * 60)
  const hour = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60
  const ampm = hour < 12 ? 'AM' : 'PM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`
}
