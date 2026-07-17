import type { Session } from '@supabase/supabase-js'
import { useCurrentBooking } from '../lib/useCurrentBooking'
import { useNextBookedSlot } from '../lib/useNextBookedSlot'
import { SLOT_DURATION_MS, formatSlotStart, istHourOf, istMinuteOf } from '../lib/laundryDay'

const RING_RADIUS = 88
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

// MM:SS always — no hour segment, even though a slot can run up to 150
// minutes. Keeping it two-part is what "large mono countdown" is meant to
// read as; it just occasionally has 3 digits of minutes near the start.
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function StatusHero({ session }: { session: Session }) {
  const { isRunning, booking, remainingMs } = useCurrentBooking()
  const nextBookedMs = useNextBookedSlot()

  const remainingFraction = isRunning ? Math.min(1, Math.max(0, remainingMs / SLOT_DURATION_MS)) : 0
  const dashOffset = RING_CIRCUMFERENCE * (1 - remainingFraction)

  const who = booking
    ? booking.user_id === session.user.id
      ? 'You'
      : (booking.profiles?.full_name ?? 'Someone')
    : null

  return (
    <div className="flex shrink-0 flex-row items-center gap-4 border-b border-border bg-bg px-5 py-4">
      {/* Shrunk from a mobile-screen-dominating 208px down to this — it was
          eating too much vertical space on a phone for what's a secondary
          status readout, not the primary thing anyone's here to act on
          (that's the grid below). Row layout (not stacked) for the same
          reason: keeps this a compact strip, not a full-width block. */}
      <div className="relative aspect-square w-[min(24vw,88px)] shrink-0">
        {/* Outer bezel — the porthole rim, always visible, static structure. */}
        <div className="absolute inset-0 rounded-full border border-border bg-surface shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]" />

        {isRunning && (
          <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
            <g transform="rotate(-90 100 100)">
              <circle
                cx="100"
                cy="100"
                r={RING_RADIUS}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                style={{
                  transition: 'stroke-dashoffset 1s linear',
                  filter: 'drop-shadow(0 0 6px var(--color-accent))',
                }}
              />
            </g>
          </svg>
        )}

        {/* Drum face — only this layer spins, never the readout on top of it. */}
        <div
          className={`absolute inset-[8px] overflow-hidden rounded-full border border-border bg-surface-elevated shadow-[inset_0_3px_12px_rgba(0,0,0,0.55)] ${isRunning ? 'drum-spin' : ''}`}
        >
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-30">
            <line x1="50" y1="6" x2="50" y2="94" stroke="var(--color-border)" strokeWidth="1.5" />
            <line x1="6" y1="50" x2="94" y2="50" stroke="var(--color-border)" strokeWidth="1.5" />
            <line x1="18" y1="18" x2="82" y2="82" stroke="var(--color-border)" strokeWidth="1" />
            <line x1="82" y1="18" x2="18" y2="82" stroke="var(--color-border)" strokeWidth="1" />
            <circle cx="50" cy="50" r="20" fill="none" stroke="var(--color-border)" strokeWidth="1" />
          </svg>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={`flex items-center gap-2 text-sm font-medium ${isRunning ? 'text-accent' : 'text-text-secondary'}`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${isRunning ? 'bg-accent animate-pulse' : 'bg-text-secondary'}`} />
          {isRunning ? 'Currently washing' : 'Free now'}
          {isRunning && who && <span className="text-text-secondary">· {who}</span>}
        </span>
        {/* No empty "TIME LEFT –:–" placeholder when idle — that read as
            broken, not free. Idle shows when the machine's next claimed
            instead (still useful — that's the actual question), and omits
            this line entirely if there's nothing booked at all to show. */}
        {(isRunning || nextBookedMs !== null) && (
          <span className="font-mono text-lg font-semibold text-text-primary tabular-nums">
            {isRunning
              ? formatCountdown(remainingMs)
              : nextBookedMs !== null && `Next: ${formatSlotStart(istHourOf(nextBookedMs), istMinuteOf(nextBookedMs))}`}
          </span>
        )}
      </div>
    </div>
  )
}
