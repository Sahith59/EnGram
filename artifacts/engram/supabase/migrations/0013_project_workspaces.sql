-- ============================================================
-- 0013: Project Workspaces  (idempotent — safe to re-run)
-- Links projects to GitHub repos + project-level membership
-- ============================================================

-- Add github_repo_id + created_by to projects (if not already there)
alter table public.projects
  add column if not exists github_repo_id uuid references public.github_repos(id) on delete set null,
  add column if not exists created_by     uuid references public.profiles(id) on delete set null;

create index if not exists idx_projects_github_repo_id
  on public.projects(github_repo_id)
  where github_repo_id is not null;

create index if not exists idx_projects_created_by
  on public.projects(created_by);

-- Project-level membership (isolated from team membership)
create table if not exists public.project_members (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member'
                check (role in ('owner', 'member')),
  invited_by  uuid references public.profiles(id) on delete set null,
  joined_at   timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists idx_project_members_project_id
  on public.project_members(project_id);

create index if not exists idx_project_members_user_id
  on public.project_members(user_id);

-- RLS for project_members
alter table public.project_members enable row level security;

drop policy if exists "project members can view membership" on public.project_members;
drop policy if exists "project owners can manage membership" on public.project_members;

create policy "project members can view membership"
  on public.project_members for select
  using (
    exists (
      select 1 from public.project_members pm2
      where pm2.project_id = project_members.project_id
        and pm2.user_id = auth.uid()
    )
  );

create policy "project owners can manage membership"
  on public.project_members for all
  using (
    exists (
      select 1 from public.project_members pm2
      where pm2.project_id = project_members.project_id
        and pm2.user_id = auth.uid()
        and pm2.role = 'owner'
    )
  );

-- Update project RLS: team members can still see all projects in their team
-- (project_members filtering happens in application layer for now)
drop policy if exists "team members can view projects"   on public.projects;
drop policy if exists "team members can insert projects" on public.projects;
drop policy if exists "team members can update projects" on public.projects;
drop policy if exists "team members can delete projects" on public.projects;

create policy "team members can view projects"
  on public.projects for select
  using (team_id = public.my_team_id());

create policy "team members can insert projects"
  on public.projects for insert
  with check (team_id = public.my_team_id());

create policy "team members can update projects"
  on public.projects for update
  using (team_id = public.my_team_id());

create policy "team members can delete projects"
  on public.projects for delete
  using (
    team_id = public.my_team_id()
    and (
      created_by = auth.uid()
      or exists (
        select 1 from public.profiles
        where id = auth.uid()
          and role in ('owner', 'admin')
          and team_id = public.my_team_id()
      )
    )
  );
