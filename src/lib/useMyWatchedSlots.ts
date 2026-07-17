import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type WatchedSlot = { slot_start: string; position: number }

// Position comes from the my_watched_slots() RPC (schema.sql section 13)
// rather than a client-side count: slot_watchers' RLS only exposes a
// user's own rows, so the count-of-earlier-watchers needed for "position"
// can't be computed from the client's own read access.
export function useMyWatchedSlots(session: Session) {
  const [watched, setWatched] = useState<WatchedSlot[]>([])

  useEffect(() => {
    let cancelled = false
    const runId = crypto.randomUUID()

    function load() {
      return supabase
        .rpc('my_watched_slots')
        .then(({ data, error }) => {
          if (cancelled) return
          if (!error) setWatched(data ?? [])
        })
    }

    load()

    // Whole-table, unfiltered: someone else claiming or declining ahead of
    // me in a queue can shift my position, and — unlike
    // useMyUpcomingBookings' user_id=eq filter — there's no column filter
    // that captures "changes that affect my position," since those changes
    // land on other people's rows.
    const channel = supabase
      .channel(`my-watched-${session.user.id}-${runId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slot_offers' }, load)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [session.user.id])

  // Exposed separately for the one case realtime above can't cover: my own
  // watch/unwatch tap, which writes slot_watchers, not slot_offers.
  async function refetch() {
    const { data, error } = await supabase.rpc('my_watched_slots')
    if (!error) setWatched(data ?? [])
  }

  return { watched, refetch }
}
