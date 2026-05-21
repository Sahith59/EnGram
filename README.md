# ENGRAM — Git for AI Decisions

> Capture, organize, and semantically search every meaningful AI conversation. Never lose context again.

ENGRAM is a full-stack platform that acts as a persistent memory layer for your AI-assisted development workflow. A Chrome extension silently captures conversations from ChatGPT, Claude, and Gemini. The dashboard organizes them into projects, links them to your GitHub repositories, and lets you ask natural-language questions over your entire decision history.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Chrome Extension](#chrome-extension)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [GitHub Integration](#github-integration)
- [Deployment](#deployment)

---

## Features

### Core
- **Multi-platform capture** — Chrome extension scrapes ChatGPT, Claude (all testid variants), and Gemini (including Gemini 2.0 with thinking sections filtered) with zero manual effort
- **Semantic dedup** — Three-tier deduplication: exact content hash → same source URL → conversation identity hash. Updated conversations are always surfaced at the top
- **AI-generated handoff briefs** — Every captured conversation is summarized by Claude into a structured 10-section handoff brief (goal, decisions, code artifacts, next steps, etc.) that a fresh AI can consume cold
- **Semantic Q&A ("Ask")** — Natural language questions answered over your entire capture history using OpenAI embeddings + Claude
- **Blast Radius Engine** — AST-level code graph that shows which files are impacted when you change a function, class, or module

### GitHub Integration
- **Repository indexing** — Indexes up to 400 files per repo into semantic chunks with embeddings
- **AST edge graph** — Parses TypeScript/JavaScript imports and exports into a `code_ast_edges` table for blast radius analysis
- **Semantic repo routing** — Incoming captures are automatically matched to the most relevant project by comparing conversation embeddings against indexed code chunks
- **Webhook support** — Push events trigger re-indexing and keep the graph up to date
- **Commit diff viewer** — Browse commits and diffs directly in the dashboard

### Collaboration
- **Team workspaces** — Invite teammates, share captures, and maintain isolated project feeds
- **Project membership** — Fine-grained access control per project
- **Author attribution** — Captures tagged with author handle for team visibility
- **Slack integration** — Post digest summaries to Slack channels

### Chrome Extension
- **One-click capture** — Capture entire conversation or single response pair to Personal or any Team
- **Per-response "Save to ENGRAM" buttons** — Injected inline on every AI response
- **"Wrong repo?" correction** — One-click reassignment of a capture to a different project
- **Health indicator** — Badge shows connection status; queues captures offline for retry
- **Checkpoint** — Saves context and generates a continuation brief for handoff

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
│  content.js (scrape) → background.js (send) → popup.js  │
└───────────────────────────┬─────────────────────────────┘
                            │ POST /api/capture (cookies)
┌───────────────────────────▼─────────────────────────────┐
│               Next.js 14 App (artifacts/engram)          │
│                                                          │
│  /api/capture  →  Dedup  →  Claude summarize             │
│                        →  OpenAI embed                   │
│                        →  Semantic repo routing          │
│                        →  Supabase upsert                │
│                                                          │
│  /api/ask      →  Embed query → pgvector search → Claude │
│  /api/projects →  CRUD + GitHub repo management          │
│  /api/github   →  OAuth + App install + Repo indexer     │
│  /api/webhooks →  GitHub push → AST reindex              │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                  Supabase (PostgreSQL + pgvector)         │
│                                                          │
│  context_snapshots  github_chunks   code_ast_edges       │
│  projects           github_repos    blast_radius_queries  │
│  teams / profiles   project_members kt_queries           │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | Supabase (PostgreSQL + pgvector) |
| AI — Summarization | Anthropic Claude (claude-haiku-4-5) |
| AI — Embeddings | OpenAI text-embedding-ada-002 |
| GitHub | GitHub App + OAuth + REST API |
| Auth | Supabase Auth (email + OAuth) |
| Package manager | pnpm workspaces |
| Chrome Extension | Manifest V3 |

---

## Project Structure

```
/
├── artifacts/
│   ├── engram/                    # Main Next.js application
│   │   ├── app/
│   │   │   ├── (app)/             # Authenticated pages
│   │   │   │   ├── dashboard/     # Capture feed
│   │   │   │   ├── projects/[id]/ # Project view (commits, members, AST)
│   │   │   │   ├── ask/           # Semantic Q&A
│   │   │   │   ├── context/       # Snapshot detail view
│   │   │   │   ├── digest/        # Summaries
│   │   │   │   ├── resume/        # Continuation briefs
│   │   │   │   ├── settings/      # Integrations & webhook config
│   │   │   │   └── team/          # Team management
│   │   │   └── api/               # API routes (see API Reference)
│   │   ├── components/            # React components
│   │   ├── context-engine/        # Chrome extension source
│   │   │   ├── manifest.json
│   │   │   ├── background.js      # Service worker
│   │   │   ├── content.js         # DOM scraper (ChatGPT/Claude/Gemini)
│   │   │   ├── popup.html/js      # Extension popup UI
│   │   │   └── content.css        # Injected styles
│   │   ├── lib/                   # Business logic
│   │   │   ├── anthropic.ts       # Claude client
│   │   │   ├── clustering.ts      # Centroid-based project assignment
│   │   │   ├── embeddings.ts      # OpenAI embedding helpers
│   │   │   ├── hash.ts            # Conversation dedup hashing
│   │   │   ├── repo-detector.ts   # Semantic repo routing
│   │   │   ├── repo-indexer.ts    # GitHub → chunks → embeddings
│   │   │   ├── ast-indexer.ts     # TypeScript AST → code_ast_edges
│   │   │   ├── blast-radius.ts    # Graph traversal for impact analysis
│   │   │   ├── claims-extractor.ts# Extract factual claims from snapshots
│   │   │   └── supabase/          # Server / admin / client helpers
│   │   ├── supabase/
│   │   │   └── migrations/        # SQL migrations (apply in order)
│   │   └── public/
│   │       └── engram-extension.tar.gz  # Packaged extension
│   └── api-server/                # Auxiliary Express API server
├── lib/
│   ├── db/                        # Drizzle ORM schema
│   └── api-spec/                  # OpenAPI spec + Orval codegen
└── pnpm-workspace.yaml
```

---

## Chrome Extension

### Installation

1. Download `engram-extension.tar.gz` from the ENGRAM dashboard (Settings → Extension)
2. Extract the archive
3. Open Chrome → `chrome://extensions` → enable **Developer mode**
4. Click **Load unpacked** → select the extracted folder

### How it works

The extension runs a content script on `claude.ai`, `chat.openai.com`, and `gemini.google.com`. It:

1. Detects when a conversation has enough substance to capture (turn count, decision keywords)
2. Extracts message pairs using platform-specific DOM strategies with fallback chains
3. Injects a "Save to ENGRAM" pill button beneath every AI response
4. Sends captures to `/api/capture` using session cookies (no separate login needed)
5. Queues captures locally if the server is unreachable and retries every 5 minutes

### Platform-specific notes

| Platform | Primary selector strategy |
|---|---|
| **ChatGPT** | `[data-message-author-role]` attribute |
| **Claude** | `[data-testid*='human-turn']` / `[data-testid*='assistant-turn']` (contains-match, covers all Claude DOM variants) |
| **Gemini** | `user-query` / `model-response` custom elements (thinking sections filtered out) |

---

## Database Schema

All tables live in Supabase. Key tables:

### `context_snapshots`
Captured AI conversations.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `team_id` | uuid | Owning team |
| `created_by` | uuid | User who captured |
| `title` | text | Claude-generated title |
| `summary` | text | 2-4 sentence summary |
| `ai_tool` | text | `chatgpt` / `claude` / `gemini` |
| `raw_conversation` | jsonb | `[{role, content}]` pairs |
| `rationale` | text | Full 10-section handoff brief (markdown) |
| `decision` | text | Key decisions paragraph |
| `tags` | text[] | Technologies mentioned |
| `embedding` | vector(1536) | OpenAI embedding for semantic search |
| `content_hash` | text | SHA-256 of content for exact dedup |
| `identity_hash` | text | Stable fingerprint (first user msg + pair count) |
| `source_url` | text | URL of originating conversation |
| `project_id` | uuid | Auto-assigned project |
| `visibility` | text | `personal` / `team` |
| `author_handle` | text | Display name for team attribution |
| `updated_at` | timestamptz | Updated on new turns — dashboard sorts by this |

### `github_repos`
Indexed repositories.

| Column | Notes |
|---|---|
| `repo_full_name` | `owner/repo` |
| `status` | `pending` / `indexing` / `indexed` / `error` |
| `last_indexed_commit` | SHA of last indexed commit |
| `file_count` | Files indexed |
| `chunk_count` | Semantic chunks created |

### `github_chunks`
Semantic code segments with embeddings for repo routing.

| Column | Notes |
|---|---|
| `repo_id` | FK → github_repos |
| `file_path` | Relative path in repo |
| `content` | Raw code/text |
| `embedding` | vector(1536) |
| `chunk_index` | Order within file |

### `code_ast_edges`
Import/export relationships between files (AST graph).

| Column | Notes |
|---|---|
| `repo_id` | FK → github_repos |
| `from_file` | Importing file |
| `to_file` | Imported file |
| `edge_type` | `import` / `export` / `re-export` |
| `commit_sha` | Commit this edge was indexed from |

### `blast_radius_queries`
Cached blast radius analysis results.

| Column | Notes |
|---|---|
| `repo_id` | FK → github_repos |
| `target_file` | File whose impact was queried |
| `affected_files` | jsonb array of impacted files |
| `depth` | BFS traversal depth |

### `projects`
Clusters of related captures.

| Column | Notes |
|---|---|
| `name` | Project name |
| `repo_id` | Linked GitHub repo |
| `centroid` | vector(1536) — mean embedding of all snapshots |
| `snapshot_count` | Running count |

---

## API Reference

All routes are under `/api/` in the Next.js app.

### Capture

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/capture` | Ingest a conversation from the extension. Deduplicates, summarizes via Claude, embeds, and routes to project. |
| `POST` | `/api/capture/reassign` | Move a snapshot to a different project ("Wrong repo?" correction). |
| `POST` | `/api/checkpoint` | Save context and generate a continuation brief. |

### Contexts (Snapshots)

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/contexts` | List snapshots (paginated, ordered by `updated_at` DESC). Supports `?scope=personal\|team`, `?tool=`, `?search=`. |
| `GET` | `/api/contexts/[id]` | Get a single snapshot with full `raw_conversation`. |
| `DELETE` | `/api/contexts/[id]` | Delete a snapshot. |
| `GET` | `/api/contexts/[id]/export` | Export as markdown handoff brief (`?mode=brief\|full`). |

### AI

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/ask` | Semantic Q&A: embed query → pgvector similarity search → Claude answer with citations. |
| `GET` | `/api/resume` | Fetch the most recent continuation brief for a given tool. |
| `POST` | `/api/digest` | Generate a digest summary of recent captures. |

### Projects

| Method | Route | Description |
|---|---|---|
| `GET/POST` | `/api/projects` | List / create projects. |
| `GET/PATCH/DELETE` | `/api/projects/[id]` | Project CRUD. |
| `GET` | `/api/projects/[id]/commits` | List commits for linked repo (PAT or OAuth). |
| `GET` | `/api/projects/[id]/commits/[sha]/diff` | Full diff for a commit. |
| `POST` | `/api/projects/[id]/ast-reindex` | Manually trigger AST re-indexing for the linked repo. |
| `GET/POST` | `/api/projects/[id]/members` | List / add project members. |
| `DELETE` | `/api/projects/[id]/members/[userId]` | Remove a member. |
| `POST` | `/api/projects/[id]/blast-radius` | Run blast radius analysis for a target file. |

### GitHub

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/github/connect` | Start GitHub App install flow. |
| `GET` | `/api/github/repos` | List repos accessible to the GitHub App installation. |
| `POST` | `/api/github/index` | Trigger full repo indexing (chunking + embeddings). |
| `GET/POST` | `/api/oauth/github` | GitHub OAuth callback. |
| `POST` | `/api/webhooks/github` | Receive push events and trigger re-indexing. |

### Team & Auth

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/me` | Current user profile + team. |
| `GET` | `/api/teams` | List teams the user belongs to. |
| `POST` | `/api/team/invite` | Send team invitation. |
| `POST` | `/api/team/join` | Accept an invitation. |
| `POST` | `/api/team/switch` | Switch active team. |
| `GET` | `/api/health` | Health check (Supabase + AI connectivity). |

---

## Environment Variables

Copy `.env.example` (or set these in your deployment environment):

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# AI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# GitHub App (create at github.com/settings/apps)
GITHUB_APP_ID=your-app-id
GITHUB_APP_NAME=your-app-slug
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# App
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- A Supabase project with `pgvector` enabled
- Anthropic API key
- OpenAI API key

### Local development

```bash
# Install dependencies
pnpm install

# Set environment variables (copy and fill in)
cp artifacts/engram/.env.example artifacts/engram/.env.local

# Run database migrations
# Apply files in artifacts/engram/supabase/migrations/ in order via Supabase dashboard or CLI

# Start the app
pnpm --filter @workspace/engram run dev
```

App runs on `http://localhost:3000`.

### Database migrations

Apply migrations from `artifacts/engram/supabase/migrations/` in numeric order using the Supabase dashboard SQL editor or the Supabase CLI:

```bash
supabase db push
```

---

## GitHub Integration

ENGRAM uses a **GitHub App** (not just OAuth) to access private repositories without requiring users to generate personal access tokens.

### Setup

1. Create a GitHub App at `https://github.com/settings/apps/new`
   - Set **Webhook URL** to `https://your-domain.com/api/webhooks/github`
   - Required permissions: `Contents: Read`, `Metadata: Read`
   - Subscribe to: `Push` events
2. Generate a private key and download the `.pem` file
3. Set `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` in your environment
4. Users install the app from the Settings → Integrations page in the dashboard

### PAT fallback

If a user has no GitHub App installation (e.g. during early setup), all GitHub API calls fall back to a Personal Access Token stored in `integrations.config.pat`. This covers commits, diffs, and repo indexing.

---

## Deployment

ENGRAM is deployed on Replit. To deploy your own instance:

1. Fork this repo
2. Import into Replit
3. Set all environment variables in Replit Secrets
4. Run: `pnpm --filter @workspace/engram run build`
5. The app serves on the `PORT` environment variable (Replit assigns this automatically)

For other platforms (Vercel, Railway, etc.) the Next.js app in `artifacts/engram/` is self-contained — just point your build command at that directory.

---

## License

MIT
