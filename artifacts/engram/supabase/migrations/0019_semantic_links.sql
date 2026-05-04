-- ============================================================
-- 0019: Semantic Link Engine (Commit ↔ Conversation)
-- semantic_links: cross-references git commits with AI conversations
-- ============================================================

create table if not exists public.semantic_links (
  id               uuid primary key default uuid_generate_v4(),
  repo_id          uuid not null references public.github_repos(id) on delete cascade,
  commit_sha       text not null,
  snapshot_id      uuid not null references public.context_snapshots(id) on delete cascade,
  similarity       float not null,
  linked_files     text[] not null default '{}',
  commit_message   text,
  committed_at     timestamptz,
  linked_at        timestamptz not null default now(),
  is_manual        bool not null default false,

  -- Prevent duplicate auto-links; manual links are allowed to co-exist
  constraint semantic_links_commit_snapshot_unique unique (commit_sha, snapshot_id)
);

-- Index for "all links for a commit"
create index if not exists idx_semantic_links_repo_commit
  on public.semantic_links (repo_id, commit_sha);

-- Index for "all commits linked to a snapshot"
create index if not exists idx_semantic_links_snapshot
  on public.semantic_links (snapshot_id);

-- Index for recent-commit queries
create index if not exists idx_semantic_links_committed_at
  on public.semantic_links (repo_id, committed_at desc nulls last);

-- RLS
alter table public.semantic_links enable row level security;

create policy "team members can view semantic links"
  on public.semantic_links for select
  using (
    repo_id in (
      select id from public.github_repos where team_id = public.my_team_id()
    )
  );

create policy "team members can insert semantic links"
  on public.semantic_links for insert
  with check (
    repo_id in (
      select id from public.github_repos where team_id = public.my_team_id()
    )
  );

create policy "team members can delete semantic links"
  on public.semantic_links for delete
  using (
    repo_id in (
      select id from public.github_repos where team_id = public.my_team_id()
    )
  );

-- Vector search for context snapshots within a pre-commit time window.
-- window_end must equal the commit timestamp so only conversations captured
-- BEFORE the commit are returned (forward-only / causal linking).
create or replace function public.search_snapshots_near_commit(
  query_embedding  vector(1536),
  team_id_filter   uuid,
  project_id_filter uuid,
  window_start     timestamptz,
  window_end       timestamptz,
  match_count      int    default 10,
  match_threshold  float  default 0.40
)
returns table (
  id          uuid,
  title       text,
  summary     text,
  decision    text,
  created_at  timestamptz,
  similarity  float
)
language sql stable as $$
  select
    cs.id,
    cs.title,
    cs.summary,
    cs.decision,
    cs.created_at,
    1 - (cs.embedding <=> query_embedding) as similarity
  from public.context_snapshots cs
  where
    cs.team_id = team_id_filter
    and cs.project_id = project_id_filter
    and cs.embedding is not null
    and cs.created_at >= window_start
    and cs.created_at <= window_end
    and 1 - (cs.embedding <=> query_embedding) > match_threshold
  order by cs.embedding <=> query_embedding
  limit match_count;
$$;
