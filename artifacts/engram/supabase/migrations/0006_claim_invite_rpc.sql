-- ============================================================
-- ENGRAM Phase 8.2: Atomic invite claim
-- ============================================================
-- Concurrent joins on the same invite must not over-claim past max_uses.
-- This RPC does the validity check + use_count increment in one atomic
-- UPDATE. Returns the team_id on success, NULL when the invite is no
-- longer claimable (revoked / expired / exhausted / not found).
-- ============================================================

create or replace function public.claim_team_invite(p_code text)
returns uuid
language sql
security definer
set search_path = public
as $$
  update public.team_invites
     set use_count = use_count + 1
   where code = p_code
     and revoked_at is null
     and (expires_at is null or expires_at > now())
     and use_count < max_uses
  returning team_id;
$$;

revoke all on function public.claim_team_invite(text) from public;
grant execute on function public.claim_team_invite(text) to authenticated, service_role;
