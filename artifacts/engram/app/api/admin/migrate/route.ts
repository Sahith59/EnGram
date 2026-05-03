import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/admin/migrate
 * Returns migration status — which tables are missing.
 *
 * POST /api/admin/migrate
 * Attempts to run the missing migrations via the Supabase pg-meta API.
 * Falls back gracefully and returns the SQL to run manually.
 */

const MIGRATION_SQL = `
-- ============================================================
-- ENGRAM Phase 9 Migrations (idempotent — safe to re-run)
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 0011: Project Clustering
create extension if not exists "uuid-ossp";
create extension if not exists "vector";

create table if not exists public.projects (
  id             uuid primary key default uuid_generate_v4(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  name           text not null,
  description    text,
  centroid       vector(1536),
  snapshot_count int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_projects_team_id on public.projects(team_id);

alter table public.context_snapshots
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_context_snapshots_project_id
  on public.context_snapshots(project_id)
  where project_id is not null;

alter table public.projects enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='projects' and policyname='team members can view projects') then
    create policy "team members can view projects" on public.projects for select using (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='projects' and policyname='team members can insert projects') then
    create policy "team members can insert projects" on public.projects for insert with check (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='projects' and policyname='team members can update projects') then
    create policy "team members can update projects" on public.projects for update using (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='projects' and policyname='team members can delete projects') then
    create policy "team members can delete projects" on public.projects for delete using (
      team_id = public.my_team_id() and exists (
        select 1 from public.profiles where id = auth.uid() and role in ('owner','admin') and team_id = public.my_team_id()
      )
    );
  end if;
end $$;

create or replace function public.find_nearest_project(
  query_embedding  vector(1536),
  team_id_filter   uuid,
  match_threshold  float default 0.72,
  match_count      int   default 5
) returns table (id uuid, name text, similarity float, snapshot_count int)
language sql stable as $$
  select p.id, p.name, 1 - (p.centroid <=> query_embedding) as similarity, p.snapshot_count
  from public.projects p
  where p.team_id = team_id_filter and p.centroid is not null
    and 1 - (p.centroid <=> query_embedding) > match_threshold
  order by p.centroid <=> query_embedding limit match_count;
$$;

-- 0012: GitHub Integration
create table if not exists public.github_repos (
  id              uuid primary key default uuid_generate_v4(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,
  repo_full_name  text not null,
  repo_name       text not null,
  owner_login     text not null,
  default_branch  text not null default 'main',
  description     text,
  is_private      boolean not null default false,
  status          text not null default 'pending'
                    check (status in ('pending','indexing','indexed','error')),
  error_message   text,
  file_count      int not null default 0,
  chunk_count     int not null default 0,
  indexed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (team_id, repo_full_name)
);

create index if not exists idx_github_repos_team_id on public.github_repos(team_id);

create table if not exists public.github_chunks (
  id           uuid primary key default uuid_generate_v4(),
  repo_id      uuid not null references public.github_repos(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  file_path    text not null,
  language     text,
  chunk_index  int not null default 0,
  content      text not null,
  embedding    vector(1536),
  token_est    int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_github_chunks_repo_id on public.github_chunks(repo_id);
create index if not exists idx_github_chunks_team_id on public.github_chunks(team_id);

alter table public.github_repos enable row level security;
alter table public.github_chunks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='github_repos' and policyname='team members can view github repos') then
    create policy "team members can view github repos" on public.github_repos for select using (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='github_repos' and policyname='team members can insert github repos') then
    create policy "team members can insert github repos" on public.github_repos for insert with check (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='github_repos' and policyname='team members can update github repos') then
    create policy "team members can update github repos" on public.github_repos for update using (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='github_repos' and policyname='team members can delete github repos') then
    create policy "team members can delete github repos" on public.github_repos for delete using (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='github_chunks' and policyname='team members can view github chunks') then
    create policy "team members can view github chunks" on public.github_chunks for select using (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='github_chunks' and policyname='team members can insert github chunks') then
    create policy "team members can insert github chunks" on public.github_chunks for insert with check (team_id = public.my_team_id());
  end if;
  if not exists (select 1 from pg_policies where tablename='github_chunks' and policyname='team members can delete github chunks') then
    create policy "team members can delete github chunks" on public.github_chunks for delete using (team_id = public.my_team_id());
  end if;
end $$;

create or replace function public.search_github_chunks(
  query_embedding  vector(1536),
  team_id_filter   uuid,
  repo_id_filter   uuid  default null,
  match_count      int   default 8,
  match_threshold  float default 0.5
) returns table (id uuid, repo_id uuid, file_path text, language text, content text, similarity float)
language sql stable as $$
  select gc.id, gc.repo_id, gc.file_path, gc.language, gc.content,
    1 - (gc.embedding <=> query_embedding) as similarity
  from public.github_chunks gc
  where gc.team_id = team_id_filter and gc.embedding is not null
    and (repo_id_filter is null or gc.repo_id = repo_id_filter)
    and 1 - (gc.embedding <=> query_embedding) > match_threshold
  order by gc.embedding <=> query_embedding limit match_count;
$$;
`.trim();

async function checkMigrationStatus() {
  const admin = createAdminClient();
  const checks = await Promise.all([
    admin.from("projects").select("id").limit(1),
    admin.from("github_repos").select("id").limit(1),
    admin.from("github_chunks").select("id").limit(1),
    admin.from("context_snapshots").select("project_id").limit(1),
    admin.from("projects").select("github_repo_id").limit(1),
    admin.from("project_members").select("id").limit(1),
  ]);

  return {
    projects: checks[0].error?.code !== "PGRST205" && checks[0].error?.code !== "42703",
    github_repos: checks[1].error?.code !== "PGRST205",
    github_chunks: checks[2].error?.code !== "PGRST205",
    project_id_col: checks[3].error?.code !== "42703",
    project_workspaces: checks[4].error?.code !== "42703" && checks[5].error?.code !== "PGRST205",
  };
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const status = await checkMigrationStatus();
  const allMigrated = Object.values(status).every(Boolean);
  return NextResponse.json({ status, allMigrated, sql: allMigrated ? null : MIGRATION_SQL });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  // Try the Supabase pg-meta API (available in some self-hosted setups)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  try {
    const pgMetaRes = await fetch(`${supabaseUrl}/pg/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "x-connection-encrypted": "1",
      },
      body: JSON.stringify({ query: MIGRATION_SQL }),
    });

    if (pgMetaRes.ok) {
      const result = await pgMetaRes.json();
      const status = await checkMigrationStatus();
      return NextResponse.json({ ok: true, result, status });
    }

    const errText = await pgMetaRes.text();
    // pg-meta not available — return the SQL for manual execution
    return NextResponse.json({
      ok: false,
      error: `Automatic migration not available (${pgMetaRes.status}): ${errText.slice(0, 200)}`,
      sql: MIGRATION_SQL,
      instructions: "Copy the SQL above and run it in your Supabase SQL Editor at: https://supabase.com/dashboard/project/fvowlnhpzgkcejumftcv/sql/new",
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      sql: MIGRATION_SQL,
      instructions: "Copy the SQL above and run it in your Supabase SQL Editor at: https://supabase.com/dashboard/project/fvowlnhpzgkcejumftcv/sql/new",
    });
  }
}
