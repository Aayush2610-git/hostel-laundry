import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function AuthScreen() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })

    setLoading(false)
    if (error) {
      // The resident-allowlist check lives in a Postgres trigger on
      // auth.users (handle_new_user). Its raise-exception DOES reach the
      // HTTP response cleanly (verified: 500 with body
      // {"code":"P0001","message":"This email is not on the resident
      // list."}) — but supabase-js mangles that into an unreadable
      // error.message ("{}") when parsing a 500-status auth error, unlike
      // PostgREST's clean passthrough for table operations (rule 5). Not
      // worth working around supabase-js's parsing here — show a fixed,
      // controlled message instead.
      console.error('signInWithOtp failed:', error)
      setError('This email isn’t on the resident list. Contact your hostel admin to get access.')
      return
    }
    setStep('code')
  }

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })

    setLoading(false)
    if (error) {
      setError(error.message)
    }
    // On success, Supabase stores the session and App's onAuthStateChange
    // listener notices and swaps in the home screen — no navigation here.
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-2xl font-semibold">Hostel Laundry</h1>

        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-card border border-border bg-surface px-4 py-3 text-lg placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-card bg-accent px-4 py-3 text-lg font-medium text-text-primary active:opacity-80 disabled:opacity-50"
            >
              {loading ? 'Sending code…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
            <p className="text-center text-sm text-text-secondary">
              Code sent to {email}
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="rounded-card border border-border bg-surface px-4 py-3 text-center text-lg tracking-[0.5em] placeholder:tracking-normal placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-card bg-accent px-4 py-3 text-lg font-medium text-text-primary active:opacity-80 disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setError(null)
              }}
              className="text-sm text-text-secondary active:opacity-70"
            >
              Use a different email
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
