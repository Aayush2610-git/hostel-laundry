import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { useMyUpcomingBookings } from './useMyUpcomingBookings'
import {
  SLOT_TIMES,
  currentAnchorDayIndex,
  istHourOf,
  laundryDayIndexOfSlotStart,
  slotStartUtcMs,
} from './laundryDay'

export type NextFreeSlot = { startMs: number; hour: number; minute: number; dayIndex: number }

// Powers the sticky bottom bar: the earliest free slot across the same
// 4-day window the day pills expose, skipping any day the user already has
// a booking on (the trigger would reject a second one there anyway).
export function useNextFreeSlot(session: Session): NextFreeSlot | null {
  const anchorDayIndex = useMemo(() => currentAnchorDayIndex(), [])
  const { bookings: myUpcomingBookings } = useMyUpcomingBookings(session)

  const myBookedDayIndices = useMemo(() => {
    const set = new Set<number>()
    for (const booking of myUpcomingBookings) {
      const ms = new Date(booking.slot_start).getTime()
      set.add(laundryDayIndexOfSlotStart(ms, istHourOf(ms)))
    }
    return set
  }, [myUpcomingBookings])

  const candidates = useMemo(() => {
    const list: NextFreeSlot[] = []
    for (let offset = 0; offset < 4; offset++) {
      const dayIndex = anchorDayIndex + offset
      if (myBookedDayIndices.has(dayIndex)) continue
      for (const { hour, minute } of SLOT_TIMES) {
        const startMs = slotStartUtcMs(dayIndex, hour, minute)
        if (startMs > Date.now()) list.push({ startMs, hour, minute, dayIndex })
      }
    }
    list.sort((a, b) => a.startMs - b.startMs)
    return list
  }, [anchorDayIndex, myBookedDayIndices])

  const [takenStartMs, setTakenStartMs] = useState<Set<number>>(new Set())

  useEffect(() => {
    let cancelled = false
    if (candidates.length === 0) {
      setTakenStartMs(new Set())
      return
    }

    const isoStarts = candidates.map((c) => new Date(c.startMs).toISOString())

    function load() {
      return supabase
        .from('bookings')
        .select('slot_start')
        .in('slot_start', isoStarts)
        .then(({ data, error }) => {
          if (cancelled) return
          if (!error) setTakenStartMs(new Set(data.map((b) => new Date(b.slot_start).getTime())))
        })
    }

    load()

    // Same unfiltered-channel-with-a-fresh-topic pattern as BookingGrid —
    // any booking or release anywhere can change which slot is "next".
    const channel = supabase
      .channel(`next-free-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [candidates])

  return candidates.find((c) => !takenStartMs.has(c.startMs)) ?? null
}
