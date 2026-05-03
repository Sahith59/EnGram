#!/usr/bin/env node
/**
 * Combined integration test for Phase 8.3 (multi-team) + Phase 8.4 (per-capture
 * visibility toggle).
 *
 * Pattern: throwaway users via supabase admin, base64 cookie, talk to localhost:3000.
 * Run with:  node artifacts/engram/scripts/test-phase83-84.mjs
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

let pass = 0;
let fail = 0;
const failures = [];
const cleanup = { users: [], teams: [], contexts: [] };

function log(level, msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${level} ${msg}`);
}
function ok(name) {
  pass++;
  log("✅", name);
}
function bad(name, err) {
  fail++;
  failures.push(`${name}: ${err}`);
  log("❌", `${name} — ${err}`);
}

// ---------- helpers ----------
async function makeUser(handle) {
  const email = `t84-${handle}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.engram`;
  const password = "TestPass123!XyZ";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { handle },
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
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`signIn ${user.handle}: ${error.message}`);
  // Build SSR cookie consumed by @supabase/ssr server client
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
  return { cookie: `${cookieName}=${value}`, accessToken: data.session.access_token };
}

async function api(session, method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await r.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: r.status, json };
}

async function bootstrap(user) {
  // /api/me auto-creates personal team
  const r = await api(await signIn(user), "GET", "/api/me");
  if (r.status !== 200) throw new Error(`bootstrap ${user.handle}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

async function makeCapture(session, overrides = {}) {
  // Make pairs unique per call so dedup doesn't collapse multiple captures
  const nonce = Math.random().toString(36).slice(2, 10);
  const r = await api(session, "POST", "/api/capture", {
    pairs: overrides.pairs ?? [
      { role: "user", content: `Question ${nonce}: which option?` },
      { role: "assistant", content: `Answer ${nonce}: option A because reasons.` },
    ],
    tool: overrides.tool ?? "claude",
    url: overrides.url ?? `https://claude.ai/chat/${nonce}`,
    mode: overrides.mode ?? "team",
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`capture failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  const id = r.json?.id ?? r.json?.data?.id ?? r.json?.context?.id;
  if (!id) throw new Error(`capture id missing: ${JSON.stringify(r.json)}`);
  cleanup.contexts.push(id);
  return id;
}

async function listContexts(session, scope) {
  const r = await api(session, "GET", `/api/contexts?scope=${scope}`);
  if (r.status !== 200) throw new Error(`list ${scope}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data ?? [];
}

// ---------- tests ----------
async function run() {
  log("🚀", `Phase 8.3 + 8.4 combined tests against ${BASE}`);

  // Setup: 3 users (alice, bob, carol)
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  const carol = await makeUser("carol");
  await bootstrap(alice);
  await bootstrap(bob);
  await bootstrap(carol);
  const aS = await signIn(alice);
  const bS = await signIn(bob);
  const cS = await signIn(carol);

  // Track personal team ids (team_id is at the top of /api/me, not inside user)
  const aMe = (await api(aS, "GET", "/api/me")).json;
  const alicePersonalTeam = aMe.team_id;
  const bMe = (await api(bS, "GET", "/api/me")).json;
  const bobPersonalTeam = bMe.team_id;
  if (!alicePersonalTeam || !bobPersonalTeam) {
    throw new Error(`Bootstrap failed to return team_id: alice=${alicePersonalTeam} bob=${bobPersonalTeam}`);
  }

  // === Phase 8.3 — multi-team membership ===

  // T1: Alice creates "Acme" team via POST /api/teams (becomes active automatically)
  let r = await api(aS, "POST", "/api/teams", { name: "Acme" });
  if (r.status === 200 || r.status === 201) ok("8.3.T1 alice creates Acme team");
  else bad("8.3.T1 alice creates Acme team", `status ${r.status} ${JSON.stringify(r.json)}`);
  const acmeId = r.json?.team_id ?? r.json?.id ?? r.json?.team?.id;
  if (acmeId) cleanup.teams.push(acmeId);

  // Active should now be Acme. /api/me returns user.team_id from ensureUserTeam,
  // which may not equal POST /api/teams's response ordering — check via /api/team
  // (returns the actual active team).
  r = await api(aS, "GET", "/api/team");
  if (r.json?.team?.id === acmeId) ok("8.3.T2 alice active team is Acme after create");
  else bad("8.3.T2 alice active team is Acme after create", `got ${r.json?.team?.id} expected ${acmeId} (full: ${JSON.stringify(r.json).slice(0, 200)})`);

  // T3: Alice switches back to personal — proves multi-membership
  r = await api(aS, "POST", "/api/team/switch", { team_id: alicePersonalTeam });
  r = await api(aS, "GET", "/api/me");
  if (r.json?.team_id === alicePersonalTeam) ok("8.3.T3 alice can switch back to personal");
  else bad("8.3.T3 alice can switch back to personal", `got ${r.json?.team_id}`);

  // T4: Alice invites Bob to Acme
  await api(aS, "POST", "/api/team/switch", { team_id: acmeId });
  r = await api(aS, "POST", "/api/team/invite", {});
  const inviteCode = r.json?.code ?? r.json?.invite?.code;
  if (r.status === 200 && inviteCode) ok("8.3.T4 alice creates invite code");
  else bad("8.3.T4 alice creates invite code", `status ${r.status} ${JSON.stringify(r.json)}`);

  // T5: Bob joins via code — should ADD membership (not destroy his personal team)
  r = await api(bS, "POST", "/api/team/join", { code: inviteCode });
  if (r.status === 200) ok("8.3.T5 bob joins Acme");
  else bad("8.3.T5 bob joins Acme", `status ${r.status} ${JSON.stringify(r.json)}`);

  // T6: Bob's personal team still exists & he can switch back
  r = await api(bS, "POST", "/api/team/switch", { team_id: bobPersonalTeam });
  r = await api(bS, "GET", "/api/me");
  if (r.json?.team_id === bobPersonalTeam) ok("8.3.T6 bob personal team preserved after join");
  else bad("8.3.T6 bob personal team preserved after join", `got ${r.json?.team_id}`);

  // T7: Carol cannot join with bogus code
  r = await api(cS, "POST", "/api/team/join", { code: "BOGUS-CODE-123" });
  if (r.status >= 400) ok("8.3.T7 carol rejected with bogus code");
  else bad("8.3.T7 carol rejected with bogus code", `expected error, got ${r.status}`);

  // === Phase 8.4 — per-capture visibility toggle ===

  // Setup: Alice (in Acme) creates 1 personal + 2 captures while in Acme
  await api(aS, "POST", "/api/team/switch", { team_id: alicePersonalTeam });
  const personalCapId = await makeCapture(aS, { mode: "personal" });

  await api(aS, "POST", "/api/team/switch", { team_id: acmeId });
  const teamCapId1 = await makeCapture(aS, { mode: "team" });
  const teamCapId2 = await makeCapture(aS, { mode: "team" });

  // Bob (also in Acme now) makes a team capture
  await api(bS, "POST", "/api/team/switch", { team_id: acmeId });
  const bobTeamCapId = await makeCapture(bS, { mode: "team" });

  // T8: Default visibility on /api/capture should be 'team' when in a real team and 'personal' when in personal team
  let aliceTeamList = await listContexts(aS, "team");
  let alicePersonalList = await listContexts(aS, "personal");
  const teamHas1 = aliceTeamList.some((c) => c.id === teamCapId1);
  const personalHasNote = alicePersonalList.some((c) => c.id === personalCapId);
  if (teamHas1 && personalHasNote) ok("8.4.T8 captures land in correct scope by default");
  else bad("8.4.T8 captures land in correct scope by default",
    `teamHas1=${teamHas1} personalHasNote=${personalHasNote}`);

  // T9: GET /api/contexts returns created_by + visibility (needed for UI)
  const sample = aliceTeamList.find((c) => c.id === teamCapId1);
  if (sample?.created_by === alice.id && sample?.visibility === "team") {
    ok("8.4.T9 list response includes created_by + visibility");
  } else {
    bad("8.4.T9 list response includes created_by + visibility", JSON.stringify(sample));
  }

  // T10: Demote teamCapId1 (alice owns) team→personal
  r = await api(aS, "PATCH", `/api/contexts/${teamCapId1}`, { visibility: "personal" });
  if (r.status === 200 && r.json?.visibility === "personal") ok("8.4.T10 alice demotes team→personal");
  else bad("8.4.T10 alice demotes team→personal", `status ${r.status} ${JSON.stringify(r.json)}`);

  // It should now show in personal scope and not in team scope
  alicePersonalList = await listContexts(aS, "personal");
  aliceTeamList = await listContexts(aS, "team");
  if (alicePersonalList.some((c) => c.id === teamCapId1) && !aliceTeamList.some((c) => c.id === teamCapId1)) {
    ok("8.4.T11 demoted capture moves out of team scope");
  } else {
    bad("8.4.T11 demoted capture moves out of team scope", "still in wrong list");
  }

  // T12: Promote personalCapId personal→team (while alice is active in Acme)
  r = await api(aS, "PATCH", `/api/contexts/${personalCapId}`, { visibility: "team" });
  if (r.status === 200 && r.json?.visibility === "team") ok("8.4.T12 alice promotes personal→team");
  else bad("8.4.T12 alice promotes personal→team", `status ${r.status} ${JSON.stringify(r.json)}`);

  // It should now be visible to Bob in the Acme team scope
  const bobTeamList = await listContexts(bS, "team");
  if (bobTeamList.some((c) => c.id === personalCapId)) ok("8.4.T13 promoted capture visible to teammate");
  else bad("8.4.T13 promoted capture visible to teammate", "bob can't see promoted capture");

  // T14: Bob CANNOT change visibility of Alice's capture
  r = await api(bS, "PATCH", `/api/contexts/${personalCapId}`, { visibility: "personal" });
  if (r.status === 403) ok("8.4.T14 non-creator forbidden from changing visibility");
  else bad("8.4.T14 non-creator forbidden from changing visibility", `expected 403 got ${r.status}`);

  // T15: Carol (NOT in Acme) cannot see or PATCH Acme captures
  r = await api(cS, "PATCH", `/api/contexts/${teamCapId2}`, { visibility: "personal" });
  if (r.status === 403 || r.status === 404) ok("8.4.T15 outsider blocked from PATCH");
  else bad("8.4.T15 outsider blocked from PATCH", `expected 403/404 got ${r.status}`);

  // T16: Invalid visibility value → 400
  r = await api(aS, "PATCH", `/api/contexts/${teamCapId2}`, { visibility: "public" });
  if (r.status === 400) ok("8.4.T16 invalid visibility rejected");
  else bad("8.4.T16 invalid visibility rejected", `expected 400 got ${r.status}`);

  // T17: Bulk demote — alice owns teamCapId2 + bob's bobTeamCapId mixed in
  r = await api(aS, "POST", "/api/contexts/bulk-visibility", {
    ids: [teamCapId2, bobTeamCapId],
    visibility: "personal",
  });
  if (r.status === 200 && r.json?.updated === 1 && r.json?.skipped?.includes(bobTeamCapId)) {
    ok("8.4.T17 bulk demote updates only owned rows, reports skipped");
  } else {
    bad("8.4.T17 bulk demote updates only owned rows, reports skipped",
      `status ${r.status} ${JSON.stringify(r.json)}`);
  }

  // T18: Bulk endpoint validates input
  r = await api(aS, "POST", "/api/contexts/bulk-visibility", { ids: [], visibility: "team" });
  const empty400 = r.status === 400;
  r = await api(aS, "POST", "/api/contexts/bulk-visibility", { ids: [teamCapId2], visibility: "junk" });
  const bad400 = r.status === 400;
  if (empty400 && bad400) ok("8.4.T18 bulk endpoint validates input");
  else bad("8.4.T18 bulk endpoint validates input", `empty=${empty400} bad=${bad400}`);

  // T19: Bulk promote — alice promotes the demoted teamCapId2 back to team
  r = await api(aS, "POST", "/api/contexts/bulk-visibility", {
    ids: [teamCapId2],
    visibility: "team",
  });
  if (r.status === 200 && r.json?.updated === 1) {
    aliceTeamList = await listContexts(aS, "team");
    if (aliceTeamList.some((c) => c.id === teamCapId2)) ok("8.4.T19 bulk promote works");
    else bad("8.4.T19 bulk promote works", "promoted capture not in team list");
  } else bad("8.4.T19 bulk promote works", `status ${r.status} ${JSON.stringify(r.json)}`);

  // T20: Promotion sets team_id to caller's CURRENT active team.
  // Alice switches to her personal team and promotes a capture there → it should
  // land in her personal team's scope, NOT in Acme's. Verify via DB so we test
  // the contract directly (RLS / scope-list logic is covered by T13).
  // Confirm bob is active in Acme first
  await api(bS, "POST", "/api/team/switch", { team_id: acmeId });
  await api(aS, "POST", "/api/team/switch", { team_id: alicePersonalTeam });
  const stagedId = await makeCapture(aS, { mode: "personal" });
  r = await api(aS, "PATCH", `/api/contexts/${stagedId}`, { visibility: "team" });
  if (r.status === 200) {
    // Read the row directly via admin to inspect team_id
    const { data: row } = await admin
      .from("context_snapshots")
      .select("id, team_id, visibility")
      .eq("id", stagedId)
      .single();
    if (row?.team_id === alicePersonalTeam && row?.visibility === "team") {
      ok("8.4.T20 promote uses caller's active team (team_id = alice personal)");
    } else {
      bad("8.4.T20 promote uses caller's active team",
        `expected team_id=${alicePersonalTeam} got team_id=${row?.team_id} visibility=${row?.visibility}`);
    }
  } else bad("8.4.T20 promote uses caller's active team", `promote failed ${r.status} ${JSON.stringify(r.json)}`);

  // === summary ===
  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log("=".repeat(60));
}

async function teardown() {
  log("🧹", "cleaning up test data");
  for (const id of cleanup.contexts) {
    await admin.from("context_snapshots").delete().eq("id", id);
  }
  for (const id of cleanup.teams) {
    await admin.from("team_members").delete().eq("team_id", id);
    await admin.from("teams").delete().eq("id", id);
  }
  for (const id of cleanup.users) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

run()
  .catch((e) => {
    console.error("FATAL", e);
    fail++;
  })
  .finally(async () => {
    try { await teardown(); } catch (e) { console.error("teardown error", e); }
    process.exit(fail > 0 ? 1 : 0);
  });
