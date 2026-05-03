-- ============================================================
-- ENGRAM Phase 5D: Personal vs Team visibility scopes
-- ============================================================
-- Each snapshot now belongs to one of two scopes:
--   personal: only the creator can see it (full content, full privacy)
--   team:     all team members can read the BRIEF (title/summary/decision/
--             rationale/tags + author_handle), but raw_conversation stays
--             private to the original author.
-- ============================================================

alter table public.context_snapshots
  add column if not exists visibility    text not null default 'personal'
    check (visibility in ('personal', 'team')),
  add column if not exists author_handle text;

create index if not exists idx_context_snapshots_team_visibility
  on public.context_snapshots(team_id, visibility, created_at desc);

create index if not exists idx_context_snapshots_creator_personal
  on public.context_snapshots(created_by, created_at desc)
  where visibility = 'personal';

-- ============================================================
-- RLS: replace the old "team members can view snapshots" policy
-- with a scoped one that respects visibility.
-- ============================================================

drop policy if exists "team members can view snapshots" on public.context_snapshots;

create policy "scoped snapshot visibility"
  on public.context_snapshots for select
  using (
    (visibility = 'personal' and created_by = auth.uid())
    or (visibility = 'team' and team_id = public.my_team_id())
  );
