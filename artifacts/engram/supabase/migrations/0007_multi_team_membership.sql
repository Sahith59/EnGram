-- ============================================================
-- ENGRAM Phase 8.3: Multi-team membership
-- ============================================================
-- A user can belong to many teams. profiles.team_id is now the
-- "active team" pointer (which team you're currently looking at).
-- Membership is the source of truth in team_members.
--
-- Every user always has exactly one personal team (teams.personal_for
-- = their user id) which can never be deleted or left. Joining an
-- invite ADDS membership; it does not destroy your personal team.
-- ============================================================

-- 1. Mark personal teams (one per user, unique)
alter table public.teams
  add column if not exists personal_for uuid references public.profiles(id) on delete cascade;

create unique index if not exists idx_teams_personal_for_unique
  on public.teams(personal_for) where personal_for is not null;

-- 2. Multi-team membership join table
create table if not exists public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member')),
  joined_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists idx_team_members_user      on public.team_members(user_id);
create index if not exists idx_team_members_team_role on public.team_members(team_id, role);

alter table public.team_members enable row level security;

-- Helper avoids RLS recursion (SECURITY DEFINER bypasses inner RLS check)
create or replace function public.is_team_member(p_team_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists(
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_user_id
  );
$$;

drop policy if exists "members read team rosters" on public.team_members;
create policy "members read team rosters"
  on public.team_members for select
  using (public.is_team_member(team_id));

-- 3. Open up teams SELECT to all teams the caller is in (not just active)
drop policy if exists "team members can view their team" on public.teams;
create policy "members read their teams"
  on public.teams for select
  using (public.is_team_member(id));

-- 4. Backfill: every existing user gets a personal team (or has theirs marked)
do $$
declare
  r record;
  v_handle text;
begin
  for r in select id, email, team_id from public.profiles loop
    -- Skip if a personal team already exists for this user
    if exists(select 1 from public.teams where personal_for = r.id) then
      continue;
    end if;

    v_handle := coalesce(nullif(split_part(coalesce(r.email,''), '@', 1), ''), 'personal');

    -- If their current team is solo (only them), claim it as their personal
    if r.team_id is not null
       and (select count(*) from public.profiles where team_id = r.team_id) = 1 then
      update public.teams set personal_for = r.id where id = r.team_id;
    else
      -- Otherwise mint a fresh personal team
      insert into public.teams (name, slug, personal_for)
      values (
        v_handle || '''s workspace',
        v_handle || '-' || substr(r.id::text, 1, 8) || '-p',
        r.id
      );
    end if;
  end loop;
end $$;

-- 5. Backfill team_members from existing profiles.team_id + personal teams
insert into public.team_members (team_id, user_id, role)
select team_id, id, coalesce(role, 'member')
from public.profiles
where team_id is not null
on conflict do nothing;

insert into public.team_members (team_id, user_id, role)
select id, personal_for, 'owner'
from public.teams
where personal_for is not null
on conflict do nothing;

-- 6. Updated signup trigger: also marks personal + adds team_members row
create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_team_id uuid;
  v_handle text;
begin
  v_handle := coalesce(nullif(split_part(coalesce(new.email,''), '@', 1), ''), 'personal');

  insert into public.teams (name, slug, personal_for)
  values (
    v_handle || '''s workspace',
    v_handle || '-' || substr(new.id::text, 1, 8) || '-p',
    new.id
  )
  returning id into new_team_id;

  insert into public.profiles (id, email, full_name, avatar_url, team_id, role)
  values (
    new.id, new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    new_team_id, 'owner'
  );

  insert into public.team_members (team_id, user_id, role)
  values (new_team_id, new.id, 'owner');

  return new;
end;
$$ language plpgsql security definer;

-- 7. Atomic redeem: validate + slot-claim + membership-insert in one tx
create or replace function public.redeem_team_invite(p_code text, p_user_id uuid)
returns table(team_id uuid, already_member boolean)
language plpgsql security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_existing boolean;
begin
  select ti.team_id into v_team_id
  from public.team_invites ti
  where ti.code = p_code
    and ti.revoked_at is null
    and (ti.expires_at is null or ti.expires_at > now())
    and ti.use_count < ti.max_uses
  limit 1;

  if v_team_id is null then
    return;  -- empty result = invalid
  end if;

  select exists(
    select 1 from public.team_members
    where team_id = v_team_id and user_id = p_user_id
  ) into v_existing;

  if v_existing then
    return query select v_team_id, true;
    return;
  end if;

  -- Atomic slot claim — concurrent callers race at the row level
  update public.team_invites
    set use_count = use_count + 1
    where code = p_code
      and revoked_at is null
      and (expires_at is null or expires_at > now())
      and use_count < max_uses;
  if not found then
    return;  -- another join took the last slot
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (v_team_id, p_user_id, 'member')
  on conflict do nothing;

  return query select v_team_id, false;
end;
$$;

revoke all on function public.redeem_team_invite(text, uuid) from public;
grant execute on function public.redeem_team_invite(text, uuid) to authenticated, service_role;

-- 8. Atomic active-team switch (membership-checked)
create or replace function public.switch_active_team(p_user_id uuid, p_team_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.team_members
  where team_id = p_team_id and user_id = p_user_id;

  if v_role is null then
    return false;
  end if;

  update public.profiles
    set team_id = p_team_id, role = v_role
    where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.switch_active_team(uuid, uuid) from public;
grant execute on function public.switch_active_team(uuid, uuid) to service_role;
