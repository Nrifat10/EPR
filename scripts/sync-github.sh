#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Sync the Landmark Inter Gulf project to GitHub (landmarkfinace/HR01).
#
# Usage:
#   bash scripts/sync-github.sh                      # auto message w/ timestamp
#   bash scripts/sync-github.sh "My custom message"  # custom message
#
# What it does:
#   1. Stages EVERYTHING (code, prisma, db/custom.db data backup, public…)
#      — node_modules/.next/logs are excluded via .gitignore
#   2. Commits (skips cleanly when nothing changed)
#   3. Pushes to origin main (HR01 repo, token auth already in .git/config)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-Auto-sync: $(date -u +"%Y-%m-%d %H:%M UTC") — project + data snapshot}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "✗ Not a git repository."; exit 1
fi

git add -A

if git diff --cached --quiet; then
  echo "✓ Nothing to sync — working tree clean."
  exit 0
fi

git commit -m "$MSG"
git push origin main
echo "✓ Pushed to GitHub (landmarkfinace/HR01): $MSG"
