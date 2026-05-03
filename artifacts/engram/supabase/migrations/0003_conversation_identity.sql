-- ============================================================
-- ENGRAM Phase 5C: Conversation-identity upsert
-- Allows one snapshot per real conversation, updated in place
-- as the chat grows, instead of creating duplicates.
-- ============================================================

alter table public.context_snapshots
  add column if not exists identity_hash text;

create index if not exists idx_context_snapshots_team_identity
  on public.context_snapshots(team_id, identity_hash)
  where identity_hash is not null;
