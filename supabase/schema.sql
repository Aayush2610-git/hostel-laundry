-- ============================================================
-- Hostel Laundry — authoritative schema
-- Applied via the Supabase dashboard SQL Editor, not migrations.
-- This file is the source of truth. Keep it in sync by hand.
-- ============================================================

-- 1. Residents allowlist + profiles ---------------------------
create table residents (
  email text primary key,
  full_name text not null,
  room_no text not null
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text not null,
  room_no text not null,
  created_at timestamptz default now()
);

-- 2. Signup gate: rejects emails not on the allowlist ---------
create or replace function public.handle_new_user()
returns trigger language plpgsql
security definer set search_path = public as $$
declare r residents%rowtype;
begin
  select * into r from residents where lower(email) = lower(new.email);
  if not found then
    raise exception 'This email is not on the resident list.';
  end if;
  insert into profiles (id, email, full_name, room_no)
  values (new.id, lower(new.email), r.full_name, r.room_no);
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 3. Laundry day: 07:00 IST -> 03:00 IST next morning ---------
create or replace function public.laundry_day(ts timestamptz)
returns date language sql immutable as $$
  select ((ts at time zone 'Asia/Kolkata') - interval '7 hours')::date;
$$;

-- 4. Bookings -------------------------------------------------
-- The UNIQUE on slot_start is the ENTIRE anti-double-booking
-- mechanism. Never check-then-insert. Insert and handle 23505.
create table bookings (
  id uuid primary key default gen_random_uuid(),
  slot_start timestamptz not null unique,
  user_id uuid not null references auth.users on delete cascade,
  started_at timestamptz,
  created_at timestamptz default now()
);
create index on bookings (slot_start);
create index on bookings (user_id);

-- 4b. FK to profiles so PostgREST can embed profiles(...) ------
-- Without this, `select *, profiles(full_name, room_no)` fails.
alter table bookings
  add constraint bookings_user_id_profiles_fkey
  foreign key (user_id) references profiles(id) on delete cascade;

-- 5. Slot grid: eight 2.5h slots, back-to-back, 07:00 -> 03:00 IST --------
-- (hour, minute) pairs in IST: 7:00, 9:30, 12:00, 14:30, 17:00, 19:30,
-- 22:00, 00:30. A row check (not a plain hour-in-list) because two
-- different minute values are now valid depending on which hour it is.
alter table bookings add constraint slot_aligned check (
  extract(second from slot_start at time zone 'Asia/Kolkata') = 0
  and (
    extract(hour from slot_start at time zone 'Asia/Kolkata')::int,
    extract(minute from slot_start at time zone 'Asia/Kolkata')::int
  ) in ((7,0),(9,30),(12,0),(14,30),(17,0),(19,30),(22,0),(0,30))
);

-- 6. Business rules (server-side; messages are user-facing) ----
-- daily_booking_limit() is the single source of truth for the per-day cap.
-- The trigger reads it below instead of hardcoding the number — see
-- CLAUDE.md rule "database is the source of truth", never hardcode this.
-- (Replaces the old booking_limit(), which capped total upcoming bookings
-- regardless of day; the rule is now "1 booking per laundry day", using
-- public.laundry_day() from section 3 to group by day, not calendar date.)
create or replace function public.daily_booking_limit()
returns int language sql immutable as $$
  select 1;
$$;

grant execute on function public.daily_booking_limit() to authenticated;

create or replace function public.enforce_booking_limits()
returns trigger language plpgsql as $$
declare cnt int;
begin
  if new.slot_start < now() then
    raise exception 'Cannot book a slot in the past';
  end if;
  if new.slot_start > now() + interval '4 days' then
    raise exception 'You can only book up to 4 days ahead';
  end if;
  select count(*) into cnt from bookings
   where user_id = new.user_id
     and slot_start > now()
     and public.laundry_day(slot_start) = public.laundry_day(new.slot_start);
  if cnt >= public.daily_booking_limit() then
    raise exception 'Only % booking per day — release your existing one on this day first', public.daily_booking_limit();
  end if;
  return new;
end $$;

create trigger booking_limits before insert on bookings
for each row execute function public.enforce_booking_limits();

drop function if exists public.booking_limit();

-- 7. Watchers -------------------------------------------------
create table slot_watchers (
  id uuid primary key default gen_random_uuid(),
  slot_start timestamptz not null,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz default now(),
  unique (slot_start, user_id)
);

-- 8. RLS ------------------------------------------------------
-- residents gets RLS with ZERO policies = invisible to clients.
alter table bookings      enable row level security;
alter table profiles      enable row level security;
alter table residents     enable row level security;
alter table slot_watchers enable row level security;

create policy "read all bookings" on bookings for select to authenticated using (true);
create policy "insert own booking" on bookings for insert to authenticated with check (auth.uid() = user_id);
create policy "update own booking" on bookings for update to authenticated using (auth.uid() = user_id);
create policy "delete own booking" on bookings for delete to authenticated using (auth.uid() = user_id);

create policy "read all profiles" on profiles for select to authenticated using (true);
create policy "update own profile" on profiles for update to authenticated using (auth.uid() = id);

create policy "own watchers" on slot_watchers for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 9. Realtime: pushes booking changes to connected clients -----
-- REPLICA IDENTITY FULL matters here: by default Postgres only includes
-- the primary key in a DELETE's old-row data, so a client-side realtime
-- filter like `user_id=eq.<uid>` (or reading payload.old.slot_start) can
-- never match on delete — the column it's filtering on isn't there. FULL
-- puts every column in old-row data so deletes are actually visible.
alter table bookings replica identity full;
alter publication supabase_realtime add table bookings;

-- 10. Ghost-slot reaper (Part 9) — NOT YET APPLIED -------------
-- create extension if not exists pg_cron;
-- create or replace function public.release_ghost_slots()
-- returns void language sql security definer as $$
--   delete from bookings
--    where started_at is null
--      and slot_start < now() - interval '15 minutes'
--      and slot_start > now() - interval '2 hours';
-- $$;
-- select cron.schedule('reap-ghosts', '*/5 * * * *', 'select public.release_ghost_slots()');

-- 11. Waitlist: offers -----------------------------------------
-- Database only in this step: no UI, no email, no cron wiring yet.
--
-- 11a. Offers. One row = one exclusive claim window for one watcher on
-- one slot. outcome is null while open; claimed/expired/declined once
-- resolved. Whether an offer is CURRENTLY blocking bookings is never read
-- off outcome alone — it's `outcome is null AND expires_at > now()`. A
-- later cron step will flip stale offers to 'expired', but until it runs,
-- expires_at > now() already makes them inert. Cron advances the queue;
-- it doesn't define correctness.
create table slot_offers (
  id uuid primary key default gen_random_uuid(),
  slot_start timestamptz not null,
  user_id uuid not null references auth.users on delete cascade,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  outcome text check (outcome in ('claimed', 'expired', 'declined'))
);
create index on slot_offers (user_id);

-- Only one *unresolved* offer per slot at a time — a structural guarantee
-- (can't create a second offer until the first is claimed/expired/
-- declined), separate from the expires_at > now() check that trigger and
-- claim code use to decide whether an offer still counts.
create unique index slot_offers_one_active on slot_offers (slot_start)
  where outcome is null;

alter table slot_offers enable row level security;
create policy "read all offers" on slot_offers for select to authenticated using (true);
-- No insert/update/delete policy for ordinary users: offers are only ever
-- written by create_next_offer() and resolve_offer_on_booking() (11d, 11c),
-- both security definer.

-- 11b. Block bookings on a slot someone else is holding.
create or replace function public.enforce_offer_hold()
returns trigger language plpgsql as $$
declare o slot_offers%rowtype;
begin
  select * into o from slot_offers
   where slot_start = new.slot_start
     and outcome is null
     and expires_at > now()
   limit 1;
  if found and o.user_id <> new.user_id then
    raise exception 'Held for someone on the waitlist until %.',
      to_char(o.expires_at at time zone 'Asia/Kolkata', 'FMHH12:MI AM');
  end if;
  return new;
end $$;

create trigger offer_hold before insert on bookings
for each row execute function public.enforce_offer_hold();

-- 11c. When a booking lands, resolve any offer/watcher it satisfies. Fires
-- on every booking insert, not just ones that went through claim_offer() —
-- if the offer-holder just books normally (no swap needed), this is what
-- marks their offer claimed and clears their watcher row. security definer
-- because an ordinary authenticated user has no update/delete grant on
-- slot_offers, same pattern as handle_new_user (section 2).
create or replace function public.resolve_offer_on_booking()
returns trigger language plpgsql
security definer set search_path = public as $$
begin
  update slot_offers
     set outcome = 'claimed'
   where slot_start = new.slot_start
     and user_id = new.user_id
     and outcome is null;

  delete from slot_watchers
   where slot_start = new.slot_start
     and user_id = new.user_id;

  return new;
end $$;

create trigger offer_claimed_on_booking after insert on bookings
for each row execute function public.resolve_offer_on_booking();

-- 11d. Advance the queue: create the next offer for a slot. Picks the
-- earliest watcher by created_at — no position column, so nothing needs
-- renumbering when someone leaves the queue. Being at the daily booking
-- cap does NOT disqualify a watcher — that's the normal state for someone
-- who took a fallback slot while waiting for their preferred one. The only
-- skip condition is the slot starting too soon for a 10-minute exclusive
-- hold to be worth it. Not granted to authenticated: this is system
-- machinery invoked by cron or an edge function via service_role, never
-- called directly from a resident's browser.
create or replace function public.create_next_offer(target_slot_start timestamptz)
returns void language plpgsql
security definer set search_path = public as $$
declare w slot_watchers%rowtype;
begin
  if target_slot_start < now() + interval '45 minutes' then
    return;
  end if;

  select * into w from slot_watchers
   where slot_start = target_slot_start
   order by created_at
   limit 1;

  if not found then
    return;
  end if;

  insert into slot_offers (slot_start, user_id, expires_at)
  values (target_slot_start, w.user_id, now() + interval '10 minutes');
end $$;

revoke execute on function public.create_next_offer(timestamptz) from public;
grant execute on function public.create_next_offer(timestamptz) to service_role;

-- 11e. Don't let someone watch a slot they already hold. bookings.slot_start
-- is globally unique, so "already booked" can only ever mean "booked by
-- this same user" — nobody else could hold it too.
create or replace function public.prevent_watching_own_booking()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from bookings
     where slot_start = new.slot_start
       and user_id = new.user_id
  ) then
    raise exception 'You already have this slot booked.';
  end if;
  return new;
end $$;

create trigger no_watching_own_booking before insert on slot_watchers
for each row execute function public.prevent_watching_own_booking();

-- 11f. Claim an offer, optionally swapping out an existing booking. Single
-- transaction: delete release_slot_start (if given) -> insert
-- target_slot_start -> trigger 11c marks the offer claimed and clears the
-- watcher row as a side effect of the insert. If anything raises, the
-- whole thing rolls back and the caller keeps whatever they had before.
--
-- Release-then-book (not book-then-release) is required because
-- enforce_booking_limits (section 6) would reject the insert while the
-- caller is still at their cap. Doing it in one transaction is what makes
-- that safe: the delete isn't visible to any other session until commit,
-- and the offer hold (11b) keeps anyone else from grabbing
-- target_slot_start in the meantime — no window where the machine looks
-- unclaimed.
create or replace function public.claim_offer(
  target_slot_start timestamptz,
  release_slot_start timestamptz default null
)
returns void language plpgsql
security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  if not exists (
    select 1 from slot_offers
     where slot_start = target_slot_start
       and user_id = caller
       and outcome is null
       and expires_at > now()
  ) then
    raise exception 'You do not have an active offer for this slot.';
  end if;

  if release_slot_start is not null then
    delete from bookings
     where slot_start = release_slot_start
       and user_id = caller
       and slot_start > now();
    if not found then
      raise exception 'That is not your booking to release.';
    end if;
  end if;

  insert into bookings (slot_start, user_id) values (target_slot_start, caller);
end $$;

grant execute on function public.claim_offer(timestamptz, timestamptz) to authenticated;

-- 12. Release cutoff: no cancel/reschedule within 10 min of start -----
-- Applies to any DELETE of a user's own booking — the manual "Release"
-- button, and the release_slot_start delete inside claim_offer() (a
-- reschedule is just a release-then-book, so it gets the same cutoff as a
-- plain release). Does NOT apply to the ghost reaper (section 10): that
-- runs as a background cron job with no request context, so auth.uid() is
-- null there — and its deletes are always for slots already well past
-- start anyway, which this cutoff isn't meant to police.
create or replace function public.enforce_release_cutoff()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and old.slot_start < now() + interval '10 minutes' then
    raise exception 'Too late to release — this slot starts in under 10 minutes.';
  end if;
  return old;
end $$;

create trigger release_cutoff before delete on bookings
for each row execute function public.enforce_release_cutoff();

-- 13. Waitlist UI support: decline + queue position ---------------
-- decline_offer(): the "No thanks" action. Marks the caller's own active
-- offer declined, drops their watcher row (declining means leaving the
-- queue, not staying on it), and cascades immediately via
-- create_next_offer() rather than waiting for cron to notice the expiry.
create or replace function public.decline_offer(target_slot_start timestamptz)
returns void language plpgsql
security definer set search_path = public as $$
declare caller uuid := auth.uid();
begin
  update slot_offers
     set outcome = 'declined'
   where slot_start = target_slot_start
     and user_id = caller
     and outcome is null
     and expires_at > now();

  if not found then
    raise exception 'You do not have an active offer for this slot.';
  end if;

  delete from slot_watchers
   where slot_start = target_slot_start
     and user_id = caller;

  perform public.create_next_offer(target_slot_start);
end $$;

grant execute on function public.decline_offer(timestamptz) to authenticated;

-- my_watched_slots(): position is 1-based, derived from slot_watchers.
-- created_at order (section 11d's reasoning — no position column, nothing
-- to renumber). slot_watchers' RLS only lets a user see their own rows,
-- which is right for everything except this: computing a position needs to
-- compare against everyone else's created_at for the same slot. security
-- definer steps around that just for the count, and only ever returns the
-- caller's own slot_start/position — never anyone else's identity.
create or replace function public.my_watched_slots()
returns table(slot_start timestamptz, "position" int)
language sql stable security definer set search_path = public as $$
  select mine.slot_start,
         (select count(*)::int + 1 from slot_watchers w
           where w.slot_start = mine.slot_start and w.created_at < mine.created_at) as "position"
  from slot_watchers mine
  where mine.user_id = auth.uid();
$$;

grant execute on function public.my_watched_slots() to authenticated;

-- Realtime for offers: the "held" banner and the offer card both need to
-- react the instant an offer appears or resolves, same reasoning as
-- bookings joining this publication in section 9. No REPLICA IDENTITY FULL
-- here — unlike bookings, slot_offers rows are never deleted, only
-- updated, and UPDATE/INSERT payloads carry full new-row data regardless
-- of replica identity.
--
-- Wrapped in a guard (unlike bookings' plain ALTER PUBLICATION in section
-- 9) because this whole file has turned out to get re-pasted into the SQL
-- editor more than once while iterating — and a bare ALTER PUBLICATION
-- ADD TABLE errors "already a member" on a second run, which (multi-
-- statement pastes run as one implicit transaction) rolls back everything
-- else in the same paste along with it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'slot_offers'
  ) then
    alter publication supabase_realtime add table slot_offers;
  end if;
end $$;

-- 14. Advance the queue synchronously on release ------------------
-- create_next_offer() was originally only invoked from the async
-- Database Webhook -> notify-slot-freed edge function path. That leaves a
-- real gap: between a booking's DELETE committing and that webhook round
-- trip completing, the slot is free with no offer yet, and the person who
-- just released it (or anyone) can book it again in that window — exactly
-- what enforce_offer_hold (section 11b) is supposed to prevent. This
-- trigger closes it by creating the offer in the SAME transaction as the
-- delete, so by the time anyone else can see the slot as free,
-- enforce_offer_hold is already in force if there's a watcher. The
-- webhook-driven edge function still exists, but now only sends the
-- email — it doesn't create the offer anymore (see notify-slot-freed).
--
-- Fires for every bookings delete uniformly, same as the release cutoff
-- (section 12): a manual release, the release_slot_start swap inside
-- claim_offer(), and eventually the ghost reaper — the last of those is
-- always for an already-started slot, which create_next_offer()'s own
-- 45-minutes-out check turns into a no-op, so it doesn't need excluding
-- here either.
create or replace function public.advance_queue_on_release()
returns trigger language plpgsql
security definer set search_path = public as $$
begin
  perform public.create_next_offer(old.slot_start);
  return old;
end $$;

-- drop-then-create rather than a bare CREATE TRIGGER: same re-paste
-- reasoning as the publication guard above — CREATE TRIGGER has no OR
-- REPLACE form, so a second run of this file errors "already exists" and
-- takes the rest of that paste down with it.
drop trigger if exists advance_queue_after_release on bookings;
create trigger advance_queue_after_release after delete on bookings
for each row execute function public.advance_queue_on_release();

-- 15. Admin: manage residents, is_admin flag ------------------
-- No self-service admin promotion UI — for a ~50-resident hostel, flipping
-- this by hand in the SQL editor for whoever needs it is simpler and safer
-- than building role-management UI for something that happens rarely.
alter table profiles add column if not exists is_admin boolean not null default false;

-- residents keeps RLS with zero policies for everyone except admins (see
-- section 8's "invisible to clients" comment) — these add exactly one
-- carve-out: an admin (checked via profiles.is_admin) can read and write
-- the allowlist. Non-admins are unaffected, still zero access.
create policy "admins manage residents" on residents for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin));

-- Admins can also update *other* residents' profiles (full_name, room_no)
-- — needed so editing a resident's room number in the admin UI can also
-- correct it for someone who already signed up, not just the residents
-- row. profiles already has an unconditional "read all profiles" select
-- policy, so the is_admin subquery below doesn't hit an RLS chicken-and-
-- egg problem reading itself.
create policy "admins update any profile" on profiles for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- FK so PostgREST can embed profiles(...) on slot_offers the same way
-- section 4b already does for bookings — slot_offers.user_id only
-- references auth.users, which isn't enough for PostgREST to auto-detect
-- the join to profiles for the admin slots overview.
alter table slot_offers
  add constraint slot_offers_user_id_profiles_fkey
  foreign key (user_id) references profiles(id) on delete cascade;

-- admin_slot_watchers(): the master slots view needs to show who's
-- waiting on each slot, but slot_watchers' RLS only exposes a user's own
-- rows (same problem my_watched_slots, section 13, worked around) — this
-- is the admin equivalent, one call for a whole day's worth of slots at
-- once instead of one call per slot. Silently returns nothing for a
-- non-admin caller rather than raising — this is a read path, not a
-- mutation, so a quiet empty result is enough; it's also never reachable
-- except from admin-gated UI.
create or replace function public.admin_slot_watchers(target_slot_starts timestamptz[])
returns table(slot_start timestamptz, user_id uuid, full_name text, room_no text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.slot_start, w.user_id, p.full_name, p.room_no, w.created_at
  from slot_watchers w
  join profiles p on p.id = w.user_id
  where w.slot_start = any(target_slot_starts)
    and exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin)
  order by w.slot_start, w.created_at;
$$;

grant execute on function public.admin_slot_watchers(timestamptz[]) to authenticated;