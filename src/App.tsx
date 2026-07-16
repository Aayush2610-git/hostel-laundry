import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { AuthScreen } from './components/AuthScreen'
import { HomeScreen } from './components/HomeScreen'

function App() {
  // 'loading' until we've checked whether a session already exists (e.g. the
  // resident refreshed the page); after that it's either a real Session or
  // null (signed out).
  const [session, setSession] = useState<Session | null | 'loading'>('loading')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    // Fires on sign-in, sign-out, and token refresh — this is what swaps
    // the screen the instant verifyOtp() succeeds.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (session === 'loading') {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-950 text-neutral-500">
        Loading…
      </div>
    )
  }

  return session ? <HomeScreen session={session} /> : <AuthScreen />
}

export default App
