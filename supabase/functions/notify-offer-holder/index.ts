// Called directly by the frontend right after decline_offer() succeeds
// (schema.sql section 13) — that SQL function already created the next
// offer inside its own transaction, so this just sends the "your turn"
// email for whatever offer now exists on the slot. A best-effort nudge:
// the app's realtime subscription is what actually informs the next
// watcher (they'll see the offer card the moment they open the app) —
// this just saves them checking.
//
// The only one of the three functions actually called from a browser
// (OfferCard.tsx, via supabase.functions.invoke) rather than server-side
// (a Database Webhook, or cron) — so it's the only one that needs to
// answer a CORS preflight. Without corsHeaders here, the browser's OPTIONS
// preflight gets no Access-Control-Allow-* headers back and the real POST
// never goes out at all.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { notifyActiveOfferHolder } from '../_shared/advanceQueue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const payload = await req.json()
  const slotStart = payload?.slot_start
  if (!slotStart) return new Response('slot_start required', { status: 400, headers: corsHeaders })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  await notifyActiveOfferHolder(admin, slotStart)
  return new Response('ok', { status: 200, headers: corsHeaders })
})
