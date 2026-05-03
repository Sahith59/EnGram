-- ============================================================
-- ENGRAM Phase 8.3 fix: redeem_team_invite ambiguity
-- ============================================================
-- The RETURNS TABLE column `team_id` collided with table columns of
-- the same name (team_invites.team_id, team_members.team_id),
-- causing 42702 "column reference team_id is ambiguous" inside the
-- INSERT and SELECT bodies.
--
-- Fix: rename the output columns and explicitly qualify all
-- references inside the function body.
-- ============================================================

drop function if exists public.redeem_team_invite(text, uuid);

create or replace function public.redeem_team_invite(p_code text, p_user_id uuid)
returns table(out_team_id uuid, out_already_member boolean)
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
    select 1 from public.team_members tm
    where tm.team_id = v_team_id and tm.user_id = p_user_id
  ) into v_existing;

  if v_existing then
    return query select v_team_id, true;
    return;
  end if;

  -- Atomic slot claim — concurrent callers race at the row level
  update public.team_invites ti
    set use_count = use_count + 1
    where ti.code = p_code
      and ti.revoked_at is null
      and (ti.expires_at is null or ti.expires_at > now())
      and ti.use_count < ti.max_uses;
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
