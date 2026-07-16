import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { BookingGrid } from './BookingGrid'

export function HomeScreen({ session }: { session: Session }) {
  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <span className="text-sm text-neutral-400">{session.user.email}</span>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 active:bg-neutral-700"
        >
          Sign out
        </button>
      </header>
      <BookingGrid session={session} />
    </div>
  )
}
