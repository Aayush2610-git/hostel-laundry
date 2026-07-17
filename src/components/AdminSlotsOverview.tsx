import { useMemo, useState } from 'react'
import { useAdminDaySlots } from '../lib/useAdminDaySlots'
import {
  SLOT_TIMES,
  currentAnchorDayIndex,
  formatFullDate,
  formatPillLabel,
  formatSlotStart,
  isLateNight,
  istHourOf,
  istMinuteOf,
  slotStartUtcMs,
} from '../lib/laundryDay'

// Read-only — no tap-to-release or force-cancel here yet, just visibility.
// Same 4-day window BookingGrid exposes to residents (enforce_booking_limits
// rejects anything further out anyway, so there's nothing to show past it).
export function AdminSlotsOverview() {
  const anchorDayIndex = useMemo(() => currentAnchorDayIndex(), [])
  const [selectedDayIndex, setSelectedDayIndex] = useState(anchorDayIndex)
  const pillDayIndices = [0, 1, 2, 3].map((offset) => anchorDayIndex + offset)

  const { bookings, offers, watchers, loading } = useAdminDaySlots(selectedDayIndex)

  const slotStarts = useMemo(
    () => SLOT_TIMES.map(({ hour, minute }) => slotStartUtcMs(selectedDayIndex, hour, minute)),
    [selectedDayIndex],
  )

  const bookingByStartMs = useMemo(() => {
    const map = new Map<number, (typeof bookings)[number]>()
    for (const b of bookings) map.set(new Date(b.slot_start).getTime(), b)
    return map
  }, [bookings])

  const offerByStartMs = useMemo(() => {
    const map = new Map<number, (typeof offers)[number]>()
    for (const o of offers) map.set(new Date(o.slot_start).getTime(), o)
    return map
  }, [offers])

  const watchersByStartMs = useMemo(() => {
    const map = new Map<number, typeof watchers>()
    for (const w of watchers) {
      const ms = new Date(w.slot_start).getTime()
      const list = map.get(ms) ?? []
      list.push(w)
      map.set(ms, list)
    }
    return map
  }, [watchers])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {pillDayIndices.map((dayIndex) => (
            <button
              key={dayIndex}
              type="button"
              onClick={() => setSelectedDayIndex(dayIndex)}
              className={`rounded-pill px-4 py-2 text-sm font-medium transition-all duration-200 ${
                dayIndex === selectedDayIndex ? 'bg-accent text-text-primary' : 'bg-surface text-text-secondary'
              }`}
            >
              {formatPillLabel(dayIndex, anchorDayIndex)}
            </button>
          ))}
        </div>
        <span className="text-sm text-text-secondary">{formatFullDate(selectedDayIndex)}</span>
      </div>

      {loading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-text-secondary">
                <th className="px-4 py-3 font-medium">Slot</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Held for (until)</th>
                <th className="px-4 py-3 font-medium">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {SLOT_TIMES.map(({ hour, minute }, i) => {
                const startMs = slotStarts[i]
                const booking = bookingByStartMs.get(startMs)
                const offer = offerByStartMs.get(startMs)
                const slotWatchers = watchersByStartMs.get(startMs) ?? []
                const isPast = startMs <= Date.now()

                return (
                  <tr key={`${hour}-${minute}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-text-primary">
                      {formatSlotStart(hour, minute)}
                      {isLateNight(hour) && <span className="ml-1.5 text-xs text-text-secondary">(late night)</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {isPast ? (
                        <span className="text-text-secondary">Past</span>
                      ) : booking ? (
                        <span className="text-text-primary">
                          Booked — {booking.profiles?.full_name ?? 'Someone'} · Room {booking.profiles?.room_no ?? '?'}
                        </span>
                      ) : offer ? (
                        <span className="text-accent">Held</span>
                      ) : (
                        <span className="text-text-secondary">Free</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">
                      {offer
                        ? `${offer.profiles?.full_name ?? 'Someone'} until ${formatSlotStart(
                            istHourOf(new Date(offer.expires_at).getTime()),
                            istMinuteOf(new Date(offer.expires_at).getTime()),
                          )}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">
                      {slotWatchers.length === 0
                        ? '—'
                        : slotWatchers.map((w, idx) => `${idx + 1}. ${w.full_name} (Rm ${w.room_no})`).join(', ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
