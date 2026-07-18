import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// Repeated diagonal watermark — "Chinnar Hostel" tiled across the whole
// background at low opacity. Pure text/CSS, no image asset: a rotated
// container sized bigger than the viewport (inset-[-20%]) so the rotation
// never leaves a gap at the corners, filled with repeated rows.
function HostelWatermark() {
  const rows = Array.from({ length: 16 })
  const line = Array.from({ length: 6 }).fill('CHINNAR HOSTEL').join('   ✦   ')
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      <div className="absolute inset-[-20%] flex -rotate-12 flex-col gap-8 opacity-[0.05]">
        {rows.map((_, i) => (
          <p key={i} className="whitespace-nowrap text-4xl font-black tracking-widest text-text-primary">
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}

// A handful of drifting bubbles for the "fun" factor — decorative only,
// aria-hidden, positioned so they don't overlap the form card.
function Bubbles() {
  const bubbles = [
    { top: '8%', left: '12%', size: 26, delay: '0s' },
    { top: '18%', left: '82%', size: 18, delay: '1.2s' },
    { top: '72%', left: '88%', size: 22, delay: '2.1s' },
    { top: '80%', left: '8%', size: 14, delay: '0.6s' },
    { top: '4%', left: '55%', size: 12, delay: '1.8s' },
  ]
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      {bubbles.map((b, i) => (
        <span
          key={i}
          className="bubble-float absolute rounded-full border border-white/25 bg-white/[0.04] shadow-[inset_2px_2px_5px_rgba(255,255,255,0.18)]"
          style={{ top: b.top, left: b.left, width: b.size, height: b.size, animationDelay: b.delay }}
        />
      ))}
    </div>
  )
}

// A rotating cast of laundry-themed one-liners — picked once per mount, not
// re-rolled on every render, so it doesn't flicker while someone's typing.
const TAGLINES = [
  'One machine. Fifty roommates. Zero excuses.',
  'Where the real hostel drama happens: the queue.',
  'Sign in before someone else eyes your slot.',
  'Spin cycle, not blame cycle.',
  'Fresh clothes, no fresh drama — book ahead.',
]

export function AuthScreen() {
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)])
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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6">
      <HostelWatermark />
      <Bubbles />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-4xl">🧼🫧</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-text-primary">Chinnar Hostel</h1>
          <p className="text-sm font-medium tracking-wide text-accent uppercase">Laundry Booking</p>
          <p className="mt-3 text-sm text-text-secondary">{tagline}</p>
        </div>

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
