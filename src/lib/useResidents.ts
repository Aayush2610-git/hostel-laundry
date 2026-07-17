import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Resident = { email: string; full_name: string; room_no: string }

// No realtime here — residents management is a single-admin, occasional
// task, not something that needs to react live to another tab's edits.
// Callers refetch() after their own mutations instead.
export function useResidents() {
  const [residents, setResidents] = useState<Resident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refetch() {
    const { data, error: fetchError } = await supabase
      .from('residents')
      .select('email, full_name, room_no')
      .order('room_no')
    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError(null)
      setResidents(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    refetch()
  }, [])

  return { residents, loading, error, refetch }
}
