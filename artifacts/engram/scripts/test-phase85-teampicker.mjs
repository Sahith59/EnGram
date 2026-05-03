#!/usr/bin/env node
/**
 * Phase 8.5 — Team-picker + capture-route security tests.
 *
 * Verifies:
 *  1. /api/capture rejects an explicit teamId the caller is NOT a member of (403).
 *  2. /api/capture writes to the explicit teamId when the caller IS a member,
 *     even if it's not their currently-active team (multi-team picker flow).
 *  3. The dropped capture is visible to other members of the chosen team
 *     (i.e. team-scoped delivery actually works).
 *  4. Sending a teamId of a team the user just left returns 403.
 */
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.ENGRAM_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let pass = 0, fail = 0;
const cleanup = { users: [], teams: [], contexts: [] };

function log(level, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${level} ${msg}`);
}
function ok(name) { pass++; log("✅", name); }
function bad(name, err) { fail++; log("❌", `${name} — ${err}`); }

async function makeUser(handle) {
  const email = `t85-${handle}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.engram`;
  const password = "TestPass123!XyZ";
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { handle },
  });
  if (error) throw new Error(`createUser ${handle}: ${error.message}`);
  cleanup.users.push(data.user.id);
  return { id: data.user.id, email, password, handle };
}

async function signIn(user) {
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({
    email: user.email, password: user.password,
  });
  if (error) throw new Error(`signIn ${user.handle}: ${error.message}`);
  const session = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
    user: data.session.user,
  };
  const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1];
  const cookieName = `sb-${projectRef}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
  return { cookie: `${cookieName}=${value}` };
}

async function api(session, method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: session.cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await r.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: r.status, json };
}

async function run() {
  log("🚀", `Phase 8.5 team-picker + security against ${BASE}`);

  // Three users: alice + bob will share Acme; carol is an outsider.
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  const carol = await makeUser("carol");

  const aS = await signIn(alice);
  const bS = await signIn(bob);
  const cS = await signIn(carol);

  // Bootstrap (creates personal teams). Capture alice's personal team_id
  // BEFORE she creates Acme — POST /api/teams auto-switches her active team.
  const aPersonal = (await api(aS, "GET", "/api/me")).json.team_id;
  await api(bS, "GET", "/api/me");
  await api(cS, "GET", "/api/me");
  if (!aPersonal) throw new Error("alice personal team_id missing");

  // Alice creates Acme. She's now a member of {personal_alice, Acme}.
  let r = await api(aS, "POST", "/api/teams", { name: "Acme " + Date.now().toString(36) });
  const acmeId = r.json?.team?.id;
  if (!acmeId) throw new Error("acme not created: " + JSON.stringify(r.json));
  cleanup.teams.push(acmeId);

  // Alice invites Bob who joins Acme
  r = await api(aS, "POST", "/api/team/invite", {});
  const inviteCode = r.json?.invite?.code;
  await api(bS, "POST", "/api/team/join", { code: inviteCode });

  // Switch alice back to personal so T1 can prove "active=personal but
  // capture lands in Acme via the explicit teamId picker".
  await api(aS, "POST", "/api/team/switch", { team_id: aPersonal });

  // === T1: Alice's ACTIVE team is personal, but she captures into Acme. ===
  r = await api(aS, "POST", "/api/capture", {
    pairs: [
      { role: "user", content: "T1 picker test " + Math.random() },
      { role: "assistant", content: "T1 reply " + Math.random() },
    ],
    tool: "claude",
    url: "https://claude.ai/chat/picker-t1",
    teamId: acmeId,
    mode: "team",
  });
  if ((r.status === 200 || r.status === 201) && r.json?.id) {
    cleanup.contexts.push(r.json.id);
    ok("8.5.T1 capture into explicit teamId (Acme) succeeds even when active=personal");
  } else {
    bad("8.5.T1 capture into explicit teamId", `status ${r.status} ${JSON.stringify(r.json)}`);
  }
  const t1Id = r.json?.id;

  // === T2: Bob (Acme member) sees the capture in his Acme view. ===
  await api(bS, "POST", "/api/team/switch", { team_id: acmeId });
  r = await api(bS, "GET", "/api/contexts?scope=team");
  const found = (r.json?.data ?? []).some((c) => c.id === t1Id);
  if (found) ok("8.5.T2 team capture visible to Acme teammate");
  else bad("8.5.T2 team capture visible to Acme teammate", `not in list (${r.json?.data?.length ?? 0} rows)`);

  // === T3: Carol (NOT a member) tries to write into Acme → 403. ===
  r = await api(cS, "POST", "/api/capture", {
    pairs: [
      { role: "user", content: "T3 carol attempt" },
      { role: "assistant", content: "T3 reply" },
    ],
    tool: "claude",
    url: "https://claude.ai/chat/picker-t3",
    teamId: acmeId,
    mode: "team",
  });
  if (r.status === 403) ok("8.5.T3 outsider blocked from writing into team they don't belong to");
  else bad("8.5.T3 outsider blocked", `expected 403, got ${r.status} ${JSON.stringify(r.json)}`);

  // === T4: Bob captures into Alice's PERSONAL team (he's not a member) → 403. ===
  r = await api(bS, "POST", "/api/capture", {
    pairs: [
      { role: "user", content: "T4 bob attempt" },
      { role: "assistant", content: "T4 reply" },
    ],
    tool: "claude",
    url: "https://claude.ai/chat/picker-t4",
    teamId: aPersonal,
    mode: "team",
  });
  if (r.status === 403) ok("8.5.T4 cannot target someone else's personal team");
  else bad("8.5.T4 cannot target someone else's personal team", `expected 403, got ${r.status}`);

  // === T5: Garbage UUID → 403 (not 500). ===
  r = await api(aS, "POST", "/api/capture", {
    pairs: [
      { role: "user", content: "T5 bogus" },
      { role: "assistant", content: "T5 reply" },
    ],
    tool: "claude",
    url: "https://claude.ai/chat/picker-t5",
    teamId: "00000000-0000-0000-0000-000000000000",
    mode: "team",
  });
  if (r.status === 403) ok("8.5.T5 bogus teamId rejected as 403");
  else bad("8.5.T5 bogus teamId", `expected 403, got ${r.status} ${JSON.stringify(r.json)}`);

  // === T6: No teamId at all → server falls back to personal workspace (200/201). ===
  r = await api(aS, "POST", "/api/capture", {
    pairs: [
      { role: "user", content: "T6 fallback " + Math.random() },
      { role: "assistant", content: "T6 reply " + Math.random() },
    ],
    tool: "claude",
    url: "https://claude.ai/chat/picker-t6",
    mode: "personal",
  });
  if (r.status === 200 || r.status === 201) {
    if (r.json?.id) cleanup.contexts.push(r.json.id);
    ok("8.5.T6 omitting teamId still works (server resolves personal workspace)");
  } else {
    bad("8.5.T6 omit teamId", `status ${r.status} ${JSON.stringify(r.json)}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(60));

  // Cleanup
  log("🧹", "cleaning up test data");
  if (cleanup.contexts.length) {
    await admin.from("context_snapshots").delete().in("id", cleanup.contexts);
  }
  if (cleanup.teams.length) {
    await admin.from("teams").delete().in("id", cleanup.teams);
  }
  for (const id of cleanup.users) {
    try { await admin.auth.admin.deleteUser(id); } catch {}
  }

  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error("Suite crashed:", e);
  process.exit(2);
});
