import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  SLOT_HOURS,
  currentAnchorDayIndex,
  formatPillLabel,
  formatSlotRange,
  isLateNight,
  slotStartUtcMs,
} from '../lib/laundryDay'

// Shape returned by the query below. Assumes a foreign key from
// bookings.user_id to profiles.id, which is what lets Supabase embed the
// resident's name/room alongside each booking in one request.
type BookingRow = {
  slot_start: string
  user_id: string
  profiles: { full_name: string; room_no: string } | null
}

type SlotState =
  | { kind: 'FREE' }
  | { kind: 'YOURS' }
  | { kind: 'TAKEN'; name: string; room: string }
  | { kind: 'PAST' }

export function BookingGrid({ session }: { session: Session }) {
  // Computed once on mount — this is a slot-booking app, not a clock, so we
  // don't need to notice a midnight rollover while the page sits open.
  const anchorDayIndex = useMemo(() => currentAnchorDayIndex(), [])
  const [selectedDayIndex, setSelectedDayIndex] = useState(anchorDayIndex)
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const slotStarts = useMemo(
    () => SLOT_HOURS.map((hour) => slotStartUtcMs(selectedDayIndex, hour)),
    [selectedDayIndex],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const isoStarts = slotStarts.map((ms) => new Date(ms).toISOString())

    supabase
      .from('bookings')
      .select('slot_start, user_id, profiles(full_name, room_no)')
      .in('slot_start', isoStarts)
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) {
          setError(fetchError.message)
        } else {
          setBookings((data ?? []) as unknown as BookingRow[])
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slotStarts])

  // Keyed by epoch ms, not the raw string: PostgREST returns timestamptz as
  // "2026-07-17T13:30:00+00:00" while we build "2026-07-17T13:30:00.000Z" —
  // same instant, different string, so a string-keyed map silently misses.
  const bookingByStartMs = useMemo(() => {
    const map = new Map<number, BookingRow>()
    for (const booking of bookings) map.set(new Date(booking.slot_start).getTime(), booking)
    return map
  }, [bookings])

  const [toast, setToast] = useState<string | null>(null)
  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }

  // CLAUDE.md rule 4: never check-then-insert. Insert optimistically, and if
  // Postgres says 23505 (unique violation on slot_start) someone beat us to
  // it — revert. Any other error is a trigger's raise exception (rule 5);
  // show its message as-is.
  async function bookSlot(startMs: number) {
    const optimisticBooking: BookingRow = {
      slot_start: new Date(startMs).toISOString(),
      user_id: session.user.id,
      profiles: null,
    }
    setBookings((prev) => [...prev, optimisticBooking])

    const { error: insertError } = await supabase
      .from('bookings')
      .insert({ slot_start: optimisticBooking.slot_start, user_id: session.user.id })

    if (insertError) {
      setBookings((prev) => prev.filter((b) => b !== optimisticBooking))
      showToast(insertError.code === '23505' ? 'Just taken by someone else.' : insertError.message)
    }
  }

  async function releaseSlot(startMs: number) {
    const previousBookings = bookings
    setBookings((prev) => prev.filter((b) => new Date(b.slot_start).getTime() !== startMs))

    const { error: deleteError } = await supabase
      .from('bookings')
      .delete()
      .eq('slot_start', new Date(startMs).toISOString())

    if (deleteError) {
      setBookings(previousBookings)
      showToast(deleteError.message)
    }
  }

  const pillDayIndices = [0, 1, 2, 3].map((offset) => anchorDayIndex + offset)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex gap-2 overflow-x-auto border-b border-neutral-800 px-4 py-3">
        {pillDayIndices.map((dayIndex) => (
          <button
            key={dayIndex}
            type="button"
            onClick={() => setSelectedDayIndex(dayIndex)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
              dayIndex === selectedDayIndex
                ? 'bg-neutral-100 text-neutral-950'
                : 'bg-neutral-900 text-neutral-300'
            }`}
          >
            {formatPillLabel(dayIndex, anchorDayIndex)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error && (
          <p className="mb-3 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">{error}</p>
        )}

        {loading ? (
          <p className="py-8 text-center text-neutral-500">Loading slots…</p>
        ) : error ? null : (
          <ul className="flex flex-col gap-2">
            {SLOT_HOURS.map((hour, i) => {
              const startMs = slotStarts[i]
              const booking = bookingByStartMs.get(startMs)
              const isPast = startMs + 2 * 60 * 60 * 1000 <= Date.now()

              const state: SlotState = isPast
                ? { kind: 'PAST' }
                : booking
                  ? booking.user_id === session.user.id
                    ? { kind: 'YOURS' }
                    : {
                        kind: 'TAKEN',
                        name: booking.profiles?.full_name ?? 'Someone',
                        room: booking.profiles?.room_no ?? '?',
                      }
                  : { kind: 'FREE' }

              return (
                <li key={hour}>
                  <SlotRow
                    hour={hour}
                    state={state}
                    onTap={() => {
                      if (state.kind === 'FREE') bookSlot(startMs)
                      else if (state.kind === 'YOURS') releaseSlot(startMs)
                    }}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {toast && (
        <p className="mx-4 mb-4 rounded-lg bg-neutral-800 px-4 py-3 text-center text-sm text-neutral-100">
          {toast}
        </p>
      )}
    </div>
  )
}

function SlotRow({ hour, state, onTap }: { hour: number; state: SlotState; onTap: () => void }) {
  const label = formatSlotRange(hour)
  const lateNight = isLateNight(hour)
  const tappable = state.kind === 'FREE' || state.kind === 'YOURS'

  const stateStyles: Record<SlotState['kind'], string> = {
    FREE: 'bg-neutral-900 border border-neutral-700',
    YOURS: 'bg-emerald-900 border border-emerald-600',
    TAKEN: 'bg-neutral-900 border border-neutral-800',
    PAST: 'bg-neutral-950 border border-neutral-900 opacity-50',
  }

  return (
    <button
      type="button"
      disabled={!tappable}
      onClick={onTap}
      className={`flex w-full items-center justify-between rounded-xl px-4 py-4 text-left ${stateStyles[state.kind]}`}
    >
      <div>
        <p className={`text-base font-medium ${state.kind === 'PAST' ? 'text-neutral-500' : 'text-neutral-100'}`}>
          {label}
          {lateNight && <span className="ml-2 text-xs text-neutral-500">(late night)</span>}
        </p>
        {state.kind === 'TAKEN' && (
          <p className="text-sm text-neutral-400">
            {state.name} · Room {state.room}
          </p>
        )}
        {state.kind === 'YOURS' && <p className="text-sm text-emerald-300">Tap to release</p>}
      </div>

      {state.kind === 'FREE' && <span className="text-sm text-neutral-500">Tap to book</span>}
      {state.kind === 'TAKEN' && <span className="text-lg">🔔</span>}
    </button>
  )
}
