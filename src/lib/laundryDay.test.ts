import { describe, expect, it } from 'vitest'
import { currentAnchorDayIndex, formatPillLabel, slotStartUtcMs } from './laundryDay'

// YYYY-MM-DD in IST, for asserting which calendar date a UTC instant falls on.
const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
function istDateString(utcMs: number): string {
  return istDate.format(new Date(utcMs))
}

// A day's "anchor" laundry date, expressed as its 07:00 IST slot's calendar date.
function anchorDateIST(nowUtcMs: number): string {
  return istDateString(slotStartUtcMs(currentAnchorDayIndex(nowUtcMs), 7))
}

describe('Friday pill wiring', () => {
  // Thu 16 Jul 2026, 12:00 IST — solidly inside the active laundry day, nowhere near a boundary.
  const now = new Date('2026-07-16T12:00:00+05:30').getTime()
  const anchor = currentAnchorDayIndex(now)
  const fridayIndex = anchor + 1

  it('resolves the Friday pill to Fri 07:00 IST', () => {
    expect(formatPillLabel(fridayIndex, anchor)).toBe('Fri, 17 Jul')
    // 07:00 IST = 01:30 UTC
    expect(new Date(slotStartUtcMs(fridayIndex, 7)).toISOString()).toBe('2026-07-17T01:30:00.000Z')
  })

  it("rolls the Friday pill's 1 AM slot onto Saturday's calendar date", () => {
    const oneAmSlot = slotStartUtcMs(fridayIndex, 1)
    // 1 AM IST Saturday = 19:30 UTC Friday
    expect(new Date(oneAmSlot).toISOString()).toBe('2026-07-17T19:30:00.000Z')
    expect(istDateString(oneAmSlot)).toBe('2026-07-18')
  })
})

describe('currentAnchorDayIndex across the 03:00-07:00 IST dead zone', () => {
  it('still anchors to the previous laundry day just before 03:00 IST', () => {
    const now = new Date('2026-07-17T02:59:00+05:30').getTime()
    expect(anchorDateIST(now)).toBe('2026-07-16')
  })

  it('flips to the upcoming laundry day exactly at 03:00 IST', () => {
    const now = new Date('2026-07-17T03:00:00+05:30').getTime()
    expect(anchorDateIST(now)).toBe('2026-07-17')
  })

  it('stays anchored to the upcoming day for the rest of the dead zone', () => {
    const now = new Date('2026-07-17T06:59:00+05:30').getTime()
    expect(anchorDateIST(now)).toBe('2026-07-17')
  })

  it('keeps the same anchor once the laundry day actually starts at 07:00 IST', () => {
    const now = new Date('2026-07-17T07:00:00+05:30').getTime()
    expect(anchorDateIST(now)).toBe('2026-07-17')
  })

  it('keeps anchoring to the same day late at night, before the next dead zone', () => {
    const now = new Date('2026-07-17T20:00:00+05:30').getTime()
    expect(anchorDateIST(now)).toBe('2026-07-17')
  })

  it('keeps anchoring to the same day in the 00:00-03:00 tail the next morning', () => {
    const now = new Date('2026-07-18T02:00:00+05:30').getTime()
    expect(anchorDateIST(now)).toBe('2026-07-17')
  })
})
