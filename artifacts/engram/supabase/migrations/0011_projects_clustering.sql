-- ============================================================
-- 0011: Project Clustering
-- Projects table + project_id FK on context_snapshots
-- pgvector function for centroid similarity search
-- ============================================================

-- Projects: auto-clustered groups of related snapshots
create table if not exists public.projects (
  id             uuid primary key default uuid_generate_v4(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  name           text not null,
  description    text,
  centroid       vector(1536),
  snapshot_count int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_projects_team_id
  on public.projects(team_id);

-- FK from snapshots to projects
alter table public.context_snapshots
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_context_snapshots_project_id
  on public.context_snapshots(project_id)
  where project_id is not null;

-- RLS for projects
alter table public.projects enable row level security;

create policy "team members can view projects"
  on public.projects for select
  using (team_id = public.my_team_id());

create policy "team members can insert projects"
  on public.projects for insert
  with check (team_id = public.my_team_id());

create policy "team members can update projects"
  on public.projects for update
  using (team_id = public.my_team_id());

create policy "team members can delete projects"
  on public.projects for delete
  using (
    team_id = public.my_team_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role in ('owner', 'admin')
      and team_id = public.my_team_id()
    )
  );

-- Helper: find best-matching project centroid for a given embedding
-- Returns projects ordered by cosine similarity, filtered by threshold
create or replace function public.find_nearest_project(
  query_embedding  vector(1536),
  team_id_filter   uuid,
  match_threshold  float default 0.72,
  match_count      int   default 5
)
returns table (
  id          uuid,
  name        text,
  similarity  float,
  snapshot_count int
)
language sql stable as $$
  select
    p.id,
    p.name,
    1 - (p.centroid <=> query_embedding) as similarity,
    p.snapshot_count
  from public.projects p
  where
    p.team_id = team_id_filter
    and p.centroid is not null
    and 1 - (p.centroid <=> query_embedding) > match_threshold
  order by p.centroid <=> query_embedding
  limit match_count;
$$;
