-- Curio: initial schema.
-- Only the API's service role key touches these tables: RLS is on with no policies,
-- so the anon/public keys cannot read or write anything.

create extension if not exists pgcrypto;

create table profiles (
  id text primary key default 'me',
  interests text[] not null default '{}',
  disabled_actions text[] not null default '{}',
  language text not null default 'en',
  cooldown_sec integer not null default 600 check (cooldown_sec between 60 and 7200),
  max_auto_per_session integer not null default 6 check (max_auto_per_session between 0 and 50),
  control_rate real not null default 0 check (control_rate between 0 and 1),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  goal text,
  mode text not null check (mode in ('manual', 'occasional', 'silence')),
  arm text not null check (arm in ('suggestions', 'control')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  curiosity_before smallint check (curiosity_before between 1 and 5),
  curiosity_after smallint check (curiosity_after between 1 and 5),
  attention_before smallint check (attention_before between 1 and 5),
  attention_after smallint check (attention_after between 1 and 5),
  distractions smallint check (distractions >= 0),
  notes text
);

-- Only condensed context is stored, never the full page text.
create table contexts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  source_type text not null check (source_type in ('web', 'selection', 'pdf', 'video')),
  url text,
  title text,
  topic text not null,
  summary text not null,
  text_hash text not null,
  char_count integer not null,
  created_at timestamptz not null default now(),
  unique (session_id, text_hash)
);

-- Every decision is logged, including `none`, to evaluate the policy later.
create table decisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  context_id uuid not null references contexts (id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'selection', 'checkpoint')),
  action text not null,
  eligible_actions text[] not null default '{}',
  probabilities jsonb not null default '{}',
  assessor text,
  assessor_confidence real,
  distraction_risk real,
  policy_version text not null,
  reason_code text not null,
  latency_ms integer not null,
  timings jsonb not null default '{}',
  usage jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index decisions_session_idx on decisions (session_id, created_at);

create table interventions (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references decisions (id) on delete cascade,
  session_id uuid not null references sessions (id) on delete cascade,
  context_id uuid not null references contexts (id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'selection', 'checkpoint')),
  action text not null,
  text text not null,
  anchor text,
  saved_at timestamptz,
  created_at timestamptz not null default now()
);
create index interventions_session_idx on interventions (session_id, created_at);
create index interventions_saved_idx on interventions (saved_at) where saved_at is not null;

create table feedback (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null unique references interventions (id) on delete cascade,
  value text not null check (value in ('helped', 'not_interesting', 'distracted', 'ignored')),
  created_at timestamptz not null default now()
);

create table explorations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  kind text not null check (kind in ('question', 'search')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table sessions enable row level security;
alter table contexts enable row level security;
alter table decisions enable row level security;
alter table interventions enable row level security;
alter table feedback enable row level security;
alter table explorations enable row level security;

insert into profiles (id) values ('me') on conflict do nothing;
