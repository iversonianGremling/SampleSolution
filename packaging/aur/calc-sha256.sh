#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./packaging/aur/calc-sha256.sh <file-path>
  ./packaging/aur/calc-sha256.sh <https-url>

Examples:
  ./packaging/aur/calc-sha256.sh ./release/Sample-Extractor-0.1.0.AppImage
  ./packaging/aur/calc-sha256.sh https://github.com/OWNER/REPO/releases/download/v0.1.0/linux-Sample-Extractor-0.1.0.AppImage
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

input="$1"

if [[ -f "$input" ]]; then
  sha256sum "$input" | awk '{print $1}'
  exit 0
fi

if [[ "$input" =~ ^https?:// ]]; then
  tmp_file="$(mktemp)"
  trap 'rm -f "$tmp_file"' EXIT
  curl -fsSL "$input" -o "$tmp_file"
  sha256sum "$tmp_file" | awk '{print $1}'
  exit 0
fi

echo "Input must be an existing file or an http(s) URL." >&2
exit 1
