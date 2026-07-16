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