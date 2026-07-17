import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type MyOffer = { slot_start: string; expires_at: string }

// Drives the top-of-home offer card. A filtered (user_id=eq) subscription
// is enough here, unlike useMyWatchedSlots — an active offer of mine is
// always a row with my own user_id, no cross-user visibility problem to
// work around.
export function useMyActiveOffer(session: Session): MyOffer | null {
  const [offer, setOffer] = useState<MyOffer | null>(null)

  useEffect(() => {
    let cancelled = false
    const userId = session.user.id
    const runId = crypto.randomUUID()

    function load() {
      return supabase
        .from('slot_offers')
        .select('slot_start, expires_at')
        .eq('user_id', userId)
        .is('outcome', null)
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true })
        .limit(1)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled) return
          if (!error) setOffer(data ?? null)
        })
    }

    load()

    const channel = supabase
      .channel(`my-offer-${userId}-${runId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slot_offers', filter: `user_id=eq.${userId}` },
        load,
      )
      .subscribe()

    // Backstop for the one transition realtime can't announce: the offer's
    // own expiry is a pure time passage, not a DB write. The card itself
    // also hides on expiry client-side (its own 1s tick), so this is just
    // what keeps the underlying data in sync — same reasoning as
    // useCurrentBooking's poll.
    const poll = setInterval(load, 30_000)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [session.user.id])

  return offer
}
