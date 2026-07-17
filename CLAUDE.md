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
   The Friday pill shows Fri 7:00 AM through the last slot's occupancy
   ending Sat 3:00 AM (that last slot displays as "12:30 – 1:00 AM" but
   still reserves the machine until 3:00 AM — see rule 3).

3. **Fixed slot grid: eight 2.5h slots, back-to-back, 07:00 → 03:00 IST.**
   Start times (IST): 7:00, 9:30, 12:00, 14:30, 17:00, 19:30, 22:00, 00:30.
   20 hours / 2.5h = exactly 8 slots, no gaps, no overlap. The UI shows only
   a 30-min window per slot (e.g. "9:30 – 10:00 AM"), not the full 2.5h
   occupancy — the booking still reserves the whole 2.5h block server-side,
   the range is just noise for what's really a "show up by this window"
   instruction. Never allow arbitrary start times.

4. **Double-booking is prevented by a UNIQUE constraint on `bookings.slot_start`.**
   NEVER check-then-insert — that's a race condition. Always insert, handle failure.
   Postgres error code **23505** = someone beat you to it. Revert the optimistic
   UI and toast "Just taken by someone else." This is first-come-first-serve,
   arbitrated by the database, not by application logic.

5. **Business rules live in Postgres triggers, not React.** Their `raise exception`
   messages are human-readable — surface them to the user raw. **Exception:**
   the resident-allowlist trigger on `auth.users` (`handle_new_user`). The
   message reaches the HTTP response fine (a 500 with a clean JSON body), but
   supabase-js mangles it into an unreadable `error.message` ("{}") when
   parsing a 500-status auth error — unlike PostgREST's clean passthrough for
   table operations, which is what the rest of this rule relies on. So
   `AuthScreen`'s email step shows a fixed "contact your hostel admin"
   message instead, with the real error only going to `console.error`.

6. **The service_role key NEVER touches frontend code.** Edge Function secrets only.
   The anon key is public by design; RLS is the actual security boundary.

7. **No modals. Booking is one tap, no confirmation.** Booking must take under
   2 seconds. Release is the exception: it's irreversible (the slot goes
   straight back to FREE for anyone to take), so it gets an inline confirm
   ("Release your 7:00 PM slot?" / Release / Cancel) — never a modal, just the
   row itself changing in place. This still means one-tap booking happens on
   the grid row itself, though — NextFreeSlotBar's shortcut jumps to and
   highlights the slot rather than booking it directly, because a fixed
   bottom-of-screen "Book" button turned out to get mis-tapped by accident.

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