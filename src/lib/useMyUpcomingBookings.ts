import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type MyBooking = { slot_start: string; started_at: string | null }

// Shared by the "Your slots" card (what to list) and the booking grid (how
// many you have, against the 2-booking cap).
//
// supabase.channel(topic) hands back the SAME channel object if one with
// that topic string is still registered — and deregistration only happens
// after a real round trip to close the socket, which can't finish before
// React's StrictMode double-invokes this effect (mount -> cleanup -> mount)
// synchronously in dev. So .on() on the second mount lands on an
// already-subscribed channel and throws. Fix: mint a fresh random suffix
// on every effect *run* (not once per component) so no two subscribe
// attempts, from either component or from StrictMode's double-mount, can
// ever collide on the same topic.
export function useMyUpcomingBookings(session: Session) {
  const [bookings, setBookings] = useState<MyBooking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const userId = session.user.id
    const runId = crypto.randomUUID()

    function load() {
      return supabase
        .from('bookings')
        .select('slot_start, started_at')
        .eq('user_id', userId)
        .gt('slot_start', new Date().toISOString())
        .order('slot_start', { ascending: true })
        .then(({ data, error }) => {
          if (cancelled) return
          if (!error) setBookings(data ?? [])
          setLoading(false)
        })
    }

    load()

    // A single user_id=eq filter is the one condition postgres_changes
    // supports, which is all we need here (unlike BookingGrid's day-range
    // query, which has to listen unfiltered and check the range itself).
    const channel = supabase
      .channel(`my-bookings-${userId}-${runId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${userId}` },
        load,
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [session.user.id])

  return { bookings, loading }
}
