import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { AdminScreen } from './components/AdminScreen'
import { AuthScreen } from './components/AuthScreen'
import { HomeScreen } from './components/HomeScreen'

function App() {
  // 'loading' until we've checked whether a session already exists (e.g. the
  // resident refreshed the page); after that it's either a real Session or
  // null (signed out).
  const [session, setSession] = useState<Session | null | 'loading'>('loading')
  const [view, setView] = useState<'home' | 'admin'>('home')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    // Fires on sign-in, sign-out, and token refresh — this is what swaps
    // the screen the instant verifyOtp() succeeds.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // This is a phone app. On a wide viewport it renders as a phone-shaped
  // column centered on the page — not stretched edge to edge — with a
  // distinct backdrop behind it so the "device" reads as contained. A fixed
  // (not minimum) height matters: it's what lets HomeScreen's slot list
  // scroll *inside* the column while the header/hero/bottom bar stay put,
  // instead of the whole page scrolling.
  // Admin gets its own full-width, naturally-scrolling layout — outside the
  // phone-frame column entirely, not squeezed into it — since it's a
  // laptop tool (a table you edit, a day's grid you scan), not a pocket
  // one. Falls through to the normal branch below if session drops out
  // from under it (e.g. signing out from inside AdminScreen).
  if (view === 'admin' && session && session !== 'loading') {
    return (
      <div className="min-h-dvh bg-black">
        <AdminScreen session={session} onExit={() => setView('home')} />
      </div>
    )
  }

  return (
    <div className="h-dvh bg-black">
      <div className="mx-auto flex h-dvh w-full max-w-[440px] flex-col overflow-hidden bg-bg text-text-primary">
        {session === 'loading' ? (
          <div className="flex flex-1 items-center justify-center text-text-secondary">Loading…</div>
        ) : session ? (
          <HomeScreen session={session} onOpenAdmin={() => setView('admin')} />
        ) : (
          <AuthScreen />
        )}
      </div>
    </div>
  )
}

export default App
