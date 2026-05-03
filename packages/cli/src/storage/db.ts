// src/storage/db.ts
// Thin wrapper around sql.js (pure WASM SQLite — no native compilation needed).
// Persists the DB to disk as a binary file at ~/.engram/engram.db.
// All column names mirror the Supabase web app schema for clean sync.

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { DB_PATH, ensureEngramDir } from './config';
import { SCHEMA_SQL } from './schema';

let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (_db) return _db;
  ensureEngramDir();

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  _db.exec(SCHEMA_SQL);
  return _db;
}

function saveToDisk(db: Database): void {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export interface ContextSnapshot {
  id: string;
  user_id: string | null;
  title: string;
  summary: string | null;
  decision: string | null;
  rationale: string | null;
  raw_pairs: string;
  tags: string | null;
  ai_tool: string;
  source: string;
  visibility: string;
  captured_at: string;
  synced: number;
}

function rowToSnapshot(row: Record<string, unknown>): ContextSnapshot {
  return {
    id: String(row.id ?? ''),
    user_id: row.user_id != null ? String(row.user_id) : null,
    title: String(row.title ?? ''),
    summary: row.summary != null ? String(row.summary) : null,
    decision: row.decision != null ? String(row.decision) : null,
    rationale: row.rationale != null ? String(row.rationale) : null,
    raw_pairs: String(row.raw_pairs ?? '[]'),
    tags: row.tags != null ? String(row.tags) : null,
    ai_tool: String(row.ai_tool ?? 'other'),
    source: String(row.source ?? 'cli'),
    visibility: String(row.visibility ?? 'personal'),
    captured_at: String(row.captured_at ?? ''),
    synced: Number(row.synced ?? 0),
  };
}

function execQuery(db: Database, sql: string, params: (string | number | null | Uint8Array)[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export async function insertSnapshot(
  snap: Omit<ContextSnapshot, 'id' | 'captured_at' | 'synced'>
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();

  db.run(
    `INSERT INTO context_snapshots
      (id, user_id, title, summary, decision, rationale, raw_pairs, tags, ai_tool, source, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, snap.user_id, snap.title, snap.summary, snap.decision, snap.rationale,
     snap.raw_pairs, snap.tags, snap.ai_tool, snap.source, snap.visibility]
  );

  saveToDisk(db);
  return id;
}

export async function getRecentSnapshots(limit = 10, tool?: string): Promise<ContextSnapshot[]> {
  const db = await getDb();
  const sql = tool
    ? 'SELECT * FROM context_snapshots WHERE ai_tool = ? ORDER BY captured_at DESC LIMIT ?'
    : 'SELECT * FROM context_snapshots ORDER BY captured_at DESC LIMIT ?';
  const params = tool ? [tool, limit] : [limit];
  return execQuery(db, sql, params).map(rowToSnapshot);
}

export async function getMostRecent(tool?: string): Promise<ContextSnapshot | null> {
  const db = await getDb();
  const sql = tool
    ? 'SELECT * FROM context_snapshots WHERE ai_tool = ? ORDER BY captured_at DESC LIMIT 1'
    : 'SELECT * FROM context_snapshots ORDER BY captured_at DESC LIMIT 1';
  const params = tool ? [tool] : [];
  const rows = execQuery(db, sql, params);
  return rows.length > 0 ? rowToSnapshot(rows[0]) : null;
}

export async function searchSnapshots(query: string, limit = 8): Promise<ContextSnapshot[]> {
  const db = await getDb();
  const pattern = `%${query}%`;
  const rows = execQuery(db,
    `SELECT * FROM context_snapshots
     WHERE title LIKE ? OR summary LIKE ? OR decision LIKE ? OR tags LIKE ?
     ORDER BY captured_at DESC LIMIT ?`,
    [pattern, pattern, pattern, pattern, limit]
  );
  return rows.map(rowToSnapshot);
}

export async function getUnsyncedSnapshots(): Promise<ContextSnapshot[]> {
  const db = await getDb();
  const rows = execQuery(db,
    'SELECT * FROM context_snapshots WHERE synced = 0 ORDER BY captured_at ASC', []
  );
  return rows.map(rowToSnapshot);
}

export async function markSynced(id: string): Promise<void> {
  const db = await getDb();
  db.run('UPDATE context_snapshots SET synced = 1 WHERE id = ?', [id]);
  saveToDisk(db);
}
