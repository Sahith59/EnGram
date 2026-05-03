-- ============================================================
-- ENGRAM Phase 8.3 fix: signup trigger order
-- ============================================================
-- The trigger introduced in 0007 inserted the personal team with
-- personal_for=new.id BEFORE the profile row existed. Because
-- teams.personal_for is FK to profiles(id), the FK check failed and
-- new signups errored with "Database error creating new user".
--
-- Fix: insert the profile first (without team_id), then the team
-- (with personal_for now resolvable), then backfill profile.team_id.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  new_team_id uuid;
  v_handle text;
begin
  v_handle := coalesce(nullif(split_part(coalesce(new.email,''), '@', 1), ''), 'personal');

  -- 1. Profile first (team_id null for now, will be backfilled below)
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    'owner'
  );

  -- 2. Personal team (personal_for FK now resolves)
  insert into public.teams (name, slug, personal_for)
  values (
    v_handle || '''s workspace',
    v_handle || '-' || substr(new.id::text, 1, 8) || '-p',
    new.id
  )
  returning id into new_team_id;

  -- 3. Active-team pointer
  update public.profiles set team_id = new_team_id where id = new.id;

  -- 4. Multi-team membership row
  insert into public.team_members (team_id, user_id, role)
  values (new_team_id, new.id, 'owner');

  return new;
end;
$$ language plpgsql security definer;
