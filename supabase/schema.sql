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
alter table profiles add column if not exists last_counted_date date; -- last day counted toward streak/total_workouts, guards startWorkout() against double-counting a day recorded more than once
alter table profiles add column if not exists weekly_miles numeric;  -- about how many miles a week they run now -- where the plan's mileage starts
alter table profiles add column if not exists equipment text;        -- 'gym' | 'dumbbells' | 'bodyweight' -- what the plan's lifts can use
alter table profiles add column if not exists plan_start date;       -- Monday of the plan's week 0 (mileage builds week by week from here)
alter table profiles add column if not exists exercise_swaps jsonb;   -- "every workout" exercise changes: {exerciseKey: replacementKey | 'skip'}
alter table profiles add column if not exists strength_focus text;   -- the lift each week's peak lifting day builds (allround | bench | squat | deadlift | press | arms)
alter table profiles add column if not exists jog_baseline jsonb;   -- a new runner's latest longest steady jog {min, week, held}
alter table profiles add column if not exists mile_time_sec int;   -- a recent mile time (seconds) the run paces are based on

-- ---------------------------------------------------------------------------
-- workout_logs: one row per (user, calendar day) -- mirrors state.dayLog[dateKey]
-- ---------------------------------------------------------------------------
create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  completed_override boolean,        -- null = no manual override, true/false = explicit toggle
  planned_type text,                 -- set when the user has planned their own workout for this day
  planned_title text,                -- (today or any future date) -- overrides the auto-generated plan
  planned_detail text,
  planned_interval_rounds int,       -- only set when planned_type = 'interval'
  planned_interval_work_sec int,
  planned_interval_rest_sec int,
  created_at timestamptz default now(),
  unique (user_id, log_date)
);
alter table workout_logs add column if not exists planned_type text;
alter table workout_logs add column if not exists planned_title text;
alter table workout_logs add column if not exists planned_detail text;
alter table workout_logs add column if not exists planned_interval_rounds int;
alter table workout_logs add column if not exists planned_interval_work_sec int;
alter table workout_logs add column if not exists planned_interval_rest_sec int;
alter table workout_logs add column if not exists actual_run_distance numeric; -- what was actually run, from Log Performance -- distinct from the plan's prescribed distance
alter table workout_logs add column if not exists performance jsonb; -- what was logged for the day's own planned workout in Log Performance (sets/weights, distance/time, notes), shown again when it's reopened
alter table workout_logs add column if not exists planned_exercises jsonb; -- the day's own workout's exercise list, when the user built or changed it

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
alter table manual_entries add column if not exists distance numeric; -- cardio entries: structured distance (mi), alongside the derived `volume` display string
alter table manual_entries add column if not exists duration_min numeric; -- cardio entries: structured duration (min)
alter table manual_entries add column if not exists performance jsonb; -- same as workout_logs.performance, for a logged entry opened in Log Performance

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
  feel text,                         -- 'easy' | 'ok' | 'hard' -- derived from `rating` below
  rating int,                        -- 1-5, given on the post-workout review (Summary screen)
  review_notes text,                 -- optional free-text note from that same review
  exercises jsonb,                   -- structured strength sessions: [{key, name, weight, reps}, ...]
  created_at timestamptz default now()
);
alter table recorded_sessions add column if not exists rating int;
alter table recorded_sessions add column if not exists review_notes text;
alter table recorded_sessions add column if not exists exercises jsonb;
alter table recorded_sessions add column if not exists distance numeric; -- run sessions: the actual distance covered

-- planned_workouts: any ADDITIONAL workout added to a day beyond the primary plan slot (which still
-- lives on workout_logs.planned_* as above) -- a day can hold several of these, each independently
-- completable/deletable, since workout_logs is one row per (user, day) and can't hold more than one
-- plan itself.
create table if not exists planned_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  session_type text not null,        -- 'run' | 'strength' | 'interval'
  title text not null,
  detail text,
  exercises jsonb,                   -- structured strength sets/reps list, same shape as a planned session's
  interval_rounds int,
  interval_work_sec int,
  interval_rest_sec int,
  completed boolean default false,
  created_at timestamptz default now()
);
alter table planned_workouts add column if not exists actual_distance numeric; -- run extras: the actual distance covered, same idea as workout_logs.actual_run_distance
alter table planned_workouts add column if not exists performance jsonb; -- same as workout_logs.performance, for an additional workout
alter table planned_workouts enable row level security;
drop policy if exists "own planned workouts" on planned_workouts;
create policy "own planned workouts" on planned_workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- progression_targets: current suggested target per (user, session_title). Also doubles as the
-- per-exercise progression store for structured strength sessions -- an exercise's target is saved
-- with session_key = 'strength:<exercise name>' (see exerciseProgressionKey in the app), the exact
-- same key shape a matching Personal Record writes into, so the two share one progression trail.
create table if not exists progression_targets (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_key text not null,         -- e.g. 'strength:Upper Body Strength'
  weight numeric,
  reps int,
  pace_min numeric,
  updated_at timestamptz default now(),
  primary key (user_id, session_key)
);

-- personal_records: user-entered lift PRs -- a self-reported baseline, kept as a full history
-- (not overwritten in place) so progress on a given lift can be seen over time. The app also uses
-- these to seed a starting progression target for an exercise it has no real session data for yet.
create table if not exists personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise text not null,
  value numeric not null,
  unit text default 'lb',
  created_at timestamptz default now()
);
alter table personal_records enable row level security;
drop policy if exists "own personal records" on personal_records;
create policy "own personal records" on personal_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Strava: runs recorded on a watch (Garmin -> Strava) imported automatically.
-- strava_connections holds each user's Strava tokens. RLS is on with NO policies, so the browser can
-- never read them -- only the `strava` Edge Function (service role) can.
-- strava_activities holds runs that function pulled from Strava; the app files each one onto its day
-- and stamps applied_at so it's never imported twice. The browser may read/stamp its own rows only.
-- ---------------------------------------------------------------------------
create table if not exists strava_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint,
  athlete_name text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  last_synced_at timestamptz,
  created_at timestamptz default now()
);
alter table strava_connections enable row level security;

create table if not exists strava_activities (
  id bigint primary key,             -- Strava's own activity id
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  sport_type text,                   -- 'Run' | 'TrailRun' | 'VirtualRun'
  start_date timestamptz,
  local_date date not null,          -- the calendar day it was run on, in the runner's own time zone
  distance_m numeric,
  moving_time_s int,
  elapsed_time_s int,
  applied_at timestamptz,            -- set by the app once the run has been filed onto its day
  created_at timestamptz default now()
);
alter table strava_activities enable row level security;
drop policy if exists "read own strava activities" on strava_activities;
create policy "read own strava activities" on strava_activities
  for select using (auth.uid() = user_id);
drop policy if exists "mark own strava activities applied" on strava_activities;
create policy "mark own strava activities applied" on strava_activities
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- feedback: messages users send from Settings -> Send us feedback. Read them in the Supabase dashboard
-- (Table Editor -> feedback). A user can only send and see their own; `status` is for the team.
-- ---------------------------------------------------------------------------
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  category text not null,            -- 'plan' | 'bug' | 'idea' | 'other'
  plan_feel text,                    -- 'too_easy' | 'just_right' | 'too_hard' (optional)
  message text,
  context jsonb,                     -- the user's plan setup when they sent it (level, focus, days, miles, ...)
  status text default 'new',         -- for the team: 'new' | 'read' | 'done'
  created_at timestamptz default now()
);
alter table feedback enable row level security;
alter table feedback add column if not exists alerted_at timestamptz; -- when the team was emailed about it (supabase/functions/feedback-alert); users can't set it
drop policy if exists "send own feedback" on feedback;
create policy "send own feedback" on feedback
  for insert with check (auth.uid() = user_id);
drop policy if exists "read own feedback" on feedback;
create policy "read own feedback" on feedback
  for select using (auth.uid() = user_id);

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

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own workout logs" on workout_logs;
create policy "own workout logs" on workout_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own manual entries" on manual_entries;
create policy "own manual entries" on manual_entries
  for all using (
    auth.uid() = (select user_id from workout_logs where id = workout_log_id)
  ) with check (
    auth.uid() = (select user_id from workout_logs where id = workout_log_id)
  );

drop policy if exists "own recorded sessions" on recorded_sessions;
create policy "own recorded sessions" on recorded_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own progression targets" on progression_targets;
create policy "own progression targets" on progression_targets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Subscriptions: users may READ their own row, but only the service role
-- (used by the RevenueCat webhook handler) can write. No insert/update/delete
-- policy is defined for the `authenticated` role, so those are denied by
-- default; the service role bypasses RLS entirely.
drop policy if exists "read own subscription" on subscriptions;
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
