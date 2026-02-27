#!/bin/bash
set -euo pipefail

echo "🐍 Setting up embedded Python runtime..."
echo ""

PYTHON_VERSION="3.11.7"
PYTHON_BUILD_DATE="20240107"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON_DIR="$PROJECT_DIR/embedded-python"
RELEASE_BASE_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m | tr '[:upper:]' '[:lower:]')"

case "$ARCH" in
  amd64) ARCH="x86_64" ;;
  arm64) ARCH="aarch64" ;;
esac

echo "Platform: $OS-$ARCH"
echo "Target directory: $PYTHON_DIR"
echo ""

if [ -d "$PYTHON_DIR" ]; then
  echo "Removing previous Python installation..."
  rm -rf "$PYTHON_DIR"
fi
mkdir -p "$PYTHON_DIR"

declare -a URL_CANDIDATES=()

if [[ "$OS" == linux* ]]; then
  if [ "$ARCH" = "x86_64" ]; then
    URL_CANDIDATES=(
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-unknown-linux-gnu-install_only.tar.gz"
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-unknown-linux-gnu-shared-install_only.tar.gz"
    )
  else
    echo "❌ Unsupported Linux architecture: $ARCH"
    exit 1
  fi
elif [[ "$OS" == darwin* ]]; then
  if [ "$ARCH" = "aarch64" ]; then
    URL_CANDIDATES=(
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-aarch64-apple-darwin-install_only.tar.gz"
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-aarch64-apple-darwin-shared-install_only.tar.gz"
    )
  elif [ "$ARCH" = "x86_64" ]; then
    URL_CANDIDATES=(
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-apple-darwin-install_only.tar.gz"
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-apple-darwin-shared-install_only.tar.gz"
    )
  else
    echo "❌ Unsupported macOS architecture: $ARCH"
    exit 1
  fi
elif [[ "$OS" == mingw* || "$OS" == msys* || "$OS" == cygwin* ]]; then
  if [ "$ARCH" = "x86_64" ]; then
    URL_CANDIDATES=(
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-pc-windows-msvc-install_only.tar.gz"
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-pc-windows-msvc-shared-install_only.tar.gz"
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-pc-windows-msvc-install_only.zip"
      "${RELEASE_BASE_URL}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-pc-windows-msvc-shared-install_only.zip"
    )
  else
    echo "❌ Unsupported Windows architecture: $ARCH"
    exit 1
  fi
else
  echo "❌ Unsupported OS: $OS"
  exit 1
fi

TEMP_FILE="$PROJECT_DIR/python-standalone.pkg"
TMP_EXTRACT_DIR="$PROJECT_DIR/python-standalone-extract"
rm -f "$TEMP_FILE"
rm -rf "$TMP_EXTRACT_DIR"
mkdir -p "$TMP_EXTRACT_DIR"

echo "📥 Downloading Python standalone build..."
downloaded=0
DOWNLOADED_URL=""
for URL in "${URL_CANDIDATES[@]}"; do
  echo "Trying: $URL"
  if curl -fL --retry 3 --retry-delay 2 -o "$TEMP_FILE" "$URL"; then
    downloaded=1
    DOWNLOADED_URL="$URL"
    break
  fi
done

if [ "$downloaded" -ne 1 ]; then
  echo "❌ Could not download a compatible Python standalone archive."
  exit 1
fi

echo "📦 Extracting Python..."
if [[ "$DOWNLOADED_URL" == *.zip ]]; then
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$TEMP_FILE" -d "$TMP_EXTRACT_DIR"
  else
    tar -xf "$TEMP_FILE" -C "$TMP_EXTRACT_DIR"
  fi
else
  tar -xzf "$TEMP_FILE" -C "$TMP_EXTRACT_DIR"
fi
rm -f "$TEMP_FILE"

shopt -s dotglob nullglob
entries=("$TMP_EXTRACT_DIR"/*)
if [ "${#entries[@]}" -eq 1 ] && [ -d "${entries[0]}" ]; then
  cp -R "${entries[0]}"/. "$PYTHON_DIR"/
else
  cp -R "$TMP_EXTRACT_DIR"/. "$PYTHON_DIR"/
fi
rm -rf "$TMP_EXTRACT_DIR"
shopt -u dotglob nullglob

declare -a PYTHON_CANDIDATES=(
  "$PYTHON_DIR/bin/python3"
  "$PYTHON_DIR/bin/python"
  "$PYTHON_DIR/python.exe"
  "$PYTHON_DIR/python3.exe"
  "$PYTHON_DIR/Scripts/python.exe"
  "$PYTHON_DIR/python/install/python.exe"
  "$PYTHON_DIR/python/install/bin/python.exe"
  "$PYTHON_DIR/python/install/bin/python3.exe"
)

PYTHON_BIN=""
for candidate in "${PYTHON_CANDIDATES[@]}"; do
  if [ -f "$candidate" ]; then
    PYTHON_BIN="$candidate"
    break
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "❌ Python executable not found after extraction."
  find "$PYTHON_DIR" -maxdepth 4 -type f | head -n 40 || true
  exit 1
fi

echo ""
echo "Testing Python installation..."
"$PYTHON_BIN" --version

echo ""
echo "📦 Upgrading pip..."
"$PYTHON_BIN" -m pip install --upgrade pip

echo ""
echo "📦 Installing Python dependencies..."
REQUIREMENTS_FILE="$PROJECT_DIR/../backend/python-requirements.txt"
if [ ! -f "$REQUIREMENTS_FILE" ]; then
  echo "Creating python-requirements.txt..."
  cat > "$REQUIREMENTS_FILE" << 'EOF'
numpy==1.24.3
librosa==0.10.1
scipy==1.11.4
scikit-learn==1.3.2
soundfile==0.12.1
EOF
fi

"$PYTHON_BIN" -m pip install -r "$REQUIREMENTS_FILE"

echo ""
echo "Testing Python imports..."
"$PYTHON_BIN" -c "import numpy; print(f'✓ numpy {numpy.__version__}')"
"$PYTHON_BIN" -c "import librosa; print(f'✓ librosa {librosa.__version__}')"
"$PYTHON_BIN" -c "import scipy; print(f'✓ scipy {scipy.__version__}')"
"$PYTHON_BIN" -c "import sklearn; print(f'✓ scikit-learn {sklearn.__version__}')"

echo ""
echo "✅ Python setup complete!"
echo "   Location: $PYTHON_DIR"
echo "   Executable: $PYTHON_BIN"
echo ""
