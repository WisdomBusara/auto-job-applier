-- ============================================================
-- AutoApply AI — Supabase Schema
-- Run this once in your Supabase project:
--   Dashboard → SQL Editor → paste and run
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── Users ───────────────────────────────────────────────────
create table if not exists users (
  id           text primary key default gen_random_uuid()::text,
  email        text unique not null,
  profile      jsonb not null default '{}',
  cv_filename  text,
  cv_text      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── Jobs ────────────────────────────────────────────────────
create table if not exists jobs (
  id                   text primary key default gen_random_uuid()::text,
  platform             text not null,
  external_id          text not null,
  title                text not null,
  company              text not null,
  location             text not null default '',
  description          text not null default '',
  url                  text not null,
  salary               text,
  remote               boolean not null default false,
  seniority            text,
  employment_type      text,
  posted_at            timestamptz,
  status               text not null default 'pending',
  match_score          real,
  match_justification  jsonb not null default '[]',
  risks_gaps           text,
  ai_recommendation    text,
  prediction           text,
  confidence           real,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (platform, external_id)
);

-- ─── Applications ─────────────────────────────────────────────
create table if not exists applications (
  id             text primary key default gen_random_uuid()::text,
  job_id         text not null references jobs(id) on delete cascade,
  user_id        text not null references users(id) on delete cascade,
  job_title      text not null,
  company        text not null,
  status         text not null default 'planned',
  match_score    real not null default 0,
  pack           jsonb,
  prediction     text,
  confidence     real,
  applied_at     timestamptz,
  error_message  text,
  created_at     timestamptz not null default now()
);

-- ─── Logs ─────────────────────────────────────────────────────
create table if not exists logs (
  id          text primary key default gen_random_uuid()::text,
  level       text not null default 'info',
  message     text not null,
  context     jsonb,
  job_id      text,
  created_at  timestamptz not null default now()
);

-- ─── Integrations ─────────────────────────────────────────────
create table if not exists integrations (
  id          text primary key default gen_random_uuid()::text,
  platform    text unique not null,
  enabled     boolean not null default false,
  config      jsonb not null default '{}',
  last_used   timestamptz,
  created_at  timestamptz not null default now()
);

-- Seed default integrations
insert into integrations (platform, enabled) values
  ('linkedin',   false),
  ('indeed',     false),
  ('greenhouse', true)
on conflict (platform) do nothing;

-- ─── Row Level Security ───────────────────────────────────────
-- Service key bypasses RLS, so these are just safety defaults.
alter table users         enable row level security;
alter table jobs          enable row level security;
alter table applications  enable row level security;
alter table logs          enable row level security;
alter table integrations  enable row level security;

-- Allow service role full access
create policy "service role all" on users        for all using (true);
create policy "service role all" on jobs         for all using (true);
create policy "service role all" on applications for all using (true);
create policy "service role all" on logs         for all using (true);
create policy "service role all" on integrations for all using (true);
