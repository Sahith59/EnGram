-- ============================================================
-- 0020: Blast Radius Engine
-- blast_radius_queries: audit log + cache for blast-radius analyses
-- traverse_ast_edges: recursive CTE for dependency graph BFS
-- ============================================================

create table if not exists public.blast_radius_queries (
  id                    uuid primary key default uuid_generate_v4(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  query_file            text not null,
  change_description    text not null,
  affected_files        jsonb not null default '[]',
  intent_snapshots      jsonb not null default '[]',
  risk_summary          text,
  risk_level            text check (risk_level in ('Low', 'Medium', 'High', 'Critical')),
  ast_edges_traversed   int not null default 0,
  semantic_links_found  int not null default 0,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now()
);

-- Index: recent analyses per project
create index if not exists idx_blast_radius_project_created
  on public.blast_radius_queries (project_id, created_at desc);

-- RLS
alter table public.blast_radius_queries enable row level security;

create policy "team members can view blast radius queries"
  on public.blast_radius_queries for select
  using (
    project_id in (
      select p.id from public.projects p
      join public.team_members tm on tm.team_id = p.team_id
      where tm.user_id = auth.uid()
    )
  );

create policy "team members can insert blast radius queries"
  on public.blast_radius_queries for insert
  with check (
    project_id in (
      select p.id from public.projects p
      join public.team_members tm on tm.team_id = p.team_id
      where tm.user_id = auth.uid()
    )
  );

-- ── Recursive CTE: AST dependency traversal ──────────────────────────────────
-- Finds all files that depend on start_file (reverse dependency graph).
-- "What breaks if I change start_file?"
-- Returns each dependent file with its minimum hop distance from start_file.
create or replace function public.traverse_ast_edges(
  p_repo_id    uuid,
  p_start_file text,
  p_max_depth  int default 5
)
returns table (
  file_path   text,
  hops        int,
  edge_type   text,
  via_file    text,
  via_symbol  text
)
language sql stable as $$
  with recursive deps as (
    -- Base case: direct dependents of start_file
    -- (files that import/call/inherit FROM start_file)
    select
      e.source_file  as file_path,
      e.target_file  as via_file,
      e.edge_type,
      e.symbol_name  as via_symbol,
      1              as hops
    from public.code_ast_edges e
    where e.repo_id = p_repo_id
      and e.target_file = p_start_file

    union all

    -- Recursive: dependents of already-found dependents
    select
      e.source_file  as file_path,
      d.file_path    as via_file,
      e.edge_type,
      e.symbol_name  as via_symbol,
      d.hops + 1     as hops
    from public.code_ast_edges e
    join deps d on e.target_file = d.file_path
    where e.repo_id = p_repo_id
      and d.hops < p_max_depth
      -- prevent cycles
      and e.source_file <> p_start_file
  )
  -- Return the shallowest path to each dependent file
  select distinct on (file_path)
    file_path,
    hops,
    edge_type,
    via_file,
    via_symbol
  from deps
  order by file_path, hops asc;
$$;
