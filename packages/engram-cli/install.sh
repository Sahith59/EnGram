#!/usr/bin/env bash
# ENGRAM CLI — Install script
# Usage: bash install.sh
# Installs `engram` to ~/.local/bin (no sudo required)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  ███████╗███╗   ██╗ ██████╗ ██████╗  █████╗ ███╗   ███╗"
echo "  ██╔════╝████╗  ██║██╔════╝ ██╔══██╗██╔══██╗████╗ ████║"
echo "  █████╗  ██╔██╗ ██║██║  ███╗██████╔╝███████║██╔████╔██║"
echo "  ██╔══╝  ██║╚██╗██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║"
echo "  ███████╗██║ ╚████║╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║"
echo "  ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝"
echo "  Git for AI Decisions — CLI Installer"
echo ""

# Build
echo "  Building CLI..."
cd "$SCRIPT_DIR"
pnpm install --silent
pnpm build --silent
echo "  ✔ Build complete"

# Install to ~/.local/bin
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
chmod +x dist/index.js
ln -sf "$SCRIPT_DIR/dist/index.js" "$BIN_DIR/engram"
echo "  ✔ Linked to $BIN_DIR/engram"

# PATH advice
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo "  ⚠  Add this to your shell config (~/.bashrc, ~/.zshrc):"
  echo ""
  echo "       export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
  echo "  Then reload: source ~/.bashrc"
else
  echo "  ✔ $BIN_DIR is already in PATH"
fi

echo ""
echo "  Installation complete! Run:"
echo ""
echo "    engram login    — connect to your ENGRAM account"
echo "    engram --help   — see all commands"
echo ""
