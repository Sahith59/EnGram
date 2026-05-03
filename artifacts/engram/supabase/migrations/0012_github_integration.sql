-- ============================================================
-- 0012: GitHub Integration  (idempotent — safe to re-run)
-- github_repos + github_chunks tables with vector search
-- ============================================================

-- Tracked repositories
create table if not exists public.github_repos (
  id              uuid primary key default uuid_generate_v4(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,
  repo_full_name  text not null,
  repo_name       text not null,
  owner_login     text not null,
  default_branch  text not null default 'main',
  description     text,
  is_private      boolean not null default false,
  status          text not null default 'pending'
                    check (status in ('pending','indexing','indexed','error')),
  error_message   text,
  file_count      int not null default 0,
  chunk_count     int not null default 0,
  indexed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (team_id, repo_full_name)
);

create index if not exists idx_github_repos_team_id
  on public.github_repos(team_id);

-- Indexed file chunks + commit chunks with embeddings
create table if not exists public.github_chunks (
  id           uuid primary key default uuid_generate_v4(),
  repo_id      uuid not null references public.github_repos(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  file_path    text not null,
  language     text,
  chunk_index  int not null default 0,
  content      text not null,
  embedding    vector(1536),
  token_est    int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_github_chunks_repo_id
  on public.github_chunks(repo_id);

create index if not exists idx_github_chunks_team_id
  on public.github_chunks(team_id);

-- RLS for github_repos
alter table public.github_repos enable row level security;

drop policy if exists "team members can view github repos"   on public.github_repos;
drop policy if exists "team members can insert github repos" on public.github_repos;
drop policy if exists "team members can update github repos" on public.github_repos;
drop policy if exists "team members can delete github repos" on public.github_repos;

create policy "team members can view github repos"
  on public.github_repos for select
  using (team_id = public.my_team_id());

create policy "team members can insert github repos"
  on public.github_repos for insert
  with check (team_id = public.my_team_id());

create policy "team members can update github repos"
  on public.github_repos for update
  using (team_id = public.my_team_id());

create policy "team members can delete github repos"
  on public.github_repos for delete
  using (team_id = public.my_team_id());

-- RLS for github_chunks
alter table public.github_chunks enable row level security;

drop policy if exists "team members can view github chunks"   on public.github_chunks;
drop policy if exists "team members can insert github chunks" on public.github_chunks;
drop policy if exists "team members can delete github chunks" on public.github_chunks;

create policy "team members can view github chunks"
  on public.github_chunks for select
  using (team_id = public.my_team_id());

create policy "team members can insert github chunks"
  on public.github_chunks for insert
  with check (team_id = public.my_team_id());

create policy "team members can delete github chunks"
  on public.github_chunks for delete
  using (team_id = public.my_team_id());

-- Vector search function for GitHub chunks (files + commits)
create or replace function public.search_github_chunks(
  query_embedding  vector(1536),
  team_id_filter   uuid,
  repo_id_filter   uuid   default null,
  match_count      int    default 8,
  match_threshold  float  default 0.45
)
returns table (
  id          uuid,
  repo_id     uuid,
  file_path   text,
  language    text,
  content     text,
  similarity  float
)
language sql stable as $$
  select
    gc.id,
    gc.repo_id,
    gc.file_path,
    gc.language,
    gc.content,
    1 - (gc.embedding <=> query_embedding) as similarity
  from public.github_chunks gc
  where
    gc.team_id = team_id_filter
    and gc.embedding is not null
    and (repo_id_filter is null or gc.repo_id = repo_id_filter)
    and 1 - (gc.embedding <=> query_embedding) > match_threshold
  order by gc.embedding <=> query_embedding
  limit match_count;
$$;
