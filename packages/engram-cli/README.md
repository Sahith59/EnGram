# ENGRAM CLI

**Git for AI Decisions** — pull any captured AI conversation into any terminal, search semantically, resume sessions in ChatGPT/Claude/Gemini, and watch your git changes surface relevant past decisions automatically.

## Install

```bash
# From the project root:
cd packages/engram-cli
bash install.sh
```

Or manually:
```bash
pnpm install && pnpm build
chmod +x dist/index.js
ln -sf "$(pwd)/dist/index.js" ~/.local/bin/engram
# Add ~/.local/bin to your PATH if needed
```

**To install globally via npm (after publishing):**
```bash
npm install -g @engram/cli
```

## Quick Start

```bash
# 1. Connect to your ENGRAM account (one-time)
engram login

# 2. See your recent captures
engram list

# 3. Search for something specific
engram search "redis caching"

# 4. Resume a session — picks up context, opens AI in browser
engram resume

# 5. Ask a question over your entire history
engram ask "how did we implement authentication?"
```

## All Commands

| Command | Description |
|---------|-------------|
| `engram login` | Authenticate (prompts for ENGRAM URL + credentials) |
| `engram logout` | Clear stored credentials |
| `engram status` | Show current login state |
| `engram list` | List recent captures with tool + timestamp |
| `engram list --team` | List team captures |
| `engram list --tool claude` | Filter by AI tool |
| `engram search <query>` | Keyword search across all captures |
| `engram show <id>` | Full context of a capture (short IDs work) |
| `engram resume [id]` | Interactive picker → copies continuation prompt → opens AI |
| `engram resume --open claude` | Resume and open Claude directly |
| `engram inject [id]` | Pipe handoff brief to stdout (composable) |
| `engram ask <question>` | AI-powered Q&A over your entire history |
| `engram capture` | Save a conversation from stdin or file |
| `engram watch` | Monitor git changes, surface relevant past decisions |

## Resume Flow

`engram resume` is the core feature:

1. Shows an interactive picker of your recent captures
2. Loads the full 10-section **handoff brief** for the selected session
3. **Copies a continuation prompt to your clipboard** — ready to paste
4. Optionally **opens ChatGPT, Claude, or Gemini** in your browser
5. You paste → the AI reads your context → you continue exactly where you left off

```bash
engram resume                  # interactive picker
engram resume abc12345         # by short ID
engram resume --open chatgpt   # skip the browser prompt
engram resume --no-copy        # don't copy to clipboard
```

## Watch Mode (Wow Feature)

```bash
engram watch
```

Detects which files you're editing via `git diff`, then every 5 seconds surfaces the most relevant captures from your history. Great for preventing repeated mistakes and keeping decisions consistent.

## Pipe-Friendly Inject

```bash
# Export the latest brief to a file
engram inject latest > context.md

# Pipe directly into another command
engram inject abc123 | pbcopy

# Use full conversation instead of brief
engram inject abc123 --full > full-convo.md
```

## Capture from Terminal

```bash
# Pipe a conversation in (USER:/ASSISTANT: format)
cat my-conversation.txt | engram capture --tool claude

# Interactive multi-line input (Ctrl+D to finish)
engram capture --tool chatgpt

# Save to team scope
cat convo.txt | engram capture --tool gemini --team
```

## Config

Stored at `~/.config/engram/config.json` (mode 600). Contains:
- API URL
- Access + refresh token
- User email + team ID

Run `engram logout` to clear all credentials.

## Requirements

- Node.js ≥ 18
- An ENGRAM account (web app running at your API URL)
