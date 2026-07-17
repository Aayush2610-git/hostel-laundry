import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AdminResidents } from './AdminResidents'
import { AdminSlotsOverview } from './AdminSlotsOverview'

type Tab = 'residents' | 'slots'

// Full browser width, not the phone-frame column the resident-facing app
// uses — this is a laptop tool (a table you edit, a day's grid you scan),
// not a pocket one. App.tsx renders this outside that column entirely.
export function AdminScreen({ session, onExit }: { session: Session; onExit: () => void }) {
  const [tab, setTab] = useState<Tab>('residents')

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-6 py-6 text-text-primary">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-text-secondary">{session.user.email}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onExit}
            className="rounded-card bg-surface-elevated px-4 py-2 text-sm font-medium transition-transform active:scale-[0.96]"
          >
            Back to booking
          </button>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="rounded-card bg-surface-elevated px-4 py-2 text-sm font-medium transition-transform active:scale-[0.96]"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex gap-2 border-b border-border">
        {(
          [
            ['residents', 'Residents'],
            ['slots', "Today's slots"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'residents' ? <AdminResidents /> : <AdminSlotsOverview />}
    </div>
  )
}
