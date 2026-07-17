import { useMemo } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useNextFreeSlot } from '../lib/useNextFreeSlot'
import { currentAnchorDayIndex, formatPillLabel, formatSlotRange } from '../lib/laundryDay'

// Glass sticky bar: always-visible shortcut to the earliest free slot, so
// finding one doesn't require scrolling the grid. It used to book that
// slot directly on tap — residents kept mis-tapping it by accident (it's
// fixed at the bottom of the screen, easy to catch mid-scroll), so now it
// only jumps the grid to that slot and highlights it; the actual one-tap
// book still happens on the row itself (CLAUDE.md rule 7). Hidden entirely
// once there's no room left to book (every visible day already has a
// booking, or every remaining slot is taken).
export function NextFreeSlotBar({
  session,
  onNavigate,
}: {
  session: Session
  onNavigate: (dayIndex: number, startMs: number) => void
}) {
  const anchorDayIndex = useMemo(() => currentAnchorDayIndex(), [])
  const next = useNextFreeSlot(session)

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
          onClick={() => onNavigate(next.dayIndex, next.startMs)}
          className="shrink-0 rounded-pill border border-accent px-5 py-2.5 text-sm font-semibold text-accent transition-transform active:scale-[0.96]"
        >
          Go to slot
        </button>
      </div>
    </div>
  )
}
