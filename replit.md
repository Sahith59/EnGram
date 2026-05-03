# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

---

## ENGRAM App (`artifacts/engram`)

**"Git for AI Decisions"** — Next.js 14.2 + TypeScript + Tailwind + Supabase + AI

### Tech Stack
- **Framework**: Next.js 14.2 (App Router, TypeScript)
- **Styling**: Tailwind CSS with custom `engram`/`gh-*` design tokens
- **Database**: Supabase (PostgreSQL + pgvector)
- **Auth**: Supabase Auth (email + OAuth)
- **AI**: Anthropic Claude (summaries/briefs) + OpenAI `text-embedding-3-small` (embeddings)
- **Dev port**: 3000

### Key Features (Phases 1–9)
- Chrome extension captures ChatGPT / Claude / Gemini conversations
- Context snapshots stored with 1536-dim embeddings
- `/api/ask` — semantic Q&A over captures + GitHub code context
- **Project Clustering** — auto-groups snapshots by embedding cosine similarity (threshold 0.72)
- **GitHub Integration** — index any repo (up to 400 files, chunked + embedded), searchable via `/api/ask`
- Digest generation, Team management, Merge Brief (Anthropic)

### DB Migrations
Supabase runs PostgreSQL 15. Direct DB connections are blocked from this environment.

**Pending migrations** (must be applied via Supabase SQL Editor):
- `supabase/migrations/0011_projects_clustering.sql` — `projects` table, `project_id` FK on `context_snapshots`, `find_nearest_project()` RPC
- `supabase/migrations/0012_github_integration.sql` — `github_repos`, `github_chunks` tables, `search_github_chunks()` RPC

**In-app helper**: Visit `/setup` → copy the idempotent SQL → paste into Supabase SQL Editor at:
`https://supabase.com/dashboard/project/fvowlnhpzgkcejumftcv/sql/new`

Migration status check: `GET /api/admin/migrate`

### File Layout
```
artifacts/engram/
  app/
    (app)/          — authenticated layout (sidebar)
      dashboard/    — main captures list
      ask/          — semantic Q&A page
      projects/     — project clustering UI
      settings/
        github/     — GitHub PAT + repo indexing
      setup/        — DB migration helper
    api/
      capture/      — Chrome extension ingest + clustering hook
      ask/          — semantic search + GitHub context + Claude answer
      projects/     — project CRUD + merge brief
      github/       — connect / repos / index endpoints
      admin/
        migrate/    — migration status + SQL export
  lib/
    clustering.ts   — cosine similarity, centroid update, auto-name
    github.ts       — GitHub API, repo indexing pipeline
    supabase/       — client, admin, server, config helpers
  supabase/migrations/ — SQL migration files 0001–0012
  components/
    layout/         — Sidebar (with Projects + GitHub + DB Setup nav)
```

### Environment Variables Required
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GITHUB_PERSONAL_ACCESS_TOKEN` (for GitHub integration)
