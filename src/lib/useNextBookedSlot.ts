import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Powers the idle porthole readout: when nothing's running right now, show
// when the machine is next claimed instead of a dead "–:–" placeholder.
// Unlike useCurrentBooking this doesn't care whose booking it is or embed
// a profile — just the earliest one still ahead of now, for anyone.
export function useNextBookedSlot(): number | null {
  const [startMs, setStartMs] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    function load() {
      return supabase
        .from('bookings')
        .select('slot_start')
        .gt('slot_start', new Date().toISOString())
        .order('slot_start', { ascending: true })
        .limit(1)
        .then(({ data, error }) => {
          if (cancelled) return
          if (!error) setStartMs(data?.[0] ? new Date(data[0].slot_start).getTime() : null)
        })
    }

    load()

    const channel = supabase
      .channel(`next-booked-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [])

  return startMs
}
