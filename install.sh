#!/usr/bin/env bash
# Install mbround18/skills without cloning by hand:
#
#   curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- pwa pdf-parse
#   curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- --all
#   curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- --list
#
# Keeps one shallow clone in $SKILLS_HOME (default ~/.local/share/agent-skills),
# fast-forwards it on every run, then symlinks the named skills into
# ~/.claude/skills (override with CLAUDE_SKILLS_DIR). Re-run to update.
#
# Needs git and Node.js 26+. Overrides: SKILLS_REPO, SKILLS_BRANCH, SKILLS_HOME.
set -euo pipefail

repo="${SKILLS_REPO:-https://github.com/mbround18/skills.git}"
branch="${SKILLS_BRANCH:-main}"
home="${SKILLS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/agent-skills}"

die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
command -v git >/dev/null || die "git is required"
command -v node >/dev/null || die "Node.js 26+ is required (https://nodejs.org)"
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 26 ] || die "Node.js 26+ is required (found $(node --version))"

if [ -d "$home/.git" ]; then
  git -C "$home" pull --quiet --ff-only origin "$branch" \
    || die "could not fast-forward $home; it has local changes or diverged. Resolve it there, then re-run"
elif [ -e "$home" ]; then
  die "$home exists but is not a git checkout; set SKILLS_HOME to another directory"
else
  mkdir -p "$(dirname "$home")"
  git clone --quiet --depth 1 --branch "$branch" "$repo" "$home"
fi

exec node "$home/scripts/install.mjs" "$@"
