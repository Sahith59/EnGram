// src/storage/schema.ts
// SQLite schema that mirrors the Supabase web app's context_snapshots table.
// Column names match the web app exactly so sync is a direct field mapping.
// Note: no FTS5 virtual table (sql.js doesn't include the FTS5 extension).
// Full-text search falls back to LIKE queries in db.ts.

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS context_snapshots (
    id            TEXT PRIMARY KEY,
    user_id       TEXT,
    title         TEXT NOT NULL,
    summary       TEXT,
    decision      TEXT,         -- key_decisions (matches web app 'decision' column)
    rationale     TEXT,         -- context_md / handoff brief (matches web app 'rationale')
    raw_pairs     TEXT NOT NULL, -- JSON array of {role, content} objects
    tags          TEXT,          -- JSON array of strings (technologies)
    ai_tool       TEXT NOT NULL, -- 'claude' | 'chatgpt' | 'gemini' | 'other'
    source        TEXT DEFAULT 'cli',     -- 'cli' | 'browser'
    visibility    TEXT DEFAULT 'personal', -- 'personal' | 'team'
    captured_at   TEXT DEFAULT (datetime('now')),
    synced        INTEGER DEFAULT 0       -- 0 = local only, 1 = pushed to web app
  );

  CREATE TABLE IF NOT EXISTS kt_queries (
    id          TEXT PRIMARY KEY,
    user_id     TEXT,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    sources     TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    synced      INTEGER DEFAULT 0
  );
`;
