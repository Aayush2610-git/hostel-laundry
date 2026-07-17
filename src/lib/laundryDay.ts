// A "laundry day" runs 07:00 IST -> 03:00 IST the next morning (CLAUDE.md
// rule 2). IST has no DST, so its UTC offset is always a fixed +5:30 — we do
// all the day/hour math by hand instead of trusting the browser's local
// timezone (which could be anything, e.g. Vercel's servers run in UTC).

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * HOUR_MS

// The fixed slot grid (CLAUDE.md rule 3): eight 2.5h slots back-to-back,
// covering the full 20-hour laundry day (7 AM -> 3 AM) with no gaps or
// overlap. 22:00 and 00:30 are the "late night" slots. 00:30 falls on the
// *next* calendar date even though it's still the tail end of the same
// laundry day — same idea as the old grid's 1 AM slot.
export const SLOT_TIMES = [
  { hour: 7, minute: 0 },
  { hour: 9, minute: 30 },
  { hour: 12, minute: 0 },
  { hour: 14, minute: 30 },
  { hour: 17, minute: 0 },
  { hour: 19, minute: 30 },
  { hour: 22, minute: 0 },
  { hour: 0, minute: 30 },
] as const

export type SlotTime = (typeof SLOT_TIMES)[number]

export const SLOT_DURATION_MS = 2.5 * HOUR_MS

export function isLateNight(hour: number): boolean {
  return hour === 22 || hour === 0
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
// Any hour before 7 (currently just the 00:30 slot) is the tail of the
// laundry day and rolls onto the next calendar date.
export function slotStartUtcMs(dayIndex: number, hour: number, minute: number = 0): number {
  const calendarDay = hour < 7 ? dayIndex + 1 : dayIndex
  return istMidnightUtcMs(calendarDay) + hour * HOUR_MS + minute * MINUTE_MS
}

function formatHM(hour: number, minute: number): { h: number; m: number; ampm: 'AM' | 'PM' } {
  const ampm = hour < 12 ? 'AM' : 'PM'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return { h, m: minute, ampm }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// e.g. "9:30 PM" — just the start time. A "7:00 – 7:30 AM" range used to be
// shown here, but that reads as "the machine only runs half an hour" —
// wrong, it reserves the full 2.5h block (SLOT_DURATION_MS) server-side.
// The start time is the only thing anyone actually acts on; when it stops
// being free is formatSlotEnd's job below, kept as an explicitly separate
// "Done by" / "Free again" line rather than folded into one string, so the
// two numbers can't be mistaken for a single half-hour window.
export function formatSlotStart(hour: number, minute: number): string {
  const { h, m, ampm } = formatHM(hour, minute)
  return `${h}:${pad2(m)} ${ampm}`
}

// The IST hour-of-day (0-23) that a raw slot_start timestamp falls on.
// Needed for bookings loaded by slot_start alone (e.g. "Your slots"), which
// don't already carry the SLOT_TIMES entry the day-grid builds them from.
export function istHourOf(utcMs: number): number {
  return Math.floor(((utcMs + IST_OFFSET_MS) % DAY_MS) / HOUR_MS)
}

// The IST minute-of-hour (0-59) that a raw slot_start timestamp falls on.
export function istMinuteOf(utcMs: number): number {
  return Math.floor(((utcMs + IST_OFFSET_MS) % HOUR_MS) / MINUTE_MS)
}

// "Done by" / "Free again" — always derived from SLOT_DURATION_MS, the same
// number the actual occupancy is built from, never a separate hardcoded
// offset. Takes a raw slot_start timestamp (not hour/minute) since every
// call site already has that, not a SLOT_TIMES entry.
export function formatSlotEnd(startMs: number): string {
  const endMs = startMs + SLOT_DURATION_MS
  return formatSlotStart(istHourOf(endMs), istMinuteOf(endMs))
}

// Inverse of slotStartUtcMs: given a slot's raw timestamp and its IST hour,
// recover the laundry-day index (dayIndex) it belongs to, so it can be
// labelled the same way as the day pills ("Today" / "Fri, 18 Jul").
export function laundryDayIndexOfSlotStart(utcMs: number, hour: number): number {
  const calendarDay = istDayIndex(utcMs)
  return hour < 7 ? calendarDay - 1 : calendarDay
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
  return formatFullDate(dayIndex)
}

// Always the real date, e.g. "Fri, 18 Jul" — unlike formatPillLabel, never
// collapses to "Today". Used for the section-header date, which sits next
// to pills that already say "Today" themselves.
export function formatFullDate(dayIndex: number): string {
  const noonUtcMs = istMidnightUtcMs(dayIndex) + 12 * HOUR_MS // avoids day-edge rounding
  return pillFormatter.format(new Date(noonUtcMs))
}
