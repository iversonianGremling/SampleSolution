#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PKGBUILD_PATH="${SCRIPT_DIR}/PKGBUILD"
SRCINFO_PATH="${SCRIPT_DIR}/.SRCINFO"

OWNER="iversonianGremling"
REPO="SampleSolution"
VERSION="$(tr -d '[:space:]' < "${REPO_ROOT}/VERSION")"
TAG=""
ASSET_NAME=""
PKGREL="1"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --version <x.y.z>   Version to package (default: VERSION file: ${VERSION})
  --tag <tag>         Release tag (default: v<version>)
  --asset <name>      Exact Linux AppImage asset name from the GitHub release
  --owner <owner>     GitHub owner/org (default: ${OWNER})
  --repo <repo>       GitHub repo (default: ${REPO})
  --pkgrel <n>        pkgrel value to set in PKGBUILD (default: ${PKGREL})
  -h, --help          Show this help

This script:
1) Fetches release metadata for the tag
2) Finds a Linux AppImage asset (or uses --asset)
3) Downloads it and computes sha256
4) Updates PKGBUILD: pkgver, pkgrel, _asset_name, sha256sums
5) Regenerates .SRCINFO if makepkg is available
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --asset)
      ASSET_NAME="$2"
      shift 2
      ;;
    --owner)
      OWNER="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    --pkgrel)
      PKGREL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$TAG" ]]; then
  TAG="v${VERSION}"
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version: $VERSION" >&2
  exit 1
fi

if ! [[ "$PKGREL" =~ ^[0-9]+$ ]]; then
  echo "pkgrel must be a positive integer." >&2
  exit 1
fi

echo "Fetching release metadata for ${OWNER}/${REPO} tag ${TAG}..."
release_json="$(curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}")"

asset_info="$(
  RELEASE_JSON="$release_json" python3 - "$ASSET_NAME" <<'PY'
import json
import os
import re
import sys

requested = sys.argv[1]
data = json.loads(os.environ["RELEASE_JSON"])
assets = data.get("assets") or []

selected = None
if requested:
  for asset in assets:
    if asset.get("name") == requested:
      selected = asset
      break
  if selected is None:
    print(f"Requested asset not found: {requested}", file=sys.stderr)
    sys.exit(2)
else:
  for asset in assets:
    name = asset.get("name", "")
    if name.startswith("linux-") and name.endswith(".AppImage"):
      selected = asset
      break
  if selected is None:
    for asset in assets:
      name = asset.get("name", "")
      if re.search(r"linux", name, re.I) and name.endswith(".AppImage"):
        selected = asset
        break
  if selected is None:
    print("No Linux AppImage asset found in release.", file=sys.stderr)
    sys.exit(3)

print(selected["name"])
print(selected["browser_download_url"])
PY
)"

ASSET_NAME_RESOLVED="$(echo "$asset_info" | sed -n '1p')"
ASSET_URL="$(echo "$asset_info" | sed -n '2p')"

echo "Selected asset: ${ASSET_NAME_RESOLVED}"
echo "Downloading asset to compute sha256..."
tmp_asset="$(mktemp)"
trap 'rm -f "$tmp_asset"' EXIT
curl -fsSL "$ASSET_URL" -o "$tmp_asset"
sha256="$(sha256sum "$tmp_asset" | awk '{print $1}')"
echo "Computed sha256: ${sha256}"

python3 - "$PKGBUILD_PATH" "$VERSION" "$PKGREL" "$ASSET_NAME_RESOLVED" "$sha256" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
version = sys.argv[2]
pkgrel = sys.argv[3]
asset = sys.argv[4]
sha256 = sys.argv[5]
text = path.read_text(encoding="utf-8")

patterns = [
    (r"^pkgver=.*$", f"pkgver={version}"),
    (r"^pkgrel=.*$", f"pkgrel={pkgrel}"),
    (r"^_asset_name=.*$", f"_asset_name='{asset}'"),
    (r"^sha256sums=\('.*'\)$", f"sha256sums=('{sha256}')"),
]

for pattern, replacement in patterns:
    updated, count = re.subn(pattern, replacement, text, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f"Could not update pattern: {pattern}")
    text = updated

path.write_text(text, encoding="utf-8")
PY

echo "Updated PKGBUILD: ${PKGBUILD_PATH}"

if command -v makepkg >/dev/null 2>&1; then
  echo "Regenerating .SRCINFO..."
  (
    cd "$SCRIPT_DIR"
    makepkg --printsrcinfo > "$SRCINFO_PATH"
  )
  echo "Updated .SRCINFO: ${SRCINFO_PATH}"
else
  echo "makepkg not found; skipped .SRCINFO generation."
fi

echo "Done."
