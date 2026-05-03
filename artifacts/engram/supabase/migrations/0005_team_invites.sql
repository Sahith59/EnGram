-- ============================================================
-- ENGRAM Phase 8.1: Team membership backbone
-- ============================================================
-- A team owner/admin can generate an invite code; another user can
-- redeem it to join the team. Joining moves the joiner's snapshots
-- to the new team and deletes their old (now-empty) personal team.
-- ============================================================

create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  code        text not null unique,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  max_uses    int  not null default 5,
  use_count   int  not null default 0,
  revoked_at  timestamptz
);

create index if not exists idx_team_invites_team on public.team_invites(team_id);
create index if not exists idx_team_invites_code on public.team_invites(code);

alter table public.team_invites enable row level security;

-- Members of the team can read their team's invites
drop policy if exists "team members read invites" on public.team_invites;
create policy "team members read invites"
  on public.team_invites for select
  using (
    team_id in (select team_id from public.profiles where id = auth.uid())
  );

-- Owners and admins can create invites for their team
drop policy if exists "owners admins create invites" on public.team_invites;
create policy "owners admins create invites"
  on public.team_invites for insert
  with check (
    team_id in (
      select team_id from public.profiles
      where id = auth.uid() and role in ('owner','admin')
    )
  );

-- Owners and admins can revoke (update) invites for their team
drop policy if exists "owners admins update invites" on public.team_invites;
create policy "owners admins update invites"
  on public.team_invites for update
  using (
    team_id in (
      select team_id from public.profiles
      where id = auth.uid() and role in ('owner','admin')
    )
  );
