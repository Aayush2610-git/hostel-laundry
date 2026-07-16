# Hostel Laundry

Slot booking for one washing machine, ~50 residents. Mobile web.

## Stack
Vite + React + TypeScript + Tailwind. Supabase (auth, Postgres, realtime, edge fns).
Vercel hosting. No backend server — Supabase is the backend.

## The developer is a beginner
Explain what you're doing in plain English as you go. Prefer boring, obvious
code over clever code. Don't add libraries without saying why.

## Non-negotiable rules

1. **Timezone is Asia/Kolkata, always.** Store UTC (`timestamptz`), render IST.
   India has no DST; IST is fixed +5:30.

2. **A "laundry day" runs 07:00 IST → 03:00 IST the next morning.**
   NEVER filter by calendar date. Filter:
   `slot_start >= <day at 07:00 IST> AND slot_start < that + 20 hours`
   The Friday pill shows Fri 7:00 AM through Sat 1:00–3:00 AM.

3. **Fixed slot grid: 07, 09, 11, 13, 15, 17, 19, 21, 23, 01 IST.**
   10 slots/day, 2h each (1.5h cycle + 30 min to actually remove clothes).
   Never allow arbitrary start times.

4. **Double-booking is prevented by a UNIQUE constraint on `bookings.slot_start`.**
   NEVER check-then-insert — that's a race condition. Always insert, handle failure.
   Postgres error code **23505** = someone beat you to it. Revert the optimistic
   UI and toast "Just taken by someone else." This is first-come-first-serve,
   arbitrated by the database, not by application logic.

5. **Business rules live in Postgres triggers, not React.** Their `raise exception`
   messages are human-readable — surface them to the user raw.

6. **The service_role key NEVER touches frontend code.** Edge Function secrets only.
   The anon key is public by design; RLS is the actual security boundary.

7. **No modals. No confirmation dialogs.** One tap = one action. Booking must
   take under 2 seconds.

## Schema
The authoritative schema is in supabase/schema.sql. READ IT before writing
any query. It was applied via the Supabase dashboard, not migrations, so
that file is the only record. If you change the schema, update it in the
same commit.

## Auth
Email OTP (6-digit code) ONLY. NOT magic links — they break when the link opens
in a different browser than the one that requested it, which is constant on phones.
Signup is gated: a trigger on auth.users rejects any email not in `residents`.

## UI states
Every slot is exactly one of:
FREE (tap to book) · YOURS (tap to release) · TAKEN (name + room + bell to watch)
· PAST (grey, inert)

## Conventions
- Tailwind only, no component library
- Dark theme, large touch targets, mobile-first
- No localStorage — the server is the source of truth