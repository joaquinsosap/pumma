#!/usr/bin/env bash
#
# Run what CI runs, here, before pushing.
#
#   npm run ci
#
# The point is not to re-run the tests. It is to catch the failures that only
# happen in CI and are invisible locally, because CI starts from a CLEAN GIT
# CHECKOUT and a CLEAN DEPENDENCY INSTALL, and a working tree is neither.
#
# Two real failures motivated this, both of which cost a wait each:
#
#   1. `npm ci` refused to resolve at all after the better-auth 1.7 upgrade.
#      Locally `npm install` was perfectly happy, because node_modules already
#      existed and it had nothing to solve. `npm ci` builds from the lockfile
#      with no tree to fall back on, and hit an ERESOLVE on an optional peer.
#      The job died at Install, before compiling a line, which surfaces as a
#      startup-looking failure rather than a build error.
#
#   2. The Dockerfile copies an explicit list of files before installing, and
#      .npmrc was not on it. Everything passed, the image build still died,
#      because a fresh checkout is not the same set of files as `COPY x y ./`.
#
# So this checks three things in order of how early they would break CI:
#
#   A. every file the Dockerfile installs with is actually committed
#   B. `npm ci` RESOLVES from the lockfile alone (dry run: no download, no disk)
#   C. typecheck, lint, tests, production build, exactly as the workflow runs
#
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
fail=0

step() { printf "\n\033[1m== %s\033[0m\n" "$1"; }
ok()   { printf "   \033[32mok\033[0m  %s\n" "$1"; }
bad()  { printf "   \033[31mFAIL\033[0m %s\n" "$1"; fail=1; }

# ---------------------------------------------------------------------------
step "A. files the Docker install stage needs are committed"

# The literal file list from the Dockerfile's pre-install COPY, so this stays
# true when that line changes rather than restating it from memory.
copied=$(grep -E '^COPY .*\./$' Dockerfile | head -1 | sed -E 's/^COPY //; s/ \.\/$//')
if [ -z "$copied" ]; then
  bad "could not read the install-stage COPY line out of the Dockerfile"
else
  for f in $copied; do
    if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      ok "$f is committed"
    else
      bad "$f is COPYed by the Dockerfile but is not in git (the image build will fail)"
    fi
  done
fi

# A .npmrc that is gitignored is the same bug wearing a different hat.
if [ -f .npmrc ] && ! git ls-files --error-unmatch .npmrc >/dev/null 2>&1; then
  bad ".npmrc exists but is not committed, so CI and Docker will not see it"
fi

# ---------------------------------------------------------------------------
step "B. npm ci resolves from a clean checkout"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# TRACKED files as they currently are on disk, not HEAD. The runner checks out
# a commit, but this is meant to be run before making one: archiving HEAD would
# happily green-light a package.json change that has not been committed yet,
# which is precisely the moment you want to be told. Untracked files are
# excluded because the runner will never see them.
git ls-files -z | tar --null -T - -cf - 2>/dev/null | tar -x -C "$tmp" 2>/dev/null

if [ ! -f "$tmp/package-lock.json" ]; then
  bad "package-lock.json is not committed"
else
  # --dry-run resolves the whole tree and reports what it would install,
  # without downloading anything. It fails on exactly the ERESOLVE that broke
  # CI, in a couple of seconds and without touching the disk.
  if out=$(cd "$tmp" && npm ci --dry-run 2>&1); then
    ok "resolves ($(printf '%s' "$out" | grep -oE '[0-9]+ packages' | head -1))"
  else
    bad "npm ci cannot resolve. CI will die at Install:"
    printf '%s\n' "$out" | grep -E "npm error" | head -12 | sed 's/^/        /'
  fi
fi

# ---------------------------------------------------------------------------
step "C. the quality gate"

run() {
  local name="$1"; shift
  if out=$("$@" 2>&1); then
    ok "$name"
  else
    bad "$name"
    printf '%s\n' "$out" | tail -20 | sed 's/^/        /'
  fi
}

run "typecheck" npm run typecheck
run "lint"      npm run lint
run "tests"     npm test

# The build shares .next with a running dev server, and a production build on
# top of a live one corrupts both. Refuse rather than produce a confusing mess.
if lsof -ti:3000 >/dev/null 2>&1 || lsof -ti:3010 >/dev/null 2>&1; then
  bad "a dev server is running; stop it before the production build (shared .next)"
else
  run "production build" npm run build
fi

# ---------------------------------------------------------------------------
if [ "$fail" -eq 0 ]; then
  printf "\n\033[32mAll green. Safe to push.\033[0m\n"
else
  printf "\n\033[31mSomething CI would catch is broken. Fix it before pushing.\033[0m\n"
fi
exit "$fail"
