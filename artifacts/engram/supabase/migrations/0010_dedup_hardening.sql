-- Phase 8.6 — DEDUP HARDENING
--
-- Problem: with .maybeSingle() in tier-1 dedup and concurrent captures racing,
-- multiple identical rows could be inserted. Once 2+ exist for the same scope
-- + content_hash, .maybeSingle() returns NULL ("multiple rows") and dedup is
-- broken forever, accumulating more duplicates on every browser reopen.
--
-- This migration:
--   1. Collapses existing duplicates by keeping the OLDEST row per
--      (team_id, created_by, visibility, content_hash) group.
--   2. Adds a partial UNIQUE index so the database itself rejects duplicate
--      inserts atomically — even under concurrency.
--   3. Adds a partial UNIQUE index on (team_id, created_by, visibility,
--      source_url) limited to non-null URLs, so a single browser tab cannot
--      ever produce more than one row per source URL per scope. This is the
--      hard backstop when content normalization misses some UI noise.

-- =========== 1. Collapse existing duplicates ===========
-- Keep the OLDEST row in each (scope, content_hash) group; delete the rest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY team_id, created_by, visibility, content_hash
           ORDER BY created_at ASC
         ) AS rn
  FROM context_snapshots
  WHERE content_hash IS NOT NULL
)
DELETE FROM context_snapshots
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Same collapse keyed on source_url (catches the case where content normalization
-- failed and the same chat got different content_hashes). Keep oldest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY team_id, created_by, visibility, source_url
           ORDER BY created_at ASC
         ) AS rn
  FROM context_snapshots
  WHERE source_url IS NOT NULL AND source_url <> ''
)
DELETE FROM context_snapshots
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- =========== 2. Hard UNIQUE constraints (partial, NULL-safe) ===========
-- Atomic dedup: concurrent INSERTs with the same hash get a unique-violation
-- error that the application code maps to "duplicate, return existing row".
CREATE UNIQUE INDEX IF NOT EXISTS uq_context_snapshots_scope_content
  ON context_snapshots (team_id, created_by, visibility, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_context_snapshots_scope_url
  ON context_snapshots (team_id, created_by, visibility, source_url)
  WHERE source_url IS NOT NULL AND source_url <> '';
