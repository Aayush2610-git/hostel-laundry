import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { SLOT_DURATION_MS } from './laundryDay'

type CurrentBookingRow = {
  slot_start: string
  user_id: string
  profiles: { full_name: string; room_no: string } | null
}

// Drives the status hero: is the machine running *right now*, for anyone
// (not just the current user)? A slot's occupancy isn't announced by any DB
// event when it naturally starts or ends — nothing gets inserted/updated/
// deleted at that instant — so this can't be realtime-only. It combines a
// small fetch (the most recent booking that's already started, within the
// last 2.5h) with a 1s client clock that re-checks whether "now" is still
// inside that booking's window, so it flips back to idle on its own the
// moment the wash ends.
export function useCurrentBooking() {
  const [booking, setBooking] = useState<CurrentBookingRow | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    let cancelled = false

    function load() {
      const nowIso = new Date().toISOString()
      const windowStartIso = new Date(Date.now() - SLOT_DURATION_MS).toISOString()
      return supabase
        .from('bookings')
        .select('slot_start, user_id, profiles(full_name, room_no)')
        .gte('slot_start', windowStartIso)
        .lte('slot_start', nowIso)
        .order('slot_start', { ascending: false })
        .limit(1)
        .then(({ data, error }) => {
          if (cancelled) return
          if (!error) setBooking(((data?.[0] as unknown as CurrentBookingRow) ?? null))
        })
    }

    load()

    // Unfiltered + a fresh topic per mount: same reasoning as BookingGrid's
    // own channel — supabase.channel(topic) reuses an already-subscribed
    // channel for a repeated topic, and React StrictMode's synchronous
    // double-invoke in dev would collide with that before the first
    // channel finishes its async teardown.
    const channel = supabase
      .channel(`current-booking-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .subscribe()

    // Catches the "nothing changed in the DB, but time passed" transitions
    // (a wash starting or ending exactly on schedule) that realtime can't.
    const poll = setInterval(load, 30_000)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [])

  const startMs = booking ? new Date(booking.slot_start).getTime() : null
  const endMs = startMs !== null ? startMs + SLOT_DURATION_MS : null
  const isRunning = startMs !== null && endMs !== null && nowMs >= startMs && nowMs < endMs

  return {
    isRunning,
    booking: isRunning ? booking : null,
    remainingMs: isRunning && endMs !== null ? endMs - nowMs : 0,
    endMs: isRunning ? endMs : null,
  }
}
