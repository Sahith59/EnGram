-- ============================================================
-- 0018: AST Dependency Graph
-- code_ast_edges: structural import/inherit/call relationships
-- github_chunks: add ast_node_type + ast_parent columns
-- ============================================================

-- AST dependency graph edges
create table if not exists public.code_ast_edges (
  id               uuid primary key default uuid_generate_v4(),
  repo_id          uuid not null references public.github_repos(id) on delete cascade,
  source_file      text not null,
  target_file      text not null,
  edge_type        text not null check (edge_type in ('import', 'call', 'inherit', 'implement')),
  symbol_name      text,
  language         text,
  commit_sha       text,
  commit_message   text,    -- first line of the commit message that introduced this edge
  commit_timestamp timestamptz, -- when the commit was authored
  indexed_at       timestamptz not null default now()
);

-- Indexes for traversal queries (both directions)
create index if not exists idx_code_ast_edges_repo_source
  on public.code_ast_edges (repo_id, source_file);

create index if not exists idx_code_ast_edges_repo_target
  on public.code_ast_edges (repo_id, target_file);

create index if not exists idx_code_ast_edges_repo_id
  on public.code_ast_edges (repo_id);

-- RLS: team members can read edges for their repos
alter table public.code_ast_edges enable row level security;

drop policy if exists "team members can view ast edges" on public.code_ast_edges;
create policy "team members can view ast edges"
  on public.code_ast_edges for select
  using (
    repo_id in (
      select id from public.github_repos where team_id = public.my_team_id()
    )
  );

drop policy if exists "service role can manage ast edges" on public.code_ast_edges;
create policy "service role can manage ast edges"
  on public.code_ast_edges for all
  using (true)
  with check (true);

-- Add AST metadata columns to github_chunks
alter table public.github_chunks
  add column if not exists ast_node_type text,
  add column if not exists ast_parent    text;
