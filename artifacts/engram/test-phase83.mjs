import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "http://localhost:3000";
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let pass = 0, fail = 0;
const results = [];
function ok(name) { pass++; results.push(`✅ ${name}`); }
function bad(name, err) { fail++; results.push(`❌ ${name} — ${err}`); }
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }

async function makeUser(label) {
  const email = `t83-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.engram`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Test1234!", email_confirm: true });
  if (error) throw error;
  // Wait for trigger to run
  await new Promise(r => setTimeout(r, 300));
  return { id: data.user.id, email };
}
async function loginCookie(userId) {
  // Create a session
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: (await admin.auth.admin.getUserById(userId)).data.user.email });
  if (error) throw error;
  // Verify the OTP to get a session
  const userClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: ses, error: e2 } = await userClient.auth.verifyOtp({ email_change: undefined, type: "magiclink", token_hash: data.properties.hashed_token });
  if (e2) throw e2;
  const cookieValue = `base64-${Buffer.from(JSON.stringify({
    access_token: ses.session.access_token,
    refresh_token: ses.session.refresh_token,
    expires_at: ses.session.expires_at,
    expires_in: ses.session.expires_in,
    token_type: "bearer",
    user: ses.user,
  })).toString("base64")}`;
  const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)/)[1];
  return `sb-${projectRef}-auth-token=${cookieValue}`;
}
async function api(cookie, path, init = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Cookie: cookie, "Content-Type": "application/json" },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

const cleanup = [];
try {
  // Setup 3 users
  console.log("🌱 Creating test users...");
  const A = await makeUser("alice"); cleanup.push(A.id);
  const B = await makeUser("bob"); cleanup.push(B.id);
  const C = await makeUser("carol"); cleanup.push(C.id);
  const cA = await loginCookie(A.id);
  const cB = await loginCookie(B.id);
  const cC = await loginCookie(C.id);

  // === BASELINE: every user has exactly one personal team ===
  await check("Alice starts with 1 personal team", async () => {
    const r = await api(cA, "/api/teams");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (r.body.teams.length !== 1) throw new Error(`expected 1 team, got ${r.body.teams.length}`);
    const t = r.body.teams[0];
    if (!t.isPersonal) throw new Error("not marked personal");
    if (!t.isActive) throw new Error("not active");
    if (t.role !== "owner") throw new Error(`role=${t.role}`);
    if (t.memberCount !== 1) throw new Error(`memberCount=${t.memberCount}`);
  });

  // === CREATE NEW TEAM ===
  let aliceSharedTeamId;
  await check("Alice creates new shared team 'Acme Eng'", async () => {
    const r = await api(cA, "/api/teams", { method: "POST", body: JSON.stringify({ name: "Acme Eng" }) });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.body.team.role !== "owner") throw new Error(`role=${r.body.team.role}`);
    if (r.body.team.isPersonal) throw new Error("should not be personal");
    aliceSharedTeamId = r.body.team.id;
  });

  await check("Alice now has 2 teams (personal + Acme), Acme is active", async () => {
    const r = await api(cA, "/api/teams");
    if (r.body.teams.length !== 2) throw new Error(`teams=${r.body.teams.length}`);
    const acme = r.body.teams.find(t => t.id === aliceSharedTeamId);
    if (!acme.isActive) throw new Error("Acme not active after create");
    const personal = r.body.teams.find(t => t.isPersonal);
    if (personal.isActive) throw new Error("personal should not be active");
  });

  await check("Reject team name too short", async () => {
    const r = await api(cA, "/api/teams", { method: "POST", body: JSON.stringify({ name: "x" }) });
    if (r.status !== 400) throw new Error(`status ${r.status}`);
  });

  // === SWITCH ACTIVE ===
  await check("Alice switches back to personal team", async () => {
    const personal = (await api(cA, "/api/teams")).body.teams.find(t => t.isPersonal);
    const r = await api(cA, "/api/team/switch", { method: "POST", body: JSON.stringify({ team_id: personal.id }) });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const after = (await api(cA, "/api/teams")).body;
    if (after.activeTeamId !== personal.id) throw new Error("active didn't switch");
  });

  await check("Switching to a team Alice isn't in returns 403", async () => {
    const carolPersonal = (await api(cC, "/api/teams")).body.teams[0].id;
    const r = await api(cA, "/api/team/switch", { method: "POST", body: JSON.stringify({ team_id: carolPersonal }) });
    if (r.status !== 403) throw new Error(`status ${r.status}`);
  });

  // === INVITE + JOIN flow ===
  // Alice switches back to Acme to invite from there
  await api(cA, "/api/team/switch", { method: "POST", body: JSON.stringify({ team_id: aliceSharedTeamId }) });

  let inviteCode;
  await check("Alice creates invite for Acme", async () => {
    const r = await api(cA, "/api/team/invite", { method: "POST", body: JSON.stringify({ max_uses: 5, expires_in_hours: 24 }) });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
    inviteCode = r.body.invite.code;
    if (!r.body.url.includes("/team/join/")) throw new Error("no join URL");
    if (r.body.url.startsWith("http://localhost")) throw new Error(`URL still localhost: ${r.body.url}`);
  });

  await check("Bob joins Acme via invite — ADDS membership (personal preserved)", async () => {
    const before = await api(cB, "/api/teams");
    const personalBefore = before.body.teams.find(t => t.isPersonal);
    const r = await api(cB, "/api/team/join", { method: "POST", body: JSON.stringify({ code: inviteCode }) });
    if (r.status !== 200) throw new Error(`join status ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.body.alreadyMember) throw new Error("should not be already member");
    const after = await api(cB, "/api/teams");
    if (after.body.teams.length !== 2) throw new Error(`Bob teams=${after.body.teams.length} (expected 2)`);
    const personalAfter = after.body.teams.find(t => t.isPersonal);
    if (!personalAfter) throw new Error("Bob's personal team disappeared!");
    if (personalAfter.id !== personalBefore.id) throw new Error("Bob's personal team got swapped");
    const acme = after.body.teams.find(t => t.id === aliceSharedTeamId);
    if (!acme) throw new Error("Bob is not in Acme");
    if (acme.role !== "member") throw new Error(`Bob role=${acme.role}`);
    if (!acme.isActive) throw new Error("Acme not active for Bob after join");
  });

  await check("Bob re-joining is idempotent (alreadyMember=true)", async () => {
    const r = await api(cB, "/api/team/join", { method: "POST", body: JSON.stringify({ code: inviteCode }) });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.alreadyMember) throw new Error("should be alreadyMember");
  });

  await check("Acme now has 2 members from Alice's view", async () => {
    const r = await api(cA, "/api/teams");
    const acme = r.body.teams.find(t => t.id === aliceSharedTeamId);
    if (acme.memberCount !== 2) throw new Error(`memberCount=${acme.memberCount}`);
  });

  // === LEAVE ===
  await check("Bob can't leave his personal workspace (403)", async () => {
    const personal = (await api(cB, "/api/teams")).body.teams.find(t => t.isPersonal);
    const r = await api(cB, "/api/team/leave", { method: "POST", body: JSON.stringify({ team_id: personal.id }) });
    if (r.status !== 403) throw new Error(`status ${r.status}`);
  });

  await check("Alice (sole owner of Acme with members) can't leave", async () => {
    const r = await api(cA, "/api/team/leave", { method: "POST", body: JSON.stringify({ team_id: aliceSharedTeamId }) });
    if (r.status !== 403) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await check("Bob leaves Acme — switches to personal, Acme survives", async () => {
    const r = await api(cB, "/api/team/leave", { method: "POST", body: JSON.stringify({ team_id: aliceSharedTeamId }) });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.body.teamDeleted) throw new Error("Acme should not be deleted");
    if (!r.body.switchedTo) throw new Error("should have switched");
    const after = await api(cB, "/api/teams");
    if (after.body.teams.length !== 1) throw new Error(`Bob teams after leave=${after.body.teams.length}`);
    if (!after.body.teams[0].isPersonal) throw new Error("Bob not on personal");
  });

  await check("Alice (now sole member of Acme) can leave — Acme deleted", async () => {
    const r = await api(cA, "/api/team/leave", { method: "POST", body: JSON.stringify({ team_id: aliceSharedTeamId }) });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
    if (!r.body.teamDeleted) throw new Error("Acme should be deleted");
    const { data: t } = await admin.from("teams").select("id").eq("id", aliceSharedTeamId).maybeSingle();
    if (t) throw new Error("Acme team row not deleted");
  });

  // === RACE TEST ===
  await check("Concurrent invite-claim race: max_uses=2, 5 racers → exactly 2 successes", async () => {
    // Alice creates a fresh team + invite
    const tr = await api(cA, "/api/teams", { method: "POST", body: JSON.stringify({ name: "RaceTeam" }) });
    const ir = await api(cA, "/api/team/invite", { method: "POST", body: JSON.stringify({ max_uses: 2, expires_in_hours: 1 }) });
    const code = ir.body.invite.code;
    const racers = await Promise.all(Array.from({ length: 5 }, async (_, i) => makeUser(`race${i}`)));
    racers.forEach(u => cleanup.push(u.id));
    const cookies = await Promise.all(racers.map(u => loginCookie(u.id)));
    const results = await Promise.all(cookies.map(c => api(c, "/api/team/join", { method: "POST", body: JSON.stringify({ code }) })));
    const successes = results.filter(r => r.status === 200 && !r.body.alreadyMember).length;
    if (successes !== 2) throw new Error(`expected 2 successes, got ${successes} — statuses: ${results.map(r=>r.status).join(",")}`);
    // Verify use_count = 2
    const { data: inv } = await admin.from("team_invites").select("use_count").eq("code", code).single();
    if (inv.use_count !== 2) throw new Error(`use_count=${inv.use_count}`);
  });

} catch (e) {
  console.error("FATAL:", e.message, e.stack);
} finally {
  // Cleanup
  console.log("🧹 Cleaning up", cleanup.length, "users...");
  for (const id of cleanup) {
    try { await admin.auth.admin.deleteUser(id); } catch {}
  }
  console.log("\n=== RESULTS ===");
  results.forEach(r => console.log(r));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
