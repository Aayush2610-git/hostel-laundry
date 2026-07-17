// Cron, every minute. Offer validity was never defined by this function —
// enforce_offer_hold and claim_offer both derive it from expires_at > now()
// (see supabase/schema.sql section 11). All this does is the bookkeeping
// cron is actually for: flip stale offers to 'expired' so the partial
// unique index frees up, then hand the slot to the next watcher. A late,
// dead, or doubled-up run of this doesn't break anything — see the
// try/catch-and-continue in advanceQueueAndNotify.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { advanceQueueAndNotify } from '../_shared/advanceQueue.ts'

Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: expired, error } = await admin
    .from('slot_offers')
    .select('id, slot_start')
    .is('outcome', null)
    .lte('expires_at', new Date().toISOString())

  if (error) {
    console.error('Reading expired offers failed:', error.message)
    return new Response('error', { status: 500 })
  }

  for (const offer of expired ?? []) {
    // Mark expired BEFORE creating the next offer: the partial unique index
    // (slot_offers_one_active) only allows a new offer once the old row's
    // outcome is non-null, so this order is load-bearing, not cosmetic.
    const { error: updateError } = await admin
      .from('slot_offers')
      .update({ outcome: 'expired' })
      .eq('id', offer.id)
      .is('outcome', null)

    if (updateError) {
      console.error(`Marking offer ${offer.id} expired failed:`, updateError.message)
      continue
    }

    await advanceQueueAndNotify(admin, offer.slot_start)
  }

  return new Response(`processed ${expired?.length ?? 0} expired offer(s)`, { status: 200 })
})
