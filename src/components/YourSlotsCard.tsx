import { useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useMyUpcomingBookings } from '../lib/useMyUpcomingBookings'
import {
  currentAnchorDayIndex,
  formatPillLabel,
  formatSlotStart,
  istHourOf,
  istMinuteOf,
  laundryDayIndexOfSlotStart,
} from '../lib/laundryDay'
import { EjectIcon } from './icons'

// A row waiting on a tap: first "confirm?", then "releasing…" while the
// delete is in flight. Release is the only irreversible action in this app
// (CLAUDE.md rule 7), so it's the only one that gets a confirm step.
type PendingRelease = { startMs: number; status: 'confirm' | 'releasing' }

// Mirrors the enforce_release_cutoff trigger in schema.sql: no releasing
// within 10 minutes of a slot's start.
const RELEASE_CUTOFF_MS = 10 * 60 * 1000

export function YourSlotsCard({ session }: { session: Session }) {
  const anchorDayIndex = useMemo(() => currentAnchorDayIndex(), [])
  const { bookings } = useMyUpcomingBookings(session)
  const [pending, setPending] = useState<PendingRelease | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }

  async function confirmRelease(startMs: number) {
    setPending({ startMs, status: 'releasing' })
    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('slot_start', new Date(startMs).toISOString())

    setPending(null)
    if (error) showToast(error.message)
    // On success, useMyUpcomingBookings' realtime subscription (now that
    // bookings has REPLICA IDENTITY FULL) drops this row on its own — no
    // local "hide this one" bookkeeping needed, which is exactly what
    // caused a re-booked slot to stay permanently hidden here before.
  }

  if (bookings.length === 0) return null

  return (
    <div className="shrink-0 border-b border-border px-5 py-4">
      <h2 className="mb-2.5 text-heading font-bold text-text-primary">Your upcoming</h2>
      <ul className="flex flex-col gap-2.5">
        {bookings.map((booking) => {
          const startMs = new Date(booking.slot_start).getTime()
          const hour = istHourOf(startMs)
          const minute = istMinuteOf(startMs)
          const dayIndex = laundryDayIndexOfSlotStart(startMs, hour)
          const dayLabel = formatPillLabel(dayIndex, anchorDayIndex)
          const isPending = pending?.startMs === startMs
          const releasable = startMs >= Date.now() + RELEASE_CUTOFF_MS

          return (
            <li key={startMs}>
              {isPending ? (
                // Inverted like the rest of "Your upcoming" (light on dark)
                // rather than switching back to the app's dark palette mid-flow.
                <div className="pop-in flex flex-col gap-2 rounded-card bg-text-primary px-4 py-3.5">
                  <p className="text-sm text-bg">Release your {formatSlotStart(hour, minute)} slot?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending?.status === 'releasing'}
                      onClick={() => confirmRelease(startMs)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-card bg-danger px-3 py-2 text-sm font-medium text-text-primary transition-transform active:scale-[0.97] active:opacity-80 disabled:opacity-60"
                    >
                      <EjectIcon className="h-3.5 w-3.5" />
                      {pending?.status === 'releasing' ? 'Releasing…' : 'Release'}
                    </button>
                    <button
                      type="button"
                      disabled={pending?.status === 'releasing'}
                      onClick={() => setPending(null)}
                      className="flex-1 rounded-card border border-bg/15 bg-transparent px-3 py-2 text-sm font-medium text-bg transition-transform active:scale-[0.97] active:bg-bg/10 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                // The contrast flip — light card on the dark app background —
                // is what makes this read as the most important thing on
                // screen, matching the reference's "Your Upcoming" treatment.
                <button
                  type="button"
                  onClick={() =>
                    releasable
                      ? setPending({ startMs, status: 'confirm' })
                      : showToast('Too late to release — this slot starts in under 10 minutes.')
                  }
                  className="flex w-full items-center justify-between rounded-card bg-text-primary px-4 py-3.5 text-left transition-transform active:scale-[0.98]"
                >
                  <p className="text-base font-semibold text-bg">
                    {dayLabel} · {formatSlotStart(hour, minute)}
                  </p>
                  {releasable ? (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-accent">
                      <EjectIcon />
                      Release
                    </span>
                  ) : (
                    <span className="text-sm font-medium text-bg/50">Locked in</span>
                  )}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {toast && (
        <p
          key={toast}
          className="pop-in mt-2.5 rounded-card border border-border bg-surface-elevated px-4 py-3 text-center text-sm text-text-primary"
        >
          {toast}
        </p>
      )}
    </div>
  )
}
