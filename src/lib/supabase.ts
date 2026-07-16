import { createClient } from '@supabase/supabase-js'

// These come from .env.local (VITE_-prefixed vars are the only ones Vite
// exposes to browser code — see https://vite.dev/guide/env-and-mode).
// The anon key is safe to ship to the browser: Postgres Row Level Security
// is what actually keeps data safe, not secrecy of this key.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
