#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Sync the Landmark Inter Gulf project to BOTH GitHub repos:
#   1. origin → github.com/landmarkfinace/HR01   (primary)
#   2. epr    → github.com/Nrifat10/EPR          (mirror, token in .git/config)
#
# Usage:
#   bash scripts/sync-github.sh                      # auto message w/ timestamp
#   bash scripts/sync-github.sh "My custom message"  # custom message
#
# What it does:
#   1. Stages EVERYTHING (code, prisma, db/custom.db data backup, public…)
#      — node_modules/.next/logs are excluded via .gitignore
#   2. Commits (skips cleanly when nothing changed)
#   3. Pushes to origin main AND epr main (each reported independently —
#      a failure on one repo does not block the other)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-Auto-sync: $(date -u +"%Y-%m-%d %H:%M UTC") — project + data snapshot}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "✗ Not a git repository."; exit 1
fi

git add -A

if git diff --cached --quiet; then
  echo "• Nothing new to commit — pushing any un-pushed commits…"
else
  git commit -m "$MSG"
fi

FAIL=0

if git push origin main 2>/dev/null; then
  echo "✓ Pushed to origin (landmarkfinace/HR01): $MSG"
else
  echo "✗ Push to origin (landmarkfinace/HR01) FAILED (auth or network)."
  FAIL=1
fi

if git push epr main 2>/dev/null; then
  echo "✓ Pushed to epr (Nrifat10/EPR): $MSG"
else
  echo "✗ Push to epr (Nrifat10/EPR) FAILED (auth or network)."
  FAIL=1
fi

exit $FAIL
