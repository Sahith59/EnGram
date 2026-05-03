#!/usr/bin/env node
/**
 * One-shot cleanup: collapses every existing duplicate snapshot group down to
 * the OLDEST row in each (team_id, created_by, visibility, content_hash) AND
 * each (team_id, created_by, visibility, source_url) bucket.
 *
 * Safe to re-run. Reports what it did. Does NOT touch the unique indexes —
 * those are added by migration 0010 via Supabase Studio.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function fetchAll() {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('context_snapshots')
      .select('id, team_id, created_by, visibility, content_hash, source_url, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function pickDuplicates(rows, keyOf) {
  const seen = new Map(); // key -> keeperId
  const drop = new Set();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    if (!seen.has(k)) seen.set(k, r.id);
    else drop.add(r.id);
  }
  return { keepers: seen, drop };
}

const rows = await fetchAll();
console.log(`Loaded ${rows.length} snapshots.`);

const byHash = pickDuplicates(rows, (r) =>
  r.content_hash ? `${r.team_id}|${r.created_by}|${r.visibility}|h:${r.content_hash}` : null
);
const remainingAfterHash = rows.filter((r) => !byHash.drop.has(r.id));
const byUrl = pickDuplicates(remainingAfterHash, (r) =>
  r.source_url ? `${r.team_id}|${r.created_by}|${r.visibility}|u:${r.source_url}` : null
);

const allDrops = new Set([...byHash.drop, ...byUrl.drop]);
console.log(`Will delete: ${byHash.drop.size} content_hash dupes + ${byUrl.drop.size} source_url dupes = ${allDrops.size} total.`);

if (allDrops.size === 0) {
  console.log('Nothing to clean. ✅');
  process.exit(0);
}

const ids = [...allDrops];
let deleted = 0;
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const { error } = await sb.from('context_snapshots').delete().in('id', chunk);
  if (error) { console.error('delete chunk failed:', error); process.exit(1); }
  deleted += chunk.length;
}
console.log(`Deleted ${deleted} duplicate rows. ✅`);

// Verify
const after = await fetchAll();
const stillDup = pickDuplicates(after, (r) =>
  r.content_hash ? `${r.team_id}|${r.created_by}|${r.visibility}|h:${r.content_hash}` : null
);
console.log(`Post-cleanup: ${after.length} rows, ${stillDup.drop.size} remaining content_hash dupes.`);
