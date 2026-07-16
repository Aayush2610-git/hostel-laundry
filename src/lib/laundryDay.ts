// A "laundry day" runs 07:00 IST -> 03:00 IST the next morning (CLAUDE.md
// rule 2). IST has no DST, so its UTC offset is always a fixed +5:30 — we do
// all the day/hour math by hand instead of trusting the browser's local
// timezone (which could be anything, e.g. Vercel's servers run in UTC).

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// The fixed slot grid (CLAUDE.md rule 3), in IST hours. 23 and 1 are the
// "late night" slots. 1 AM falls on the *next* calendar date even though
// it's still the tail end of the same laundry day.
export const SLOT_HOURS = [7, 9, 11, 13, 15, 17, 19, 21, 23, 1] as const

export function isLateNight(hour: number): boolean {
  return hour === 23 || hour === 1
}

// A laundry day is identified by how many days its IST midnight sits after
// the Unix epoch — a plain integer, easier to add/compare than a Date.
export function istDayIndex(utcMs: number): number {
  return Math.floor((utcMs + IST_OFFSET_MS) / DAY_MS)
}

// Midnight IST of the given day index, as a UTC timestamp in ms.
function istMidnightUtcMs(dayIndex: number): number {
  return dayIndex * DAY_MS - IST_OFFSET_MS
}

// Which laundry day is "today" right now. Between 03:00 and 07:00 IST
// there's a dead zone with no active day — "today" then means the day
// about to start at 07:00, not the one that just ended.
export function currentAnchorDayIndex(nowUtcMs: number = Date.now()): number {
  const today = istDayIndex(nowUtcMs)
  const istHour = ((nowUtcMs + IST_OFFSET_MS) % DAY_MS) / HOUR_MS
  return istHour < 3 ? today - 1 : today
}

// UTC ms for a given slot's start, on the laundry day identified by dayIndex.
export function slotStartUtcMs(dayIndex: number, hour: number): number {
  const calendarDay = hour === 1 ? dayIndex + 1 : dayIndex
  return istMidnightUtcMs(calendarDay) + hour * HOUR_MS
}

function formatHour12(hour: number): { h: number; ampm: 'AM' | 'PM' } {
  const ampm = hour < 12 ? 'AM' : 'PM'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return { h, ampm }
}

// e.g. "7:00 – 9:00 AM" or "11:00 PM – 1:00 AM" for slots crossing noon/midnight.
export function formatSlotRange(startHour: number): string {
  const endHour = (startHour + 2) % 24
  const start = formatHour12(startHour)
  const end = formatHour12(endHour)
  return start.ampm === end.ampm
    ? `${start.h}:00 – ${end.h}:00 ${end.ampm}`
    : `${start.h}:00 ${start.ampm} – ${end.h}:00 ${end.ampm}`
}

const pillFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

// Label for a date pill: "Today" for the current anchor day, else "Fri 18 Jul".
export function formatPillLabel(dayIndex: number, anchorDayIndex: number): string {
  if (dayIndex === anchorDayIndex) return 'Today'
  const noonUtcMs = istMidnightUtcMs(dayIndex) + 12 * HOUR_MS // avoids day-edge rounding
  return pillFormatter.format(new Date(noonUtcMs))
}
