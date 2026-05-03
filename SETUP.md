# ENGRAM Setup Guide — Complete Instructions for Any IDE

This guide walks you through setting up ENGRAM on your local machine (VS Code, Cursor, Windsurf, etc.) with **all components working exactly as they do on Replit**.

---

## 1️⃣ Prerequisites

Install these first:

### macOS / Linux
```bash
# Node.js 18+ (check: node --version)
# Install from https://nodejs.org/

# pnpm (we use this, not npm)
npm install -g pnpm@9
pnpm --version  # should show 9.x.x
```

### Windows
Download and install from:
- **Node.js**: https://nodejs.org/ (LTS)
- **pnpm**: Open PowerShell as Admin, then run:
  ```powershell
  npm install -g pnpm@9
  ```

---

## 2️⃣ Clone & Install

```bash
# Clone your GitHub repo
git clone https://github.com/Sahith59/EnGram.git
cd EnGram

# Install workspace dependencies
pnpm install

# This installs everything for:
# - artifacts/engram (Next.js app)
# - artifacts/api-server (API)
# - artifacts/mockup-sandbox (Design preview)
```

**Expected output:** Should take 2-5 minutes. No errors about missing modules.

---

## 3️⃣ Environment Variables (Critical)

### Get your keys from Replit

Open **Replit → Secrets** (left sidebar) and copy these values:

1. **NEXT_PUBLIC_SUPABASE_URL** — your Supabase project URL
2. **NEXT_PUBLIC_SUPABASE_ANON_KEY** — Supabase anon key (public-safe)
3. **SUPABASE_SERVICE_ROLE_KEY** — Supabase service role (⚠️ SECRET — don't commit)
4. **ANTHROPIC_API_KEY** — your Anthropic API key
5. **OPENAI_API_KEY** — your OpenAI API key (optional, for embeddings)

### Create `.env.local` files

Create these two files in your project:

**File 1: `artifacts/engram/.env.local`** (Next.js server env)
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1N...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1N...
ANTHROPIC_API_KEY=sk-ant-v0-...
OPENAI_API_KEY=sk-proj-...
EXTENSION_SECRET=your_32_char_secret_string_here
SLACK_SIGNING_SECRET=your_slack_secret
SLACK_BOT_TOKEN=xoxb-your-token
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**File 2: `.env.local`** (root, for any shared vars)
```
# Usually empty unless you have monorepo-level secrets
# Leave blank if not needed
```

---

## 4️⃣ Verify Setup

```bash
# Check TypeScript is clean
cd artifacts/engram
pnpm run typecheck

# Should output: "no errors" (or list errors to fix)
```

---

## 5️⃣ Start the Dev Server

### In VS Code / Cursor / Windsurf

**Option A: Using Terminal** (Recommended)
```bash
cd artifacts/engram
pnpm run dev
```

**Expected output:**
```
  ▲ Next.js 14.2.29
  - Local:        http://localhost:3000
  - Environments: .env.local

 ✓ Ready in 2.5s
```

Then open **http://localhost:3000** in your browser.

**Option B: Using VS Code Task** (Optional)
1. Open Command Palette: `Cmd/Ctrl + Shift + P`
2. Type "Run Task" → Select "pnpm: dev"

---

## 6️⃣ Chrome Extension Setup

### Build the extension

```bash
cd artifacts/engram/context-engine
pnpm run build:extension  # if this script exists, or:
# Just the files are already there — no build needed
```

### Load into Chrome

1. Open **chrome://extensions/**
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Navigate to: `artifacts/engram/context-engine/`
5. Click "Select folder"

**Verify:** You should see "ENGRAM" extension in the list. Click the puzzle icon in Chrome's toolbar and pin it.

### Configure the extension

1. Click the ENGRAM icon in Chrome toolbar
2. Click **Settings** (gear icon)
3. Set **API URL** to: `http://localhost:3000`
4. Sign in with your test account (same email/password as Supabase)

---

## 7️⃣ Database & Supabase

Your Supabase project is already live and has all tables. **Nothing to set up** — just use it.

### If you need to apply migrations manually:

```bash
# Copy your .env.local values into a temp terminal
export NEXT_PUBLIC_SUPABASE_URL="https://..."
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."

# Option 1: Use Supabase CLI (recommended)
# Install: brew install supabase/tap/supabase
# Then: supabase link --project-ref your-project-id
# Then: supabase migration list

# Option 2: Paste SQL into Supabase Studio
# Go to supabase.io → your project → SQL Editor
# Copy/paste from: artifacts/engram/supabase/migrations/
# Apply pending migrations (especially 0010_dedup_hardening.sql)
```

---

## 8️⃣ Test It Works

### Desktop (Dashboard)
1. Go to http://localhost:3000
2. Sign in or create account
3. Create a team
4. Should see your empty dashboard

### Extension (Capture)
1. Go to **claude.ai** or **chatgpt.com**
2. Have a conversation (at least 2 messages: user + assistant)
3. Click the ENGRAM icon in Chrome toolbar
4. Click **"Capture now"** (blue button)
5. Should see a green toast: "Snapshot saved"
6. Refresh your dashboard — the capture should appear!

### Team Sharing
1. In the extension, switch capture mode from **Personal** to **Team**
2. Select a team from the dropdown
3. Capture another conversation
4. Refresh dashboard and click **Team contexts** tab
5. Should see the team capture there

---

## 9️⃣ Troubleshooting

| Problem | Solution |
|---------|----------|
| **`pnpm: command not found`** | Run `npm install -g pnpm@9` again, close terminal, reopen |
| **Port 3000 already in use** | Run `lsof -i :3000` (Mac/Linux) or `netstat -ano \| findstr :3000` (Windows) to find & kill the process |
| **Extension can't sign in** | Make sure API URL is `http://localhost:3000` (not https), sign in to dashboard first |
| **"Cannot find module '@/lib/supabase'"** | Run `pnpm install` from workspace root, not from artifacts/engram |
| **Database connection errors** | Copy SUPABASE_SERVICE_ROLE_KEY carefully (no spaces), it's very long |
| **Embedding/Claude API fails** | Check ANTHROPIC_API_KEY is valid (starts with `sk-ant-v0-`) |
| **Duplicate captures keep appearing** | This was fixed in Phase 8.6. Make sure you're on the latest code (git pull) |
| **Extension button not showing** | Reload extension: chrome://extensions → refresh icon on ENGRAM |

---

## 🔟 What Each Component Does

- **artifacts/engram/** — Next.js web app (dashboard, API routes, auth)
  - `/app` — pages and routes
  - `/components` — React UI components
  - `/lib` — Supabase, auth, AI integration
  - `/context-engine` — Chrome extension code

- **artifacts/api-server/** — Standalone API (optional, usually runs inside engram)

- **artifacts/mockup-sandbox/** — Design preview / component showcase

---

## 🔗 Important File Locations

- **Environment variables:** `artifacts/engram/.env.local`
- **Database migrations:** `artifacts/engram/supabase/migrations/` (read-only, already applied)
- **Extension manifest:** `artifacts/engram/context-engine/manifest.json`
- **Tailwind config:** `artifacts/engram/tailwind.config.ts`
- **Next.js config:** `artifacts/engram/next.config.ts`

---

## ✅ You're Done!

Your ENGRAM setup is complete. The system should run exactly as it does on Replit.

### Next Steps
- Read `artifacts/engram/README.md` for architecture details
- Check `PHASE_LOG.md` (if exists) for what was recently built
- Run tests: `pnpm run test` (if test suite is set up)

**If anything breaks:**
1. Check the error in your terminal
2. Search this SETUP.md for it in Troubleshooting
3. Run `git pull` to ensure you have the latest code
4. Delete `node_modules` and `.next`, then `pnpm install` again (nuclear option)

---

## 🚀 Daily Workflow

```bash
# Every time you start work:
cd EnGram/artifacts/engram
pnpm run dev

# Open http://localhost:3000 in browser
# Open extension in Chrome
# Make changes, save, browser auto-reloads
```

Happy hacking! 🎉
