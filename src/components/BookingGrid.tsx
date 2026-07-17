import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useMyUpcomingBookings } from '../lib/useMyUpcomingBookings'
import { useMyWatchedSlots } from '../lib/useMyWatchedSlots'
import {
  SLOT_TIMES,
  currentAnchorDayIndex,
  formatFullDate,
  formatPillLabel,
  formatSlotEnd,
  formatSlotStart,
  isLateNight,
  istHourOf,
  istMinuteOf,
  laundryDayIndexOfSlotStart,
  slotStartUtcMs,
} from '../lib/laundryDay'
import { BellIcon, EjectIcon, PlusIcon } from './icons'

// Shape returned by the query below. Assumes a foreign key from
// bookings.user_id to profiles.id, which is what lets Supabase embed the
// resident's name/room alongside each booking in one request.
type BookingRow = {
  slot_start: string
  user_id: string
  profiles: { full_name: string; room_no: string } | null
}

// An unresolved (outcome is null), unexpired offer — see schema.sql
// section 11a. Only ever exists for a slot with no current booking.
type OfferRow = { slot_start: string; user_id: string; expires_at: string }

type SlotState =
  | { kind: 'FREE' }
  | { kind: 'HELD'; forMe: boolean; expiresAt: number }
  | { kind: 'YOURS'; releasable: boolean }
  | { kind: 'TAKEN'; name: string; room: string; position: number | null }
  | { kind: 'PAST' }

// Mirrors the enforce_release_cutoff trigger's own cutoff (`old.slot_start
// < now() + interval '10 minutes'`) so the release affordance locks out in
// the UI before the server would reject it — same reasoning as the isPast
// mirror of enforce_booking_limits below.
const RELEASE_CUTOFF_MS = 10 * 60 * 1000

// "2nd in line" — residents count in the tens, so no locale/i18n concerns.
function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

// A fresh object every time HomeScreen's goToSlot runs, even for the same
// startMs twice in a row — object identity (not just the value) is what
// the scroll+glow effect below keys off of, so a repeat tap on
// NextFreeSlotBar still re-triggers it.
export type SlotHighlight = { startMs: number } | null

export function BookingGrid({
  session,
  selectedDayIndex,
  onSelectDayIndex,
  highlight,
}: {
  session: Session
  selectedDayIndex: number
  onSelectDayIndex: (dayIndex: number) => void
  highlight: SlotHighlight
}) {
  // Computed once on mount — this is a slot-booking app, not a clock, so we
  // don't need to notice a midnight rollover while the page sits open.
  const anchorDayIndex = useMemo(() => currentAnchorDayIndex(), [])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [offers, setOffers] = useState<OfferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { watched, refetch: refetchWatched } = useMyWatchedSlots(session)

  // The cap is "max 1 booking per laundry day" (enforced in the
  // enforce_booking_limits trigger in schema.sql), not a global count, so
  // we check it per day: does the currently selected day already have one
  // of this user's upcoming bookings on it?
  const { bookings: myUpcomingBookings } = useMyUpcomingBookings(session)
  const myBookedDayIndices = useMemo(() => {
    const set = new Set<number>()
    for (const booking of myUpcomingBookings) {
      const ms = new Date(booking.slot_start).getTime()
      set.add(laundryDayIndexOfSlotStart(ms, istHourOf(ms)))
    }
    return set
  }, [myUpcomingBookings])
  const dayAtCap = myBookedDayIndices.has(selectedDayIndex)

  // useMyUpcomingBookings has its own realtime subscription that's proven
  // reliable (YourSlotsCard depends on it correctly reflecting a release).
  // This component's own day-scoped channel below has intermittently missed
  // updates, so rather than keep chasing that, treat this set as the
  // authoritative answer to "is this slot mine" — checked before falling
  // back to this component's own (possibly stale) fetch.
  const myBookedStartMsSet = useMemo(() => {
    const set = new Set<number>()
    for (const booking of myUpcomingBookings) set.add(new Date(booking.slot_start).getTime())
    return set
  }, [myUpcomingBookings])

  // Which YOURS slot (if any) is showing the release-confirm prompt.
  const [pendingRelease, setPendingRelease] = useState<{
    startMs: number
    status: 'confirm' | 'releasing'
  } | null>(null)

  const slotStarts = useMemo(
    () => SLOT_TIMES.map(({ hour, minute }) => slotStartUtcMs(selectedDayIndex, hour, minute)),
    [selectedDayIndex],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const isoStarts = slotStarts.map((ms) => new Date(ms).toISOString())

    function loadBookings() {
      return supabase
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
    }

    function loadOffers() {
      return supabase
        .from('slot_offers')
        .select('slot_start, user_id, expires_at')
        .in('slot_start', isoStarts)
        .is('outcome', null)
        .gt('expires_at', new Date().toISOString())
        .then(({ data, error: fetchError }) => {
          if (cancelled) return
          if (!fetchError) setOffers((data ?? []) as OfferRow[])
        })
    }

    loadBookings()
    loadOffers()

    // Realtime: someone else's booking/release should show up without a
    // refresh. postgres_changes filters only support one `column=eq.value`
    // condition, not the range we need for a laundry day, so we listen to
    // every change on the table and just re-run the same query above when a
    // change touches one of the slots currently on screen — that keeps this
    // in sync with the DB (rule 5: business logic, and therefore the truth
    // about a slot, lives server-side) instead of us hand-merging payloads.
    //
    // The random suffix matters: supabase.channel(topic) reuses an existing
    // channel object for a topic that's still registered, and deregistering
    // only completes after an async round trip to close the socket — which
    // can't happen before React StrictMode's synchronous double-invoke of
    // this effect in dev. Without a fresh topic per run, the second run's
    // .on() lands on an already-subscribed channel and throws.
    const channel = supabase
      .channel(`bookings-day-${selectedDayIndex}-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          // NOT `payload.new ?? payload.old` — for a DELETE (a release),
          // Supabase sets `new: {}`, an empty object, not null/undefined,
          // so `??` never falls through to `old` and this silently no-ops
          // on every release for anyone who isn't the person releasing (a
          // real bug this shipped with: other viewers saw a stale TAKEN
          // row until a manual refresh re-fetched clean). eventType tells
          // us directly which side actually has the row.
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as { slot_start?: string }
          if (!row?.slot_start) return
          if (slotStarts.includes(new Date(row.slot_start).getTime())) loadBookings()
        },
      )
      // A slot's "held" state (schema.sql section 11b/11d) must be visible
      // to everyone, not just the offer holder — otherwise someone taps a
      // slot that looks free, gets rejected server-side, and it looks like
      // the app is broken. slot_offers rows are never deleted (only
      // updated), so the eventType branch here never actually hits DELETE
      // in practice — kept anyway so this doesn't quietly regress the same
      // way the bookings listener did if that ever changes.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slot_offers' }, (payload) => {
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as { slot_start?: string }
        if (!row?.slot_start) return
        if (slotStarts.includes(new Date(row.slot_start).getTime())) loadOffers()
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // myUpcomingBookings is included as a backstop: it's proven reliable
    // (YourSlotsCard depends on it), so any change there — booking or
    // releasing a slot from anywhere in the app — also forces a fresh
    // fetch here, regardless of whether this component's own channel
    // above happens to have missed the underlying change.
  }, [slotStarts, selectedDayIndex, myUpcomingBookings])

  // Keyed by epoch ms, not the raw string: PostgREST returns timestamptz as
  // "2026-07-17T13:30:00+00:00" while we build "2026-07-17T13:30:00.000Z" —
  // same instant, different string, so a string-keyed map silently misses.
  const bookingByStartMs = useMemo(() => {
    const map = new Map<number, BookingRow>()
    for (const booking of bookings) map.set(new Date(booking.slot_start).getTime(), booking)
    return map
  }, [bookings])

  const offerByStartMs = useMemo(() => {
    const map = new Map<number, OfferRow>()
    for (const offer of offers) map.set(new Date(offer.slot_start).getTime(), offer)
    return map
  }, [offers])

  const watchedPositionByStartMs = useMemo(() => {
    const map = new Map<number, number>()
    for (const w of watched) map.set(new Date(w.slot_start).getTime(), w.position)
    return map
  }, [watched])

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

  // CLAUDE.md rule 7: release is irreversible, so it's the one action that
  // gets a confirm step — this only runs after the user taps "Release" on
  // the inline prompt, never on the first tap.
  async function releaseSlot(startMs: number) {
    setPendingRelease({ startMs, status: 'releasing' })
    const previousBookings = bookings
    setBookings((prev) => prev.filter((b) => new Date(b.slot_start).getTime() !== startMs))

    const { error: deleteError } = await supabase
      .from('bookings')
      .delete()
      .eq('slot_start', new Date(startMs).toISOString())

    setPendingRelease(null)
    if (deleteError) {
      setBookings(previousBookings)
      showToast(deleteError.message)
    }
  }

  // Watching is reversible and low-stakes (unlike release), so it gets the
  // same one-tap-no-confirm treatment as booking (CLAUDE.md rule 7) rather
  // than release's inline confirm. prevent_watching_own_booking (schema.sql
  // section 11e) and the unique(slot_start, user_id) constraint are the
  // real guards; this is just insert-or-delete and show whatever error
  // comes back.
  //
  // pendingWatch guards a fast double-tap: unlike bookSlot/releaseSlot,
  // there's no optimistic state flip to make the row stop looking tappable
  // between the first tap and the refetch landing, so without this a second
  // tap in that window re-sends the same insert and collides with the
  // unique constraint (23505 / HTTP 409).
  const [pendingWatch, setPendingWatch] = useState<Set<number>>(new Set())

  async function toggleWatch(startMs: number, isWatching: boolean) {
    if (pendingWatch.has(startMs)) return
    setPendingWatch((prev) => new Set(prev).add(startMs))

    const isoStart = new Date(startMs).toISOString()
    const { error: watchError } = isWatching
      ? await supabase.from('slot_watchers').delete().eq('slot_start', isoStart)
      : await supabase.from('slot_watchers').insert({ slot_start: isoStart, user_id: session.user.id })

    setPendingWatch((prev) => {
      const next = new Set(prev)
      next.delete(startMs)
      return next
    })

    if (watchError) {
      showToast(watchError.message)
    } else {
      refetchWatched()
    }
  }

  // NextFreeSlotBar's shortcut sets highlight (and possibly switches
  // selectedDayIndex) instead of booking directly — this is what actually
  // draws the eye to the row afterward: scroll it into view and give it a
  // few seconds of glow. Keyed on `highlight` (object identity, not just
  // startMs) so a repeat tap on the same slot re-triggers it, and gated on
  // `!loading` + slotStarts including the target — a day switch means this
  // has to wait for that day's own fetch to land before the row exists to
  // scroll to.
  const rowRefs = useRef(new Map<number, HTMLLIElement>())
  const [pulsingStartMs, setPulsingStartMs] = useState<number | null>(null)

  useEffect(() => {
    if (!highlight || loading || !slotStarts.includes(highlight.startMs)) return
    const el = rowRefs.current.get(highlight.startMs)
    if (!el) return

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPulsingStartMs(highlight.startMs)
    const timer = setTimeout(() => setPulsingStartMs(null), 2500)
    return () => clearTimeout(timer)
  }, [highlight, loading, slotStarts])

  const pillDayIndices = [0, 1, 2, 3].map((offset) => anchorDayIndex + offset)

  return (
    <div className="flex flex-col">
      <div className="shrink-0 px-5 pt-5 pb-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-heading font-bold text-text-primary">Book a slot</h2>
          <span className="text-sm text-text-secondary">{formatFullDate(selectedDayIndex)}</span>
        </div>
      </div>

      <div className="flex shrink-0 gap-2 overflow-x-auto px-5 pb-3">
        {pillDayIndices.map((dayIndex) => (
          <button
            key={dayIndex}
            type="button"
            onClick={() => onSelectDayIndex(dayIndex)}
            className={`shrink-0 rounded-pill px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.96] ${
              dayIndex === selectedDayIndex ? 'bg-accent text-text-primary' : 'bg-surface text-text-secondary'
            }`}
          >
            {formatPillLabel(dayIndex, anchorDayIndex)}
          </button>
        ))}
      </div>

      <div className="px-5 py-3">
        {error && (
          <p className="pop-in mb-3 rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
        )}

        {loading ? (
          <p className="py-8 text-center text-text-secondary">Loading slots…</p>
        ) : error ? null : (
          <ul className="flex flex-col gap-2.5">
            {SLOT_TIMES.map(({ hour, minute }, i) => {
              const startMs = slotStarts[i]
              const booking = bookingByStartMs.get(startMs)
              const offer = offerByStartMs.get(startMs)
              // Must match the enforce_booking_limits trigger's own cutoff
              // (`new.slot_start < now()`) exactly, not the slot's full 2.5h
              // occupancy — otherwise a slot can sit here as "Tap to book"
              // long after the server would actually reject it as past.
              const isPast = startMs <= Date.now()

              // offer is only ever set on a slot with no current booking
              // (schema.sql section 11d only creates one after a booking is
              // deleted), so this branch and the booking branch below are
              // mutually exclusive in practice — checked in this order
              // anyway so a HELD reading wins if that invariant ever slips.
              const state: SlotState = isPast
                ? { kind: 'PAST' }
                : offer
                  ? { kind: 'HELD', forMe: offer.user_id === session.user.id, expiresAt: new Date(offer.expires_at).getTime() }
                  : myBookedStartMsSet.has(startMs) || booking?.user_id === session.user.id
                    ? { kind: 'YOURS', releasable: startMs >= Date.now() + RELEASE_CUTOFF_MS }
                    : booking
                      ? {
                          kind: 'TAKEN',
                          name: booking.profiles?.full_name ?? 'Someone',
                          room: booking.profiles?.room_no ?? '?',
                          position: watchedPositionByStartMs.get(startMs) ?? null,
                        }
                      : { kind: 'FREE' }

              const rowKey = `${hour}-${minute}`

              const setRowRef = (el: HTMLLIElement | null) => {
                if (el) rowRefs.current.set(startMs, el)
                else rowRefs.current.delete(startMs)
              }

              if (state.kind === 'YOURS' && pendingRelease?.startMs === startMs) {
                return (
                  <li key={rowKey} ref={setRowRef}>
                    <ReleaseConfirmRow
                      hour={hour}
                      minute={minute}
                      releasing={pendingRelease.status === 'releasing'}
                      onRelease={() => releaseSlot(startMs)}
                      onCancel={() => setPendingRelease(null)}
                    />
                  </li>
                )
              }

              return (
                <li key={rowKey} ref={setRowRef}>
                  <SlotRow
                    hour={hour}
                    minute={minute}
                    startMs={startMs}
                    state={state}
                    highlighted={startMs === pulsingStartMs}
                    onTap={() => {
                      if (state.kind === 'FREE') {
                        // Only surfaced reactively, on the tap that's actually
                        // blocked by it — not as a standing banner the moment
                        // you happen to already have a booking that day.
                        if (dayAtCap) {
                          showToast(
                            `You already have a booking on ${formatPillLabel(selectedDayIndex, anchorDayIndex)} — release it to book another.`,
                          )
                        } else {
                          bookSlot(startMs)
                        }
                      } else if (state.kind === 'YOURS') {
                        if (state.releasable) {
                          setPendingRelease({ startMs, status: 'confirm' })
                        } else {
                          showToast('Too late to release — this slot starts in under 10 minutes.')
                        }
                      } else if (state.kind === 'TAKEN') {
                        toggleWatch(startMs, state.position !== null)
                      }
                    }}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {toast && (
        <p
          key={toast}
          className="pop-in mx-5 mb-4 shrink-0 rounded-card border border-border bg-surface-elevated px-4 py-3 text-center text-sm text-text-primary"
        >
          {toast}
        </p>
      )}
    </div>
  )
}

function SlotRow({
  hour,
  minute,
  startMs,
  state,
  highlighted,
  onTap,
}: {
  hour: number
  minute: number
  startMs: number
  state: SlotState
  highlighted: boolean
  onTap: () => void
}) {
  // Start time only, never a range — "7:00 – 7:30 AM" read as "the machine
  // only runs half an hour." "Load your clothes" (FREE) and "Free again" /
  // "Done by" (TAKEN/YOURS) are what actually communicate the real 2.5h
  // occupancy, computed from formatSlotEnd (SLOT_DURATION_MS), never a
  // second hardcoded time.
  const startLabel = formatSlotStart(hour, minute)
  const lateNight = isLateNight(hour)
  // HELD is never tappable, even when it's held for me — claiming happens
  // through the offer card at the top of home (not this row), so the
  // release-cutoff swap logic that lives there doesn't need duplicating.
  const tappable = state.kind === 'FREE' || state.kind === 'YOURS' || state.kind === 'TAKEN'

  const stateStyles: Record<SlotState['kind'], string> = {
    FREE: 'bg-surface-elevated border border-border',
    HELD: 'bg-surface border border-border opacity-70',
    YOURS: 'bg-accent-soft border border-accent shadow-[0_0_16px_-4px_var(--color-accent)]',
    TAKEN: 'bg-surface border border-border',
    PAST: 'bg-bg border border-border opacity-40',
  }

  return (
    <button
      type="button"
      disabled={!tappable}
      onClick={onTap}
      className={`flex w-full items-center justify-between rounded-card px-4 py-3.5 text-left transition-all duration-200 ${tappable ? 'active:scale-[0.98]' : ''} ${stateStyles[state.kind]} ${highlighted ? 'slot-highlight' : ''}`}
    >
      <div>
        <p className={`text-base font-medium ${state.kind === 'PAST' ? 'text-text-secondary' : 'text-text-primary'}`}>
          {startLabel}
          {state.kind === 'FREE' && (
            <span className="ml-2 text-xs font-normal text-text-secondary">Load your clothes</span>
          )}
          {lateNight && <span className="ml-2 text-xs text-text-secondary">(late night)</span>}
        </p>
        {state.kind === 'FREE' && (
          <p className="text-sm text-text-secondary">Done by {formatSlotEnd(startMs)}</p>
        )}
        {state.kind === 'TAKEN' && (
          <>
            <p className="text-sm text-text-secondary">
              {state.name} · Room {state.room}
            </p>
            <p className="text-sm text-text-secondary">
              Free again {formatSlotEnd(startMs)}
              {state.position !== null && (
                <span className="text-accent"> · You're {ordinal(state.position)} in line</span>
              )}
            </p>
          </>
        )}
        {state.kind === 'HELD' && (
          <p className="text-sm text-text-secondary">
            {state.forMe
              ? 'Held for you — claim above'
              : `Held for someone until ${formatSlotStart(istHourOf(state.expiresAt), istMinuteOf(state.expiresAt))}`}
          </p>
        )}
        {state.kind === 'YOURS' && (
          <>
            <p className="text-sm text-text-secondary">Done by {formatSlotEnd(startMs)}</p>
            {state.releasable ? (
              <p className="flex items-center gap-1.5 text-sm text-accent">
                <EjectIcon className="h-3.5 w-3.5" />
                Tap to release
              </p>
            ) : (
              <p className="text-sm text-text-secondary">Locked in — starts soon</p>
            )}
          </>
        )}
      </div>

      {state.kind === 'FREE' && (
        <span className="flex items-center gap-1.5 text-sm font-medium text-accent">
          <PlusIcon className="h-3.5 w-3.5" />
          Book
        </span>
      )}
      {state.kind === 'TAKEN' && (
        <span className={`flex items-center gap-1.5 text-sm font-medium ${state.position !== null ? 'text-accent' : 'text-text-secondary'}`}>
          <BellIcon className="h-4 w-4" filled={state.position !== null} />
          {state.position === null ? 'Want this slot' : 'Watching'}
        </span>
      )}
    </button>
  )
}

// The one confirm step in the app (CLAUDE.md rule 7) — release is
// irreversible, booking is not. Replaces the YOURS row in place rather than
// opening a modal.
function ReleaseConfirmRow({
  hour,
  minute,
  releasing,
  onRelease,
  onCancel,
}: {
  hour: number
  minute: number
  releasing: boolean
  onRelease: () => void
  onCancel: () => void
}) {
  return (
    <div className="pop-in flex flex-col gap-2 rounded-card border border-accent bg-accent-soft px-4 py-3.5 shadow-[0_0_16px_-4px_var(--color-accent)]">
      <p className="text-sm text-text-primary">Release your {formatSlotStart(hour, minute)} slot?</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={releasing}
          onClick={onRelease}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-card bg-danger px-3 py-2 text-sm font-medium text-text-primary transition-transform active:scale-[0.97] active:opacity-80 disabled:opacity-60"
        >
          <EjectIcon className="h-3.5 w-3.5" />
          {releasing ? 'Releasing…' : 'Release'}
        </button>
        <button
          type="button"
          disabled={releasing}
          onClick={onCancel}
          className="flex-1 rounded-card border border-border bg-transparent px-3 py-2 text-sm font-medium text-text-secondary transition-transform active:scale-[0.97] active:bg-surface-elevated disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
