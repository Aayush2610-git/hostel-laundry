import { describe, expect, it } from 'vitest'
import {
  SLOT_TIMES,
  currentAnchorDayIndex,
  formatPillLabel,
  formatSlotRange,
  formatSlotStart,
  istHourOf,
  istMinuteOf,
  laundryDayIndexOfSlotStart,
  slotStartUtcMs,
} from './laundryDay'

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

  it("rolls the Friday pill's 00:30 slot onto Saturday's calendar date", () => {
    const lateSlot = slotStartUtcMs(fridayIndex, 0, 30)
    // 00:30 IST Saturday = 19:00 UTC Friday
    expect(new Date(lateSlot).toISOString()).toBe('2026-07-17T19:00:00.000Z')
    expect(istDateString(lateSlot)).toBe('2026-07-18')
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

describe('formatSlotStart', () => {
  it('formats a plain start hour', () => {
    expect(formatSlotStart(7, 0)).toBe('7:00 AM')
    expect(formatSlotStart(19, 30)).toBe('7:30 PM')
  })

  it('formats noon and midnight-adjacent hours', () => {
    expect(formatSlotStart(12, 0)).toBe('12:00 PM')
    expect(formatSlotStart(0, 30)).toBe('12:30 AM')
  })
})

describe('formatSlotRange renders the 30-minute booking window for every slot', () => {
  const expected: Record<string, string> = {
    '7-0': '7:00 – 7:30 AM',
    '9-30': '9:30 – 10:00 AM',
    '12-0': '12:00 – 12:30 PM',
    '14-30': '2:30 – 3:00 PM',
    '17-0': '5:00 – 5:30 PM',
    '19-30': '7:30 – 8:00 PM',
    '22-0': '10:00 – 10:30 PM',
    '0-30': '12:30 – 1:00 AM',
  }

  for (const slot of SLOT_TIMES) {
    it(`renders ${slot.hour}:${slot.minute}`, () => {
      expect(formatSlotRange(slot.hour, slot.minute)).toBe(expected[`${slot.hour}-${slot.minute}`])
    })
  }
})

describe('istHourOf, istMinuteOf, and laundryDayIndexOfSlotStart round-trip slotStartUtcMs', () => {
  const now = new Date('2026-07-16T12:00:00+05:30').getTime()
  const anchor = currentAnchorDayIndex(now)

  for (const { hour, minute } of SLOT_TIMES) {
    it(`recovers ${hour}:${minute} and its laundry day index`, () => {
      const startMs = slotStartUtcMs(anchor, hour, minute)
      expect(istHourOf(startMs)).toBe(hour)
      expect(istMinuteOf(startMs)).toBe(minute)
      expect(laundryDayIndexOfSlotStart(startMs, hour)).toBe(anchor)
    })
  }
})

describe('the 8 slots are back-to-back with no gaps across the 20h laundry day', () => {
  it('each slot starts exactly 2.5h after the previous one', () => {
    const anchor = currentAnchorDayIndex(new Date('2026-07-16T12:00:00+05:30').getTime())
    const starts = SLOT_TIMES.map(({ hour, minute }) => slotStartUtcMs(anchor, hour, minute))
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBe(2.5 * 60 * 60 * 1000)
    }
  })

  it('the last slot ends exactly at 03:00 IST, the laundry day boundary', () => {
    const anchor = currentAnchorDayIndex(new Date('2026-07-16T12:00:00+05:30').getTime())
    const lastStart = slotStartUtcMs(anchor, 0, 30)
    const lastEnd = lastStart + 2.5 * 60 * 60 * 1000
    const nextDayStart = slotStartUtcMs(anchor + 1, 7)
    // 03:00 IST is exactly 4h before the next laundry day's 07:00 IST start.
    expect(nextDayStart - lastEnd).toBe(4 * 60 * 60 * 1000)
  })
})
