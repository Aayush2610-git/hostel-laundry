import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendOfferEmail } from './brevo.ts'
import { formatIST } from './formatIST.ts'

// The "email whoever currently holds the active offer for this slot, if
// any" half of advancing the queue — split out so a caller that already
// created the offer itself (decline_offer, inside its own transaction —
// see schema.sql section 13) can send the notification without asking
// create_next_offer to run a second time.
export async function notifyActiveOfferHolder(admin: SupabaseClient, slotStart: string): Promise<void> {
  const { data: offer, error: selectError } = await admin
    .from('slot_offers')
    .select('user_id, expires_at')
    .eq('slot_start', slotStart)
    .is('outcome', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (selectError) {
    console.error(`Reading offer for ${slotStart} failed:`, selectError.message)
    return
  }
  if (!offer) return // no watchers, or the slot starts too soon — open to everyone, silently

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', offer.user_id)
    .single()

  if (profileError || !profile) {
    console.error(`No profile for offer holder ${offer.user_id}:`, profileError?.message)
    return
  }

  const slotTime = formatIST(slotStart)
  const deadline = formatIST(offer.expires_at)
  const appUrl = Deno.env.get('SITE_URL') ?? ''

  await sendOfferEmail(
    { email: profile.email, name: profile.full_name },
    `The ${slotTime} slot is yours if you want it`,
    `<p>The ${slotTime} slot is yours if you want it — you have 10 minutes.</p>` +
      `<p>Claim it by <strong>${deadline} IST</strong>.</p>` +
      (appUrl ? `<p><a href="${appUrl}">Open the app</a></p>` : ''),
  )
}

// Used by advance-expired-offers (cron) only — that's the one remaining
// caller where nothing in the DB creates the next offer on its own.
// notify-slot-freed and notify-offer-holder don't use this: their offer
// already exists by the time they run (created synchronously — see
// advance_queue_after_release, schema.sql section 14, and decline_offer,
// section 13), so they call notifyActiveOfferHolder directly. The
// 45-minute-out skip and the don't-skip-people-at-cap rule both live
// inside create_next_offer() in Postgres, not here — one source of truth
// for those rules, same as daily_booking_limit().
export async function advanceQueueAndNotify(admin: SupabaseClient, slotStart: string): Promise<void> {
  const { error: rpcError } = await admin.rpc('create_next_offer', { target_slot_start: slotStart })
  if (rpcError) {
    // Most likely: another invocation (cron fired twice, or this ran
    // concurrently with something else) already created the offer for this
    // slot, and the partial unique index rejected our insert. That other
    // invocation will send the email. Anything else just gets logged —
    // one slot failing to advance shouldn't take down the rest of a batch.
    console.error(`create_next_offer(${slotStart}) failed:`, rpcError.message)
    return
  }

  await notifyActiveOfferHolder(admin, slotStart)
}
