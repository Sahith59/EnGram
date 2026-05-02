-- ============================================================
-- ENGRAM — Git for AI Decisions
-- Full Supabase Schema
-- Run this in the Supabase SQL Editor for your project
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "vector";

-- ============================================================
-- TABLES
-- ============================================================

-- Teams
create table if not exists public.teams (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  team_id     uuid references public.teams(id) on delete set null,
  email       text not null,
  full_name   text,
  avatar_url  text,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Context Snapshots (captured AI conversations)
create table if not exists public.context_snapshots (
  id                  uuid primary key default uuid_generate_v4(),
  team_id             uuid not null references public.teams(id) on delete cascade,
  created_by          uuid not null references public.profiles(id) on delete set null,
  title               text not null,
  summary             text,
  ai_tool             text not null check (ai_tool in ('chatgpt', 'claude', 'gemini', 'other')),
  raw_conversation    jsonb not null default '[]',
  tags                text[] not null default '{}',
  project             text,
  decision            text,
  rationale           text,
  embedding           vector(1536),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- KT Queries (knowledge transfer natural-language queries)
create table if not exists public.kt_queries (
  id                  uuid primary key default uuid_generate_v4(),
  team_id             uuid not null references public.teams(id) on delete cascade,
  asked_by            uuid not null references public.profiles(id) on delete set null,
  question            text not null,
  answer              text,
  source_snapshot_ids uuid[] not null default '{}',
  confidence          numeric(4,3) check (confidence >= 0 and confidence <= 1),
  created_at          timestamptz not null default now()
);

-- Integrations (Slack, GitHub, Jira, Linear, etc.)
create table if not exists public.integrations (
  id          uuid primary key default uuid_generate_v4(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  type        text not null check (type in ('slack', 'github', 'jira', 'linear', 'other')),
  config      jsonb not null default '{}',
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, type)
);

-- Extension Events (raw payloads from browser extensions)
create table if not exists public.extension_events (
  id          uuid primary key default uuid_generate_v4(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete set null,
  ai_tool     text not null check (ai_tool in ('chatgpt', 'claude', 'gemini', 'other')),
  raw_payload jsonb not null default '{}',
  processed   boolean not null default false,
  snapshot_id uuid references public.context_snapshots(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_profiles_team_id
  on public.profiles(team_id);

create index if not exists idx_context_snapshots_team_id
  on public.context_snapshots(team_id);

create index if not exists idx_context_snapshots_created_by
  on public.context_snapshots(created_by);

create index if not exists idx_context_snapshots_ai_tool
  on public.context_snapshots(ai_tool);

create index if not exists idx_context_snapshots_tags
  on public.context_snapshots using gin(tags);

create index if not exists idx_context_snapshots_project
  on public.context_snapshots(project) where project is not null;

create index if not exists idx_context_snapshots_created_at
  on public.context_snapshots(created_at desc);

-- Vector similarity search index (IVFFlat for fast approximate search)
-- Requires at least ~1000 rows for best performance
create index if not exists idx_context_snapshots_embedding
  on public.context_snapshots using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists idx_kt_queries_team_id
  on public.kt_queries(team_id);

create index if not exists idx_kt_queries_asked_by
  on public.kt_queries(asked_by);

create index if not exists idx_extension_events_team_id
  on public.extension_events(team_id);

create index if not exists idx_extension_events_processed
  on public.extension_events(processed) where not processed;

create index if not exists idx_integrations_team_id
  on public.integrations(team_id);

-- ============================================================
-- TRIGGERS: updated_at auto-update
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger teams_updated_at
  before update on public.teams
  for each row execute procedure public.handle_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

create trigger context_snapshots_updated_at
  before update on public.context_snapshots
  for each row execute procedure public.handle_updated_at();

create trigger integrations_updated_at
  before update on public.integrations
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- TRIGGER: auto-create profile on sign-up
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.teams              enable row level security;
alter table public.profiles           enable row level security;
alter table public.context_snapshots  enable row level security;
alter table public.kt_queries         enable row level security;
alter table public.integrations       enable row level security;
alter table public.extension_events   enable row level security;

-- Helper: get current user's team_id
create or replace function public.my_team_id()
returns uuid as $$
  select team_id from public.profiles where id = auth.uid() limit 1;
$$ language sql security definer stable;

-- Teams: members can read their own team
create policy "team members can view their team"
  on public.teams for select
  using (id = public.my_team_id());

create policy "team owners can update their team"
  on public.teams for update
  using (id = public.my_team_id())
  with check (id = public.my_team_id());

-- Profiles: users can read profiles in their team
create policy "team members can view profiles"
  on public.profiles for select
  using (team_id = public.my_team_id() or id = auth.uid());

create policy "users can update their own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Context Snapshots: team-scoped read/write
create policy "team members can view snapshots"
  on public.context_snapshots for select
  using (team_id = public.my_team_id());

create policy "team members can insert snapshots"
  on public.context_snapshots for insert
  with check (team_id = public.my_team_id() and created_by = auth.uid());

create policy "snapshot owners can update"
  on public.context_snapshots for update
  using (created_by = auth.uid());

create policy "snapshot owners can delete"
  on public.context_snapshots for delete
  using (created_by = auth.uid());

-- KT Queries: team-scoped read/write
create policy "team members can view kt queries"
  on public.kt_queries for select
  using (team_id = public.my_team_id());

create policy "team members can insert kt queries"
  on public.kt_queries for insert
  with check (team_id = public.my_team_id() and asked_by = auth.uid());

-- Integrations: team-scoped
create policy "team members can view integrations"
  on public.integrations for select
  using (team_id = public.my_team_id());

create policy "team admins can manage integrations"
  on public.integrations for all
  using (
    team_id = public.my_team_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role in ('owner', 'admin')
    )
  );

-- Extension Events: personal read, insert
create policy "users can view their own extension events"
  on public.extension_events for select
  using (user_id = auth.uid());

create policy "users can insert their own extension events"
  on public.extension_events for insert
  with check (user_id = auth.uid() and team_id = public.my_team_id());

-- ============================================================
-- VECTOR SEARCH HELPER FUNCTION
-- ============================================================

create or replace function public.search_snapshots(
  query_embedding vector(1536),
  team_id_filter  uuid,
  match_count      int default 10,
  match_threshold  float default 0.7
)
returns table (
  id          uuid,
  title       text,
  summary     text,
  ai_tool     text,
  tags        text[],
  project     text,
  decision    text,
  rationale   text,
  similarity  float
)
language sql stable as $$
  select
    cs.id,
    cs.title,
    cs.summary,
    cs.ai_tool,
    cs.tags,
    cs.project,
    cs.decision,
    cs.rationale,
    1 - (cs.embedding <=> query_embedding) as similarity
  from public.context_snapshots cs
  where
    cs.team_id = team_id_filter
    and cs.embedding is not null
    and 1 - (cs.embedding <=> query_embedding) > match_threshold
  order by cs.embedding <=> query_embedding
  limit match_count;
$$;
