-- ============================================================
-- 0017: GitHub / GitLab OAuth Tokens + repo webhook columns
-- ============================================================

-- Encrypted OAuth tokens for GitHub and GitLab
create table if not exists public.github_oauth_tokens (
  id                uuid primary key default uuid_generate_v4(),
  team_id           uuid not null references public.teams(id) on delete cascade,
  provider          text not null check (provider in ('github', 'gitlab')),
  access_token_enc  text not null,
  token_scope       text,
  provider_login    text,       -- GitHub login / GitLab username
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (team_id, provider)
);

create index if not exists idx_github_oauth_tokens_team_id
  on public.github_oauth_tokens (team_id);

alter table public.github_oauth_tokens enable row level security;

drop policy if exists "team owners can manage oauth tokens" on public.github_oauth_tokens;
create policy "team owners can manage oauth tokens"
  on public.github_oauth_tokens for all
  using (team_id = public.my_team_id())
  with check (team_id = public.my_team_id());

-- Add webhook tracking + last indexed commit to github_repos
alter table public.github_repos
  add column if not exists last_indexed_commit  text,
  add column if not exists webhook_id           text,
  add column if not exists webhook_secret       text,
  add column if not exists oauth_provider       text check (oauth_provider in ('github', 'gitlab', 'pat'));
