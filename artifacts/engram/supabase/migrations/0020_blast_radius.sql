-- ============================================================
-- 0020: Blast Radius Engine
-- blast_radius_queries: audit log + cache for blast-radius analyses
-- traverse_ast_edges: recursive CTE for bidirectional dependency BFS
-- ============================================================

create table if not exists public.blast_radius_queries (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  query_file            text not null,
  change_description    text not null,
  analysis_name         text,
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

-- ── Recursive CTE: bidirectional AST dependency traversal ────────────────────
-- Walks BOTH directions from start_file:
--   direction = 'reverse': files that depend ON start_file (will break if it changes)
--   direction = 'forward': files that start_file depends ON (its dependencies)
-- Returns each file with its minimum hop distance and the direction it was found in.
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
  via_symbol  text,
  direction   text
)
language sql stable as $$
  with recursive

  -- ── Reverse traversal: who imports / depends on start_file ─────────────────
  reverse_deps as (
    -- Base: direct importers of start_file
    select
      e.source_file  as file_path,
      e.target_file  as via_file,
      e.edge_type,
      e.symbol_name  as via_symbol,
      1              as hops,
      'reverse'      as direction
    from public.code_ast_edges e
    where e.repo_id = p_repo_id
      and e.target_file = p_start_file
      and e.source_file <> p_start_file

    union all

    -- Recursive: importers of importers
    select
      e.source_file  as file_path,
      d.file_path    as via_file,
      e.edge_type,
      e.symbol_name  as via_symbol,
      d.hops + 1     as hops,
      'reverse'      as direction
    from public.code_ast_edges e
    join reverse_deps d on e.target_file = d.file_path
    where e.repo_id = p_repo_id
      and d.hops < p_max_depth
      and e.source_file <> p_start_file
  ),

  -- ── Forward traversal: what start_file imports / calls ─────────────────────
  forward_deps as (
    -- Base: direct dependencies of start_file
    select
      e.target_file  as file_path,
      e.source_file  as via_file,
      e.edge_type,
      e.symbol_name  as via_symbol,
      1              as hops,
      'forward'      as direction
    from public.code_ast_edges e
    where e.repo_id = p_repo_id
      and e.source_file = p_start_file
      and e.target_file <> p_start_file

    union all

    -- Recursive: what dependencies depend on in turn
    select
      e.target_file  as file_path,
      d.file_path    as via_file,
      e.edge_type,
      e.symbol_name  as via_symbol,
      d.hops + 1     as hops,
      'forward'      as direction
    from public.code_ast_edges e
    join forward_deps d on e.source_file = d.file_path
    where e.repo_id = p_repo_id
      and d.hops < p_max_depth
      and e.target_file <> p_start_file
  ),

  -- ── Combined ────────────────────────────────────────────────────────────────
  all_deps as (
    select * from reverse_deps
    union all
    select * from forward_deps
  )

  -- Return the shallowest path to each (file_path, direction) pair
  select distinct on (file_path, direction)
    file_path,
    hops,
    edge_type,
    via_file,
    via_symbol,
    direction
  from all_deps
  order by file_path, direction, hops asc;
$$;
