-- FIFA Highlights analytics schema (Supabase / Postgres)
-- Run once in the Supabase SQL editor.

-- Playback analytics events
create table if not exists playback_events (
  id            bigint generated always as identity primary key,
  video_id      text not null,
  session_id    text not null,
  type          text not null check (type in ('play','pause','seek','complete','heartbeat')),
  position_seconds  double precision not null default 0,
  duration_seconds  double precision,
  ts            timestamptz not null default now()
);
create index if not exists playback_events_video_idx   on playback_events (video_id);
create index if not exists playback_events_session_idx on playback_events (session_id);

-- Analysis jobs: this table IS the queue AND the result store.
create table if not exists analysis_jobs (
  id          uuid primary key default gen_random_uuid(),
  video_id    text not null,
  pipeline    text not null,
  config      jsonb not null default '{}'::jsonb,
  status      text not null default 'queued' check (status in ('queued','running','done','error')),
  error       text,
  result      jsonb,
  confidence  double precision,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists analysis_jobs_video_idx on analysis_jobs (video_id);
create index if not exists analysis_jobs_queue_idx on analysis_jobs (status, created_at);

-- Editable player tags (the "skipped feature"): rename auto-detected tracks per video.
create table if not exists player_tags (
  video_id    text not null,
  track_id    integer not null,
  name        text,
  team        integer,
  updated_at  timestamptz not null default now(),
  primary key (video_id, track_id)
);

-- RLS on, no policies: anon is fully blocked; the backend uses the service-role key which bypasses RLS.
alter table playback_events enable row level security;
alter table analysis_jobs   enable row level security;
alter table player_tags     enable row level security;
