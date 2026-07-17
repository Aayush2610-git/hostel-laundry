import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useMyActiveOffer } from '../lib/useMyActiveOffer'
import { useMyUpcomingBookings } from '../lib/useMyUpcomingBookings'
import { formatSlotStart, istHourOf, istMinuteOf, laundryDayIndexOfSlotStart } from '../lib/laundryDay'

// MM:SS, same shape as StatusHero's countdown — duplicated rather than
// shared since it's 4 lines and the two components have nothing else in
// common (CLAUDE.md: three similar lines beats a premature abstraction).
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type ClaimStep = 'idle' | 'confirm-swap' | 'pick-swap'

// The prominent top-of-home card for "you have an active offer." In-app is
// the source of truth here, not the offer email (which can land in spam,
// or just not be checked in a 10-minute window) — this is what a resident
// actually sees the moment they open the app while holding an offer.
export function OfferCard({ session }: { session: Session }) {
  const offer = useMyActiveOffer(session)
  const { bookings: myUpcomingBookings } = useMyUpcomingBookings(session)

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  const [claimStep, setClaimStep] = useState<ClaimStep>('idle')
  const [selectedRelease, setSelectedRelease] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'claim' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startMs = offer ? new Date(offer.slot_start).getTime() : null
  const expiresAtMs = offer ? new Date(offer.expires_at).getTime() : null
  const remainingMs = expiresAtMs !== null ? expiresAtMs - nowMs : 0

  // Reset any in-progress claim UI whenever the underlying offer changes —
  // a new one arriving, or this one resolving — so stale picker state never
  // survives into a different offer.
  useEffect(() => {
    setClaimStep('idle')
    setSelectedRelease(null)
    setError(null)
  }, [offer?.slot_start])

  // "At my cap" is scoped to the offered slot's own laundry day (the cap in
  // enforce_booking_limits is per-day, not global — schema.sql section 6),
  // and excludes anything already started: mid-wash isn't a fallback to
  // give up anymore.
  const releaseCandidates = useMemo(() => {
    if (startMs === null) return []
    const targetDay = laundryDayIndexOfSlotStart(startMs, istHourOf(startMs))
    return myUpcomingBookings.filter((b) => {
      if (b.started_at) return false
      const bMs = new Date(b.slot_start).getTime()
      return laundryDayIndexOfSlotStart(bMs, istHourOf(bMs)) === targetDay
    })
  }, [myUpcomingBookings, startMs])

  // Countdown hitting zero hides the card immediately, client-side — same
  // "expires_at > now(), not a flag" principle the DB uses (schema.sql
  // section 11a), applied here so there's no wait on realtime or the 30s
  // poll backstop in useMyActiveOffer for the card to disappear on time.
  if (!offer || startMs === null || expiresAtMs === null || remainingMs <= 0) return null

  // Captured here rather than read off `offer` inside the closures below:
  // TS's narrowing from the early return above doesn't survive into nested
  // function declarations, only into values already pulled out at this level.
  const offerSlotStart = offer.slot_start
  const slotLabel = formatSlotStart(istHourOf(startMs), istMinuteOf(startMs))

  function labelFor(isoSlotStart: string): string {
    const ms = new Date(isoSlotStart).getTime()
    return formatSlotStart(istHourOf(ms), istMinuteOf(ms))
  }

  async function claim(releaseSlotStart?: string) {
    setPendingAction('claim')
    setError(null)
    const { error: claimError } = await supabase.rpc('claim_offer', {
      target_slot_start: offerSlotStart,
      release_slot_start: releaseSlotStart ?? null,
    })
    setPendingAction(null)
    if (claimError) {
      setError(claimError.message)
    }
    // On success useMyActiveOffer's realtime subscription picks up the
    // offer flipping to 'claimed' and this card unmounts on its own.
  }

  function handleClaimTap() {
    if (releaseCandidates.length === 0) {
      claim()
    } else if (releaseCandidates.length === 1) {
      setClaimStep('confirm-swap')
    } else {
      setClaimStep('pick-swap')
    }
  }

  async function decline() {
    setPendingAction('decline')
    setError(null)
    const declinedSlotStart = offerSlotStart
    const { error: declineError } = await supabase.rpc('decline_offer', {
      target_slot_start: declinedSlotStart,
    })
    setPendingAction(null)
    if (declineError) {
      setError(declineError.message)
      return
    }
    // Best-effort nudge to whoever the queue cascades to next — in-app
    // realtime is what actually informs them, so a failure here (network
    // blip, function cold-starting) isn't worth surfacing to the decliner.
    void supabase.functions.invoke('notify-offer-holder', { body: { slot_start: declinedSlotStart } })
  }

  return (
    <div className="pop-in mx-5 mt-4 shrink-0 rounded-card border border-accent bg-accent-soft px-5 py-4 shadow-[0_0_20px_-4px_var(--color-accent)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow font-medium tracking-wide text-accent uppercase">Your slot is ready</p>
          <p className="text-lg font-bold text-text-primary">{slotLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-eyebrow font-medium tracking-wide text-text-secondary uppercase">Time left</p>
          <p className="font-mono text-2xl font-semibold text-text-primary tabular-nums">
            {formatCountdown(remainingMs)}
          </p>
        </div>
      </div>

      {claimStep === 'idle' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pendingAction !== null}
            onClick={handleClaimTap}
            className="flex-1 rounded-card bg-accent px-4 py-2.5 text-sm font-semibold text-text-primary transition-transform active:scale-[0.97] disabled:opacity-60"
          >
            {pendingAction === 'claim' ? 'Claiming…' : 'Claim'}
          </button>
          <button
            type="button"
            disabled={pendingAction !== null}
            onClick={decline}
            className="flex-1 rounded-card border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-text-secondary transition-transform active:scale-[0.97] disabled:opacity-60"
          >
            {pendingAction === 'decline' ? 'Declining…' : 'No thanks'}
          </button>
        </div>
      )}

      {claimStep === 'confirm-swap' && releaseCandidates[0] && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-text-primary">
            Claim {slotLabel}? This releases your {labelFor(releaseCandidates[0].slot_start)}.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => claim(releaseCandidates[0].slot_start)}
              className="flex-1 rounded-card bg-accent px-4 py-2.5 text-sm font-semibold text-text-primary transition-transform active:scale-[0.97] disabled:opacity-60"
            >
              {pendingAction === 'claim' ? 'Claiming…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => setClaimStep('idle')}
              className="flex-1 rounded-card border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-text-secondary transition-transform active:scale-[0.97] disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {claimStep === 'pick-swap' && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-text-primary">Claiming {slotLabel} releases one of your slots — pick which:</p>
          <div className="flex flex-col gap-1.5">
            {releaseCandidates.map((b) => (
              <button
                key={b.slot_start}
                type="button"
                onClick={() => setSelectedRelease(b.slot_start)}
                className={`rounded-card border px-3 py-2 text-left text-sm ${
                  selectedRelease === b.slot_start
                    ? 'border-accent bg-accent/20 text-text-primary'
                    : 'border-border bg-transparent text-text-secondary'
                }`}
              >
                {labelFor(b.slot_start)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pendingAction !== null || !selectedRelease}
              onClick={() => selectedRelease && claim(selectedRelease)}
              className="flex-1 rounded-card bg-accent px-4 py-2.5 text-sm font-semibold text-text-primary transition-transform active:scale-[0.97] disabled:opacity-60"
            >
              {pendingAction === 'claim' ? 'Claiming…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => {
                setClaimStep('idle')
                setSelectedRelease(null)
              }}
              className="flex-1 rounded-card border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-text-secondary transition-transform active:scale-[0.97] disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
