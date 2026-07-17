// Fires on a Database Webhook: bookings DELETE. Offer creation itself is
// now handled synchronously, in the same transaction as the delete, by the
// advance_queue_after_release trigger (schema.sql section 14) — that's
// what actually closes the "release then immediately rebook it yourself"
// race, since a webhook round trip can't be relied on to finish before
// someone else's next request. By the time this function runs, the offer
// (if any) already exists; this only sends the email for it.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { notifyActiveOfferHolder } from '../_shared/advanceQueue.ts'

Deno.serve(async (req) => {
  const payload = await req.json()
  const slotStart = payload?.old_record?.slot_start
  if (!slotStart) return new Response('no slot_start on old_record', { status: 200 })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  await notifyActiveOfferHolder(admin, slotStart)
  return new Response('ok', { status: 200 })
})
