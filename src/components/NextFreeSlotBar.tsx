import { useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useNextFreeSlot } from '../lib/useNextFreeSlot'
import { currentAnchorDayIndex, formatPillLabel, formatSlotRange } from '../lib/laundryDay'

// Glass sticky bar: always-visible shortcut to the earliest free slot,
// so booking doesn't require scrolling to find one. Hidden entirely once
// there's no room left to book (every visible day already has a booking,
// or every remaining slot is taken) — CLAUDE.md rule 7: still one tap.
export function NextFreeSlotBar({ session }: { session: Session }) {
  const anchorDayIndex = useMemo(() => currentAnchorDayIndex(), [])
  const next = useNextFreeSlot(session)
  const [booking, setBooking] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }

  async function bookNext() {
    if (!next) return
    setBooking(true)
    const { error } = await supabase
      .from('bookings')
      .insert({ slot_start: new Date(next.startMs).toISOString(), user_id: session.user.id })
    setBooking(false)
    if (error) {
      showToast(error.code === '23505' ? 'Just taken by someone else.' : error.message)
    }
    // On success `next` recomputes itself: myUpcomingBookings picks up the
    // new booking via realtime, which removes this day from the candidate
    // window — no local state to reconcile here.
  }

  if (!next) return null

  return (
    <div className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-surface/80 px-5 py-4 backdrop-blur-lg">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow font-medium tracking-wide text-text-secondary uppercase">Next free slot</p>
          <p className="text-base font-semibold text-text-primary">
            {formatPillLabel(next.dayIndex, anchorDayIndex)} · {formatSlotRange(next.hour, next.minute)}
          </p>
        </div>
        <button
          type="button"
          onClick={bookNext}
          disabled={booking}
          className="shrink-0 rounded-pill bg-accent px-5 py-2.5 text-sm font-semibold text-text-primary transition-transform active:scale-[0.96] disabled:opacity-60"
        >
          {booking ? 'Booking…' : 'Book'}
        </button>
      </div>
      {toast && <p className="pop-in mt-2 text-center text-sm text-text-secondary">{toast}</p>}
    </div>
  )
}
