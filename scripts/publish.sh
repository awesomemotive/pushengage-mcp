#!/usr/bin/env bash
# scripts/publish.sh
#
# Guided npm publish for @pushengage/mcp. Confirms before every step that matters and aborts on
# the first failed check. Safe to run from anywhere in the repo; it cd's to the package root.
#
# Usage: bash scripts/publish.sh   (or: npm run publish:guided)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BOLD='\033[1m'
DIM='\033[2m'
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
RESET='\033[0m'

step() { printf "\n${BOLD}==> %s${RESET}\n" "$1"; }
info() { printf "${DIM}%s${RESET}\n" "$1"; }
ok()   { printf "${GREEN}%s${RESET}\n" "$1"; }
warn() { printf "${YELLOW}%s${RESET}\n" "$1"; }
fail() { printf "${RED}%s${RESET}\n" "$1"; exit 1; }

# Prompts and aborts the whole script unless the answer is an explicit y/yes.
confirm() {
  local reply
  read -r -p "$1 [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) fail "Aborted." ;;
  esac
}

PKG_NAME=$(node -p "require('./package.json').name")
PKG_VERSION=$(node -p "require('./package.json').version")
SERVER_VERSION=$(node -p "require('./server.json').version")
SERVER_PKG_VERSION=$(node -p "require('./server.json').packages[0].version")

step "1/9 — Preflight"
info "Package:   $PKG_NAME"
info "Version:   $PKG_VERSION"
info "Directory: $ROOT"
if [[ "$SERVER_VERSION" != "$PKG_VERSION" || "$SERVER_PKG_VERSION" != "$PKG_VERSION" ]]; then
  fail "Version mismatch: package.json is $PKG_VERSION but server.json has version=$SERVER_VERSION, packages[0].version=$SERVER_PKG_VERSION. Keep them in sync before publishing."
fi
ok "server.json version matches package.json ($PKG_VERSION)."
confirm "Publish $PKG_NAME@$PKG_VERSION from this directory?"

step "2/9 — Git status"
if [[ -n "$(git status --porcelain)" ]]; then
  warn "Working tree has uncommitted changes:"
  git status --short
  confirm "Continue with uncommitted changes anyway?"
else
  ok "Working tree is clean."
fi
info "Current branch: $(git rev-parse --abbrev-ref HEAD)"

step "3/9 — npm auth"
if ! WHOAMI=$(npm whoami 2>/dev/null); then
  fail "Not logged in to npm. Run 'npm login' (as an account in the @pushengage org), then re-run this script."
fi
ok "Logged in as: $WHOAMI"
confirm "Publish as $WHOAMI?"

step "4/9 — Typecheck, tests, lint"
npm run typecheck
npm test
npm run lint
ok "All checks passed."

step "5/9 — Check this version isn't already published"
if npm view "${PKG_NAME}@${PKG_VERSION}" version >/dev/null 2>&1; then
  fail "${PKG_NAME}@${PKG_VERSION} is already on the registry. Bump the version first (npm version <bump>)."
fi
ok "${PKG_NAME}@${PKG_VERSION} is not yet published."

step "6/9 — Choose the dist-tag"
DEFAULT_TAG="latest"
if [[ "$PKG_VERSION" == *-* ]]; then
  DEFAULT_TAG="beta"
  warn "Version looks like a prerelease (contains a hyphen) — defaulting to the 'beta' tag so it won't become 'latest'."
fi
read -r -p "dist-tag to publish under [$DEFAULT_TAG]: " TAG
TAG="${TAG:-$DEFAULT_TAG}"
confirm "Confirm dist-tag '$TAG'?"

step "7/9 — Dry run"
info "This builds the real tarball and shows exactly what would be uploaded, without uploading."
npm publish --dry-run --tag "$TAG"
warn "Review the file list above carefully — that is exactly what will ship."
confirm "Does the dry-run output look correct?"

step "8/9 — Final confirmation"
warn "npm unpublish only works within 72h of publishing and is discouraged — treat this as final."
read -r -p "Type the version to confirm ('$PKG_VERSION'): " TYPED
[[ "$TYPED" == "$PKG_VERSION" ]] || fail "Version didn't match. Aborted."

step "9/9 — Publishing"
npm publish --tag "$TAG"
ok "Published ${PKG_NAME}@${PKG_VERSION} with tag '$TAG'."

step "Verify"
sleep 5
npm view "$PKG_NAME" dist-tags --json 2>/dev/null || warn "Registry indexing can lag a few seconds — check https://www.npmjs.com/package/${PKG_NAME} shortly."
ok "Done. Smoke-test with: npx -y ${PKG_NAME}@${TAG}"
