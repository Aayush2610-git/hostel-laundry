import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useMyProfile } from '../lib/useMyProfile'
import { BookingGrid } from './BookingGrid'
import { NextFreeSlotBar } from './NextFreeSlotBar'
import { OfferCard } from './OfferCard'
import { StatusHero } from './StatusHero'
import { YourSlotsCard } from './YourSlotsCard'

export function HomeScreen({ session, onOpenAdmin }: { session: Session; onOpenAdmin: () => void }) {
  const profile = useMyProfile(session)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <span className="text-sm text-text-secondary">
          {profile ? `${profile.full_name} · Room ${profile.room_no}` : ' '}
        </span>
        <div className="flex items-center gap-2">
          {profile?.is_admin && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="rounded-card bg-surface-elevated px-3 py-1.5 text-sm font-medium text-text-primary transition-transform active:scale-[0.96]"
            >
              Admin
            </button>
          )}
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="rounded-card bg-surface-elevated px-3 py-1.5 text-sm font-medium text-text-primary transition-transform active:scale-[0.96]"
          >
            Sign out
          </button>
        </div>
      </header>
      <OfferCard session={session} />
      <StatusHero session={session} />
      <YourSlotsCard session={session} />
      <BookingGrid session={session} />
      <NextFreeSlotBar session={session} />
    </div>
  )
}
