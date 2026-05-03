# @engram/cli

> Cross-tool AI memory layer for the terminal — your context, everywhere.

The ENGRAM CLI wraps Claude, ChatGPT, and Gemini with automatic context injection and capture. Every session is saved locally (SQLite) and synced with the ENGRAM web app, so context captured in your browser follows you to the terminal and vice versa.

---

## Quick Start

```bash
npm install -g @engram/cli

# 1. Point it at your ENGRAM web app
engram config --api-url https://your-app.vercel.app

# 2. Log in (opens browser, links CLI to your account)
engram login

# 3. Chat with Claude — context from your browser sessions is pre-loaded
engram claude "continue the JWT auth discussion"

# 4. Ask across all your captures (uses web app's team knowledge base)
engram ask "why did we choose Supabase over direct Postgres?"

# 5. Resume your last session with full context
engram resume --tool claude
```

---

## Commands

| Command | Description |
|---------|-------------|
| `engram claude [prompt]` | Chat with Claude (context pre-loaded) |
| `engram chatgpt [prompt]` | Chat with ChatGPT (context pre-loaded) |
| `engram gemini [prompt]` | Chat with Gemini (context pre-loaded) |
| `engram resume` | Resume last session — picks up where you left off |
| `engram ask "question"` | Search your context graph (routes to web app) |
| `engram ask "..." --scope team` | Search team-shared knowledge base |
| `engram capture` | Manually capture a conversation |
| `engram sync` | Manually sync with the web app |
| `engram login` | Log in to your ENGRAM account |
| `engram logout` | Log out |
| `engram status` | Show status, captures, sync state |
| `engram config` | Set API keys and preferences |

---

## Configuration

```bash
# Web app (required for sync)
engram config --api-url https://your-app.vercel.app

# AI API keys (required for local streaming)
engram config --anthropic-key sk-ant-...
engram config --openai-key sk-...
engram config --gemini-key AI...

# Set default tool
engram config --default-tool claude
```

Config is stored in `~/.engram/config.json`. The local SQLite database lives at `~/.engram/engram.db`.

---

## How Sync Works

```
Chrome Extension captures chat
         ↓
   /api/capture (web app)
         ↓
    Supabase DB
         ↓
  engram login / engram sync
         ↓
   ~/.engram/engram.db (local)
         ↓
  context injected into next CLI session
```

Captures from `engram claude` flow the other way — they're pushed to `/api/capture` on the web app and appear in the dashboard automatically.

---

## Development

```bash
cd packages/cli
npm install
npm run build
node dist/index.js claude "hello"
```

---

## Web App Integration

The CLI requires two things from the web app:
1. **`/auth/cli/page.tsx`** — already included in `packages/cli/auth-cli-page.tsx`, copy to `artifacts/engram/app/auth/cli/page.tsx`
2. **API routes** — `/api/capture`, `/api/ask`, `/api/resume` — all already exist in the web app

The CLI authenticates using the same Bearer tokens as the web app's Supabase auth. No separate backend needed.

---

## Phases

- **Phase 1** (this branch): CLI built, local SQLite + push to web app's `/api/capture`
- **Phase 2**: Verified sync: captures in browser → `engram resume` picks them up
- **Phase 3**: Merge to main → publish to npm as `@engram/cli`
