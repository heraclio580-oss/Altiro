-- Altiro database schema (Supabase / Postgres)
-- Mirrors the in-memory `state` object from the current prototype, plus the
-- new tables needed for real accounts and subscription gating.
--
-- Apply with: supabase db push   (or paste into the SQL editor in the Supabase dashboard)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user (auth.users is managed by Supabase Auth)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  goal text,                         -- 'cardio' | 'strength' | 'mix'
  level text,                        -- 'beginner' | 'intermediate' | 'advanced'
  age_bracket text,                  -- 'u35' | '35_44' | '45_54' | '55p'
  gender text,
  weight numeric,
  weight_unit text default 'lb',
  training_days int[] default '{0,2,4}',   -- 0=Mon .. 6=Sun
  focus_ratio int default 2,         -- 0..4, matches FOCUS_LABELS index
  intensity_idx int default 1,       -- 0=light,1=moderate,2=high
  streak int default 0,
  best_streak int default 0,
  total_workouts int default 0,
  total_distance numeric default 0,
  lang text default 'en',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- workout_logs: one row per (user, calendar day) -- mirrors state.dayLog[dateKey]
-- ---------------------------------------------------------------------------
create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  completed_override boolean,        -- null = no manual override, true/false = explicit toggle
  created_at timestamptz default now(),
  unique (user_id, log_date)
);

-- manual_entries: free-text "+ Add a Workout" logs, children of a workout_log
create table if not exists manual_entries (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references workout_logs(id) on delete cascade,
  name text not null,
  type text,                         -- 'run' | 'strength' | 'hike' | 'other'
  volume text,
  notes text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- recorded_sessions: structured performance data from the real Record Workout
-- flow (the "Log Your Performance" sheet) -- this is what drives progression.
-- ---------------------------------------------------------------------------
create table if not exists recorded_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  session_type text not null,        -- 'run' | 'strength' | 'hike'
  session_title text not null,       -- e.g. "Upper Body Strength" -- stable progression key
  weight numeric,
  reps int,
  time_min numeric,
  feel text,                         -- 'easy' | 'ok' | 'hard'
  created_at timestamptz default now()
);

-- progression_targets: current suggested target per (user, session_title)
create table if not exists progression_targets (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_key text not null,         -- e.g. 'strength:Upper Body Strength'
  weight numeric,
  reps int,
  pace_min numeric,
  updated_at timestamptz default now(),
  primary key (user_id, session_key)
);

-- ---------------------------------------------------------------------------
-- subscriptions: synced from RevenueCat webhooks. This is the source of truth
-- for whether a user's account currently has paid access ("entitlement").
-- Client code should only ever READ this table -- writes come exclusively
-- from the webhook handler using the Supabase service-role key, so a user
-- can never grant themselves access by editing client state.
-- ---------------------------------------------------------------------------
create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revenuecat_app_user_id text,
  entitlement text,                  -- e.g. 'pro'
  status text,                       -- 'active' | 'trialing' | 'expired' | 'cancelled'
  product_id text,
  store text,                        -- 'app_store' | 'play_store' | 'stripe'
  expires_at timestamptz,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security: every table is scoped to auth.uid() = user_id.
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table workout_logs enable row level security;
alter table manual_entries enable row level security;
alter table recorded_sessions enable row level security;
alter table progression_targets enable row level security;
alter table subscriptions enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own workout logs" on workout_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own manual entries" on manual_entries
  for all using (
    auth.uid() = (select user_id from workout_logs where id = workout_log_id)
  ) with check (
    auth.uid() = (select user_id from workout_logs where id = workout_log_id)
  );

create policy "own recorded sessions" on recorded_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own progression targets" on progression_targets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Subscriptions: users may READ their own row, but only the service role
-- (used by the RevenueCat webhook handler) can write. No insert/update/delete
-- policy is defined for the `authenticated` role, so those are denied by
-- default; the service role bypasses RLS entirely.
create policy "read own subscription" on subscriptions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth user signs up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
