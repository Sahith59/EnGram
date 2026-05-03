-- ============================================================
-- ENGRAM Phase 5B: Content-hash dedup
-- Prevents duplicate captures of identical conversation content.
-- ============================================================

-- 1. Add content_hash column (sha256 of canonical conversation JSON)
alter table public.context_snapshots
  add column if not exists content_hash text;

-- 2. Composite index for dedup lookup: (team_id, content_hash)
create index if not exists idx_context_snapshots_team_hash
  on public.context_snapshots(team_id, content_hash)
  where content_hash is not null;

-- 3. Optional: source_url column so we can dedup per-conversation as well
alter table public.context_snapshots
  add column if not exists source_url text;

create index if not exists idx_context_snapshots_team_source_url
  on public.context_snapshots(team_id, source_url)
  where source_url is not null;
