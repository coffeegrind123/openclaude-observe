#!/usr/bin/env bash
# Release script for openclaude-observe.
# Uses date-based versioning: DD.MM.YYYY
# Tags with the date and short git hash.
#
# Usage: scripts/release.sh [--dry-run]
#   Automatically uses today's date as the version.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

# Date-based version (DD.MM.YYYY)
VERSION=$(date +%d.%m.%Y)
HASH=$(git rev-parse --short HEAD)
TAG="v${VERSION}"

echo "=== Releasing ${VERSION} (${HASH}) ==="

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists — appending hash suffix"
  TAG="v${VERSION}-${HASH}"
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: tag $TAG also exists"
    exit 1
  fi
fi

if ! $DRY_RUN && [ -n "$(git status --porcelain)" ]; then
  echo "Error: working directory is not clean — commit or stash changes first"
  exit 1
fi

# ── Bump versions ────────────────────────────────────────

echo ""
echo "Bumping version to $VERSION..."

echo "$VERSION" > VERSION
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json

# ── Test and build ───────────────────────────────────────

echo ""
echo "=== Building Docker image ==="
docker build -t openclaude-observe:local .

if $DRY_RUN; then
  echo ""
  echo "=== Dry run complete ==="
  echo "Version: ${VERSION} (${HASH})"
  echo "Tag: ${TAG}"
  echo "Modified files (not committed):"
  git status --short
  echo ""
  echo "To finish: revert and run without --dry-run"
  exit 0
fi

# ── Commit, tag, push ────────────────────────────────────

echo ""
echo "Committing release..."
git add VERSION package.json CHANGELOG.md
git commit -m "release: ${VERSION} (${HASH})"

echo "Tagging $TAG..."
git tag "$TAG"

echo "Pushing to origin..."
git push origin main "$TAG"

echo ""
echo "=== Released ${VERSION} (${HASH}) ==="
echo "Tag: ${TAG}"
