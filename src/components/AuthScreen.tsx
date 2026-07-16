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
      // CLAUDE.md rule 5: the resident-allowlist check lives in a Postgres
      // trigger, and its raise-exception message is meant to be read by
      // humans — show it exactly as-is, no rewording.
      setError(error.message)
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
    <div className="flex min-h-svh items-center justify-center bg-neutral-950 px-6 text-neutral-100">
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
              className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-lg placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-neutral-100 px-4 py-3 text-lg font-medium text-neutral-950 active:bg-neutral-300 disabled:opacity-50"
            >
              {loading ? 'Sending code…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
            <p className="text-center text-sm text-neutral-400">
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
              className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-center text-lg tracking-[0.5em] placeholder:tracking-normal placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-neutral-100 px-4 py-3 text-lg font-medium text-neutral-950 active:bg-neutral-300 disabled:opacity-50"
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
              className="text-sm text-neutral-500 active:text-neutral-300"
            >
              Use a different email
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
