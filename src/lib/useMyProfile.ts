import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type Profile = { full_name: string; room_no: string; is_admin: boolean }

// Just for the header greeting — name + room instead of the resident's
// email — and is_admin, which gates the Admin button. Profiles don't
// change during a session, so no realtime needed.
export function useMyProfile(session: Session) {
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiles')
      .select('full_name, room_no, is_admin')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (!error) setProfile(data)
      })
    return () => {
      cancelled = true
    }
  }, [session.user.id])

  return profile
}
