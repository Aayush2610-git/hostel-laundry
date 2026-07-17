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

-- 5. Slot grid: 07,09,11,13,15,17,19,21,23,01 IST -------------
alter table bookings add constraint slot_aligned check (
  extract(minute from slot_start at time zone 'Asia/Kolkata') = 0
  and extract(second from slot_start at time zone 'Asia/Kolkata') = 0
  and extract(hour from slot_start at time zone 'Asia/Kolkata')::int
      in (7,9,11,13,15,17,19,21,23,1)
);

-- 6. Business rules (server-side; messages are user-facing) ----
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
   where user_id = new.user_id and slot_start > now();
  if cnt >= 2 then
    raise exception 'Limit reached: max 2 upcoming bookings';
  end if;
  return new;
end $$;

create trigger booking_limits before insert on bookings
for each row execute function public.enforce_booking_limits();

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