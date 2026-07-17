import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { SLOT_TIMES, slotStartUtcMs } from './laundryDay'

export type AdminBooking = {
  slot_start: string
  user_id: string
  profiles: { full_name: string; room_no: string } | null
}

export type AdminOffer = {
  slot_start: string
  user_id: string
  expires_at: string
  profiles: { full_name: string; room_no: string } | null
}

export type AdminWatcher = {
  slot_start: string
  user_id: string
  full_name: string
  room_no: string
  created_at: string
}

// Read-only master view for one day's 8 slots: who's booked, who's
// holding an offer, who's waiting — all three, for every slot, in one
// fetch. Unlike BookingGrid this has no "is this mine" branching, since
// nothing here is interactive yet.
export function useAdminDaySlots(dayIndex: number) {
  const [bookings, setBookings] = useState<AdminBooking[]>([])
  const [offers, setOffers] = useState<AdminOffer[]>([])
  const [watchers, setWatchers] = useState<AdminWatcher[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const isoStarts = SLOT_TIMES.map(({ hour, minute }) =>
      new Date(slotStartUtcMs(dayIndex, hour, minute)).toISOString(),
    )

    async function load() {
      const [bookingsRes, offersRes, watchersRes] = await Promise.all([
        supabase
          .from('bookings')
          .select('slot_start, user_id, profiles(full_name, room_no)')
          .in('slot_start', isoStarts),
        supabase
          .from('slot_offers')
          .select('slot_start, user_id, expires_at, profiles(full_name, room_no)')
          .in('slot_start', isoStarts)
          .is('outcome', null)
          .gt('expires_at', new Date().toISOString()),
        supabase.rpc('admin_slot_watchers', { target_slot_starts: isoStarts }),
      ])

      if (cancelled) return
      if (!bookingsRes.error) setBookings((bookingsRes.data ?? []) as unknown as AdminBooking[])
      if (!offersRes.error) setOffers((offersRes.data ?? []) as unknown as AdminOffer[])
      if (!watchersRes.error) setWatchers((watchersRes.data ?? []) as AdminWatcher[])
      setLoading(false)
    }

    load()

    // Whole-table listen, same reasoning as BookingGrid: a booking or
    // offer change anywhere on this day should refresh this view.
    const channel = supabase
      .channel(`admin-day-${dayIndex}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slot_offers' }, load)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [dayIndex])

  return { bookings, offers, watchers, loading }
}
